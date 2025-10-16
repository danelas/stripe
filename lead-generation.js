/**
 * Lead Generation Service
 * Sells access to client contact details for $20 per lead
 */

import pkg from 'pg';
const { Pool } = pkg;
import Stripe from 'stripe';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET, {
  apiVersion: '2025-09-30.clover',
});

/**
 * Create a new lead from client inquiry
 */
export async function createLead(leadData) {
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
      original_notes
    } = leadData;

    // Strip PII from notes to create safe snippet
    const notes_snippet = stripPIIFromNotes(original_notes);

    const result = await pool.query(`
      INSERT INTO leads (
        lead_id, city, service_type, preferred_time_window, budget_range,
        notes_snippet, client_name, client_phone, client_email, exact_address,
        original_notes, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW() + INTERVAL '7 days')
      RETURNING *
    `, [
      lead_id, city, service_type, preferred_time_window, budget_range,
      notes_snippet, client_name, client_phone, client_email, exact_address,
      original_notes
    ]);

    console.log(`✅ Created lead ${lead_id} in ${city} for ${service_type}`);
    return result.rows[0];
  } catch (error) {
    console.error('❌ Error creating lead:', error);
    throw error;
  }
}

/**
 * Strip PII from notes to create safe snippet
 */
function stripPIIFromNotes(notes) {
  if (!notes) return '';
  
  let cleaned = notes
    // Remove phone numbers (various formats)
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]')
    .replace(/\b\(\d{3}\)\s?\d{3}[-.]?\d{4}\b/g, '[PHONE]')
    // Remove email addresses
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
    // Remove potential names (common patterns)
    .replace(/\bmy name is\s+[A-Za-z\s]+/gi, 'my name is [NAME]')
    .replace(/\bi'm\s+[A-Za-z\s]+/gi, "I'm [NAME]")
    // Remove addresses (basic patterns)
    .replace(/\b\d+\s+[A-Za-z\s]+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|blvd|boulevard)\b/gi, '[ADDRESS]')
    // Truncate to 160 chars
    .substring(0, 160);

  return cleaned.trim();
}

/**
 * Send teaser SMS to provider about new lead
 */
export async function sendLeadTeaser(lead, provider) {
  try {
    // Check if provider has opted out
    const optOut = await pool.query(
      'SELECT * FROM provider_optouts WHERE provider_id = $1',
      [provider.provider_id]
    );
    
    if (optOut.rows.length > 0) {
      console.log(`🚫 Provider ${provider.provider_id} has opted out, skipping`);
      return { skipped: true, reason: 'opted_out' };
    }

    // Check quiet hours
    if (isQuietHours(provider.timezone || 'America/New_York')) {
      console.log(`🌙 Quiet hours for provider ${provider.provider_id}, queueing`);
      return { queued: true, reason: 'quiet_hours' };
    }

    // Create or update interaction record
    const interaction = await upsertLeadInteraction(lead.lead_id, provider.provider_id, 'TEASER_SENT');

    // Create teaser message (NO PII)
    const message = createTeaserMessage(lead, interaction.id);

    // Send SMS
    const smsResult = await sendSMS(provider.phone, message);

    // Update interaction with sent timestamp
    await pool.query(
      'UPDATE lead_interactions SET last_sent_at = NOW() WHERE lead_id = $1 AND provider_id = $2',
      [lead.lead_id, provider.provider_id]
    );

    console.log(`📱 Sent teaser to ${provider.provider_id} for lead ${lead.lead_id}`);
    return { sent: true, interaction_id: interaction.id };

  } catch (error) {
    console.error('❌ Error sending teaser:', error);
    throw error;
  }
}

/**
 * Create teaser message (NO PII)
 */
function createTeaserMessage(lead, interactionId) {
  const message = `🔔 NEW CLIENT INQUIRY

📍 Location: ${lead.city}
🛠️ Service: ${lead.service_type}
⏰ Timing: ${lead.preferred_time_window || 'Flexible'}
💰 Budget: ${lead.budget_range || 'Not specified'}
📝 Notes: ${lead.notes_snippet || 'No additional notes'}

💡 Want full contact details?
Reply Y for $20 access
Reply N to skip
Reply STOP to opt out

Lead #${lead.lead_id}
Gold Touch List provides advertising access to client inquiries. We do not arrange or guarantee appointments.`;

  return message;
}

/**
 * Handle provider response to teaser
 */
