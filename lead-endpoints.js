/**
 * Lead Generation API Endpoints
 * Express routes for lead generation system
 */

import express from 'express';
import pkg from 'pg';
import Stripe from 'stripe';
import {
  createLead,
  sendLeadTeaser,
  handleProviderResponse,
  handleLeadPayment,
  getLeadConfig
} from './lead-generation.js';

const { Pool } = pkg;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET, {
  apiVersion: '2025-09-30.clover',
});

const router = express.Router();

/**
 * Create new lead from client inquiry
 * POST /api/leads
 */
router.post('/leads', express.json(), async (req, res) => {
  try {
    const {
      lead_id,
      city,
      service_type,
      preferred_time_window,
      budget_range,
      client_name,
      client_phone,
      client_email,
      exact_address,
      original_notes,
      provider_ids = [] // Optional: specific providers to notify
    } = req.body;

    // Validate required fields
    if (!lead_id || !city || !service_type || !client_name || !client_phone) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['lead_id', 'city', 'service_type', 'client_name', 'client_phone']
      });
    }

    // Create lead
    const lead = await createLead({
      lead_id,
      city,
      service_type,
      preferred_time_window,
      budget_range,
      client_name,
      client_phone,
      client_email,
      exact_address,
      original_notes
    });

    console.log(`✅ Created lead ${lead_id}: ${service_type} in ${city}`);

    // Get providers to notify (implement provider matching logic)
    const providersToNotify = await getMatchingProviders(lead, provider_ids);
    
    // Send teasers to matching providers
    const teaserResults = [];
    for (const provider of providersToNotify) {
      try {
        const result = await sendLeadTeaser(lead, provider);
        teaserResults.push({
          provider_id: provider.provider_id,
          ...result
        });
      } catch (error) {
        console.error(`❌ Failed to send teaser to ${provider.provider_id}:`, error);
        teaserResults.push({
          provider_id: provider.provider_id,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      lead_id: lead.lead_id,
      providers_notified: teaserResults.filter(r => r.sent).length,
      providers_queued: teaserResults.filter(r => r.queued).length,
      providers_skipped: teaserResults.filter(r => r.skipped).length,
      teaser_results: teaserResults
    });

  } catch (error) {
    console.error('❌ Error creating lead:', error);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

/**
 * Handle SMS responses from providers
 * POST /api/leads/sms-response
 */
router.post('/leads/sms-response', express.json(), async (req, res) => {
  try {
    const { from_phone, message, lead_id } = req.body;

    if (!from_phone || !message) {
      return res.status(400).json({ error: 'Missing from_phone or message' });
    }

    // Extract lead_id from message if not provided
    let extractedLeadId = lead_id;
    if (!extractedLeadId) {
      const leadMatch = message.match(/Lead #([A-Za-z0-9_-]+)/);
      extractedLeadId = leadMatch ? leadMatch[1] : null;
    }

    if (!extractedLeadId) {
      console.log(`❓ No lead_id found in message from ${from_phone}: ${message}`);
      return res.json({ success: true, message: 'No active lead found' });
    }

    const result = await handleProviderResponse(from_phone, message, extractedLeadId);

    res.json({
      success: true,
      lead_id: extractedLeadId,
      provider_phone: from_phone,
      result
    });

  } catch (error) {
    console.error('❌ Error handling SMS response:', error);
    res.status(500).json({ error: 'Failed to process SMS response' });
  }
});

/**
 * Webhook for Stripe payment confirmations
 * POST /api/leads/stripe-webhook
 */
router.post('/leads/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle checkout.session.completed for lead payments
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      
      // Check if this is a lead payment
      if (session.metadata?.service_type === 'lead_access') {
        await handleLeadPayment(session);
      }
    }

    res.json({ received: true, event_type: event.type });

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Get lead statistics
 * GET /api/leads/stats
 */
router.get('/leads/stats', async (req, res) => {
  try {
    const { provider_id, days = 30 } = req.query;

    let query = `
      SELECT 
        COUNT(DISTINCT l.lead_id) as total_leads,
        COUNT(DISTINCT CASE WHEN li.status = 'PAID' THEN l.lead_id END) as purchased_leads,
        COUNT(DISTINCT li.provider_id) as providers_notified,
        SUM(CASE WHEN li.status = 'PAID' THEN 2000 ELSE 0 END) as total_revenue_cents
      FROM leads l
      LEFT JOIN lead_interactions li ON l.lead_id = li.lead_id
      WHERE l.created_at >= NOW() - INTERVAL '${parseInt(days)} days'
    `;

    const params = [];
    if (provider_id) {
      query += ' AND li.provider_id = $1';
      params.push(provider_id);
    }

    const result = await pool.query(query, params);
    const stats = result.rows[0];

    res.json({
      success: true,
      period_days: parseInt(days),
      provider_id: provider_id || 'all',
      stats: {
        total_leads: parseInt(stats.total_leads) || 0,
        purchased_leads: parseInt(stats.purchased_leads) || 0,
        providers_notified: parseInt(stats.providers_notified) || 0,
        total_revenue_cents: parseInt(stats.total_revenue_cents) || 0,
        total_revenue_dollars: (parseInt(stats.total_revenue_cents) || 0) / 100,
        conversion_rate: stats.total_leads > 0 
          ? ((parseInt(stats.purchased_leads) || 0) / parseInt(stats.total_leads) * 100).toFixed(2) + '%'
          : '0%'
      }
    });

  } catch (error) {
    console.error('❌ Error getting lead stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * Get active leads (admin)
 * GET /api/leads/active
 */
router.get('/leads/active', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const result = await pool.query(`
      SELECT 
        l.lead_id,
        l.city,
        l.service_type,
        l.preferred_time_window,
        l.budget_range,
        l.notes_snippet,
        l.created_at,
        COUNT(li.provider_id) as providers_notified,
        COUNT(CASE WHEN li.status = 'PAID' THEN 1 END) as providers_paid,
        MAX(li.last_sent_at) as last_activity
      FROM leads l
      LEFT JOIN lead_interactions li ON l.lead_id = li.lead_id
      WHERE l.is_active = true
      GROUP BY l.lead_id, l.city, l.service_type, l.preferred_time_window, 
               l.budget_range, l.notes_snippet, l.created_at
      ORDER BY l.created_at DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), parseInt(offset)]);

    res.json({
      success: true,
      leads: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('❌ Error getting active leads:', error);
    res.status(500).json({ error: 'Failed to get active leads' });
  }
});

/**
 * Success page for lead payments
 * GET /lead/success
 */
router.get('/lead/success', async (req, res) => {
  const { lead_id, provider_id } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Successful - Gold Touch Leads</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
        .success-card { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
        .success { color: #28a745; font-size: 24px; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="success-card">
        <div class="success">✅ Payment Successful!</div>
        <h2>Lead Access Purchased</h2>
        <p>You have successfully purchased access to lead <strong>${lead_id}</strong>.</p>
        <p>The client's full contact details have been sent to your phone via SMS.</p>
        <p>Contact the client directly to arrange the service.</p>
        <hr>
        <p style="font-size: 14px; color: #666;">
          Gold Touch List provides advertising access to client inquiries. We do not arrange or guarantee appointments.
        </p>
      </div>
    </body>
    </html>
  `);
});

/**
 * Cancel page for lead payments
 * GET /lead/cancel
 */
router.get('/lead/cancel', async (req, res) => {
  const { lead_id, provider_id } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Cancelled - Gold Touch Leads</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
        .cancel-card { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 500px; margin: 0 auto; }
        .cancel { color: #dc3545; font-size: 24px; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="cancel-card">
        <div class="cancel">❌ Payment Cancelled</div>
        <h2>Lead Access Not Purchased</h2>
        <p>You cancelled the payment for lead <strong>${lead_id}</strong>.</p>
        <p>If you change your mind, reply "Y" to the original SMS to get a new payment link.</p>
        <p>The lead will expire in 24 hours if not purchased.</p>
      </div>
    </body>
    </html>
  `);
});

/**
 * Helper function to get matching providers
 */
async function getMatchingProviders(lead, specificProviderIds = []) {
  try {
    let query = `
      SELECT DISTINCT p.* 
      FROM providers p
      WHERE p.is_verified = true
    `;
    
    const params = [];
    
    if (specificProviderIds.length > 0) {
      query += ` AND p.id = ANY($1)`;
      params.push(specificProviderIds);
    } else {
      // Add service area matching logic here
      // For now, return all verified providers
      query += ` AND p.service_areas IS NULL OR $1 = ANY(p.service_areas)`;
      params.push(lead.city);
    }
    
    query += ` ORDER BY p.created_at DESC LIMIT 50`;

    const result = await pool.query(query, params);
    return result.rows.map(p => ({
      provider_id: p.id,
      phone: p.phone,
      name: p.name,
      timezone: p.timezone || 'America/New_York'
    }));

  } catch (error) {
    console.error('❌ Error getting matching providers:', error);
    return [];
  }
}

export default router;