export async function handleProviderResponse(providerPhone, message, leadId) {
  try {
    const response = message.trim().toUpperCase();
    
    // Find provider by phone
    const providerResult = await pool.query(
      'SELECT * FROM providers WHERE phone = $1',
      [providerPhone]
    );
    
    if (providerResult.rows.length === 0) {
      console.log(`❓ Unknown provider phone: ${providerPhone}`);
      return { error: 'Unknown provider' };
    }
    
    const provider = providerResult.rows[0];

    // Handle STOP
    if (response === 'STOP') {
      return await handleOptOut(provider.id);
    }

    // Find interaction
    const interaction = await getLeadInteraction(leadId, provider.id);
    if (!interaction) {
      console.log(`❓ No interaction found for lead ${leadId} and provider ${provider.id}`);
      return { error: 'No active lead found' };
    }

    // Handle responses based on current status
    if (response === 'Y' || response === 'YES') {
      return await handleYesResponse(leadId, provider);
    } else if (response === 'N' || response === 'NO') {
      return await handleNoResponse(leadId, provider.id);
    }

    // Unknown response
    console.log(`❓ Unknown response '${response}' from ${provider.id} for lead ${leadId}`);
    return { error: 'Unknown response' };

  } catch (error) {
    console.error('❌ Error handling provider response:', error);
    throw error;
  }
}

/**
 * Handle YES response - create payment link
 */
async function handleYesResponse(leadId, provider) {
  try {
    // Check for existing unpaid payment link
    const existing = await pool.query(`
      SELECT * FROM lead_interactions 
      WHERE lead_id = $1 AND provider_id = $2 
      AND status IN ('PAYMENT_LINK_SENT', 'AWAITING_PAYMENT')
      AND payment_link_url IS NOT NULL
    `, [leadId, provider.id]);

    if (existing.rows.length > 0) {
      // Resend existing link
      const interaction = existing.rows[0];
      await sendSMS(provider.phone, `Here's your payment link again: ${interaction.payment_link_url}`);
      
      await updateInteractionStatus(leadId, provider.id, 'PAYMENT_LINK_SENT');
      return { resent_link: true };
    }

    // Create new payment link
    const paymentLink = await createPaymentLink(leadId, provider.id);
    
    // Update interaction
    await pool.query(`
      UPDATE lead_interactions 
      SET status = 'PAYMENT_LINK_SENT', 
          payment_link_url = $3,
          checkout_session_id = $4,
          updated_at = NOW()
      WHERE lead_id = $1 AND provider_id = $2
    `, [leadId, provider.id, paymentLink.url, paymentLink.session_id]);

    // Send payment link
    const message = `💳 Pay $20 to access full client details: ${paymentLink.url}

This link expires in 24 hours.
Lead #${leadId}`;

    await sendSMS(provider.phone, message);

    console.log(`💳 Sent payment link to ${provider.id} for lead ${leadId}`);
    return { payment_link_sent: true, url: paymentLink.url };

  } catch (error) {
    console.error('❌ Error handling YES response:', error);
    throw error;
  }
}

/**
 * Create Stripe payment link for lead access
 */
async function createPaymentLink(leadId, providerId) {
  try {
    const config = await getLeadConfig();
    
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: config.currency,
          unit_amount: config.price_cents,
          product_data: {
            name: `Lead Access - ${leadId}`,
            description: 'Access to client contact details'
          }
        },
        quantity: 1
      }],
      success_url: `${process.env.DOMAIN || process.env.RENDER_EXTERNAL_URL}/lead/success?lead_id=${leadId}&provider_id=${providerId}`,
      cancel_url: `${process.env.DOMAIN || process.env.RENDER_EXTERNAL_URL}/lead/cancel?lead_id=${leadId}&provider_id=${providerId}`,
      metadata: {
        lead_id: leadId,
        provider_id: providerId,
        service_type: 'lead_access'
      },
      expires_at: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    });

    return {
      url: session.url,
      session_id: session.id
    };
  } catch (error) {
    console.error('❌ Error creating payment link:', error);
    throw error;
  }
}

/**
 * Handle payment confirmation webhook
 */
export async function handleLeadPayment(session) {
  try {
    const { lead_id, provider_id } = session.metadata;
    
    if (!lead_id || !provider_id) {
      console.error('❌ Missing lead_id or provider_id in payment metadata');
      return;
    }

    // Update interaction status to PAID
    await pool.query(`
      UPDATE lead_interactions 
      SET status = 'PAID', 
          unlocked_at = NOW(),
          payment_intent_id = $3,
          updated_at = NOW()
      WHERE lead_id = $1 AND provider_id = $2
    `, [lead_id, provider_id, session.payment_intent]);

    // Get lead details
    const leadResult = await pool.query('SELECT * FROM leads WHERE lead_id = $1', [lead_id]);
    const lead = leadResult.rows[0];

    // Get provider details
    const providerResult = await pool.query('SELECT * FROM providers WHERE id = $1', [provider_id]);
    const provider = providerResult.rows[0];

    if (!lead || !provider) {
      console.error('❌ Lead or provider not found for payment reveal');
      return;
    }

    // Send revealed details
    await sendRevealedDetails(lead, provider);

    // Mark as done
    await updateInteractionStatus(lead_id, provider_id, 'DONE');

    console.log(`✅ Payment confirmed and details revealed for lead ${lead_id} to provider ${provider_id}`);

  } catch (error) {
    console.error('❌ Error handling lead payment:', error);
    throw error;
  }
}

/**
 * Send revealed client details after payment
 */
async function sendRevealedDetails(lead, provider) {
  try {
    const message = `🎉 PAYMENT CONFIRMED - CLIENT DETAILS

👤 Name: ${lead.client_name}
📞 Phone: ${lead.client_phone}
📧 Email: ${lead.client_email || 'Not provided'}
📍 Address: ${lead.exact_address || 'See notes'}

🛠️ Service: ${lead.service_type}
⏰ Timing: ${lead.preferred_time_window || 'Flexible'}
💰 Budget: ${lead.budget_range || 'Not specified'}

📝 Full Notes:
${lead.original_notes || 'No additional notes'}

Lead #${lead.lead_id}
Contact the client directly to arrange service.

Gold Touch List provides advertising access to client inquiries. We do not arrange or guarantee appointments.`;

    await sendSMS(provider.phone, message);
    
    // Update interaction
    await updateInteractionStatus(lead.lead_id, provider.id, 'REVEAL_DETAILS_SENT');

    console.log(`📧 Revealed details for lead ${lead.lead_id} to provider ${provider.id}`);

  } catch (error) {
    console.error('❌ Error sending revealed details:', error);
    throw error;
  }
}

/**
 * Utility functions
 */

async function upsertLeadInteraction(leadId, providerId, status) {
  const config = await getLeadConfig();
  const ttlExpires = new Date(Date.now() + (config.ttl_hours * 60 * 60 * 1000));
  
  const result = await pool.query(`
    INSERT INTO lead_interactions (lead_id, provider_id, status, ttl_expires_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (lead_id, provider_id)
    DO UPDATE SET status = $3, updated_at = NOW()
    RETURNING *
  `, [leadId, providerId, status, ttlExpires]);
  
  return result.rows[0];
}

async function updateInteractionStatus(leadId, providerId, status) {
  await pool.query(`
    UPDATE lead_interactions 
    SET status = $3, updated_at = NOW()
    WHERE lead_id = $1 AND provider_id = $2
  `, [leadId, providerId, status]);
}

async function getLeadInteraction(leadId, providerId) {
  const result = await pool.query(
    'SELECT * FROM lead_interactions WHERE lead_id = $1 AND provider_id = $2',
    [leadId, providerId]
  );
  return result.rows[0];
}

async function getLeadConfig() {
  const result = await pool.query('SELECT * FROM lead_config ORDER BY id DESC LIMIT 1');
  return result.rows[0] || { price_cents: 2000, currency: 'usd', ttl_hours: 24 };
}

async function handleOptOut(providerId) {
  await pool.query(
    'INSERT INTO provider_optouts (provider_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [providerId]
  );
  
  // Send confirmation (implement sendSMS)
  console.log(`✅ Provider ${providerId} opted out`);
  return { opted_out: true };
}

async function handleNoResponse(leadId, providerId) {
  await updateInteractionStatus(leadId, providerId, 'EXPIRED');
  console.log(`❌ Provider ${providerId} declined lead ${leadId}`);
  return { declined: true };
}

function isQuietHours(timezone) {
  // Implement quiet hours check based on provider timezone
  const now = new Date();
  const hour = now.getHours();
  return hour >= 21.5 || hour < 8; // Simple implementation
}

async function sendSMS(phone, message) {
  // Implement SMS sending (integrate with your SMS service)
  console.log(`📱 SMS to ${phone}: ${message.substring(0, 50)}...`);
  return { sent: true };
}

export {
  stripPIIFromNotes,
  createTeaserMessage,
  handleProviderResponse,
  handleLeadPayment,
  sendRevealedDetails,
  upsertLeadInteraction,
  updateInteractionStatus,
  getLeadConfig
};
