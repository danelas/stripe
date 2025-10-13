import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { createCheckout, handleStripeWebhook, runDailyTransfers, createAccountLink } from "./stripe.js";
import { sendPaymentLinkSMS, sendPaymentConfirmationSMS, testSMS } from "./textmagic.js";
import { getAllServicePricing, getServicePricing, upsertServicePricing, createProvider } from "./db.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint for Render
app.get("/", (_req, res) => {
  res.json({ 
    status: "OK", 
    service: "Stripe Payment Service",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Additional health check endpoint
app.get("/health", (_req, res) => {
  res.json({ 
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Create checkout session for a provider (with automatic pricing lookup)
app.post("/checkout", express.json(), async (req, res) => {
  try {
    const { 
      providerId, 
      serviceName,
      addOns = [], // Array of add-on service names
      amountCents // Optional override
    } = req.body;

    if (!providerId) {
      return res.status(400).json({ error: "providerId is required" });
    }

    if (!serviceName && !amountCents) {
      return res.status(400).json({ error: "serviceName or amountCents is required" });
    }

    let finalAmount = amountCents;
    let serviceBreakdown = [];
    
    // If no amount provided, calculate from services and add-ons
    if (!finalAmount) {
      // Get main service pricing
      const mainServicePricing = await getServicePricing(serviceName);
      if (!mainServicePricing) {
        return res.status(400).json({ error: `Service pricing not found for: ${serviceName}` });
      }
      
      finalAmount = mainServicePricing.total_amount_cents;
      serviceBreakdown.push({
        name: serviceName,
        amount: mainServicePricing.total_amount_cents,
        platformFee: mainServicePricing.platform_fee_cents,
        providerCut: mainServicePricing.provider_cut_cents
      });

      // Add pricing for each add-on
      for (const addOnName of addOns) {
        const addOnPricing = await getServicePricing(addOnName);
        if (!addOnPricing) {
          return res.status(400).json({ error: `Add-on pricing not found for: ${addOnName}` });
        }
        
        finalAmount += addOnPricing.total_amount_cents;
        serviceBreakdown.push({
          name: addOnName,
          amount: addOnPricing.total_amount_cents,
          platformFee: addOnPricing.platform_fee_cents,
          providerCut: addOnPricing.provider_cut_cents
        });
      }
    }

    // Create combined service name for display
    const displayName = addOns.length > 0 
      ? `${serviceName} + ${addOns.join(' + ')}`
      : serviceName;

    const url = await createCheckout({ 
      providerId, 
      productName: displayName, 
      amountCents: finalAmount,
      serviceBreakdown,
      allowTips: false // Explicitly disable tips
    });

    res.json({ 
      url, 
      serviceName: displayName, 
      amountCents: finalAmount,
      breakdown: serviceBreakdown,
      totalServices: 1 + addOns.length
    });
  } catch (error) {
    console.error("Checkout error:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Create checkout and send SMS to customer (with automatic pricing lookup and add-ons)
app.post("/checkout-with-sms", express.json(), async (req, res) => {
  try {
    const { 
      providerId, 
      serviceName,
      addOns = [], // Array of add-on service names
      amountCents, // Optional override
      customerPhone,
      customerName = "Customer",
      providerName = "your massage therapist"
    } = req.body;

    if (!providerId) {
      return res.status(400).json({ error: "providerId is required" });
    }

    if (!customerPhone) {
      return res.status(400).json({ error: "customerPhone is required" });
    }

    if (!serviceName && !amountCents) {
      return res.status(400).json({ error: "serviceName or amountCents is required" });
    }

    let finalAmount = amountCents;
    let serviceBreakdown = [];
    
    // If no amount provided, calculate from services and add-ons
    if (!finalAmount) {
      // Get main service pricing
      const mainServicePricing = await getServicePricing(serviceName);
      if (!mainServicePricing) {
        return res.status(400).json({ error: `Service pricing not found for: ${serviceName}` });
      }
      
      finalAmount = mainServicePricing.total_amount_cents;
      serviceBreakdown.push({
        name: serviceName,
        amount: mainServicePricing.total_amount_cents
      });

      // Add pricing for each add-on
      for (const addOnName of addOns) {
        const addOnPricing = await getServicePricing(addOnName);
        if (!addOnPricing) {
          return res.status(400).json({ error: `Add-on pricing not found for: ${addOnName}` });
        }
        
        finalAmount += addOnPricing.total_amount_cents;
        serviceBreakdown.push({
          name: addOnName,
          amount: addOnPricing.total_amount_cents
        });
      }
    }

    // Create combined service name for display
    const displayName = addOns.length > 0 
      ? `${serviceName} + ${addOns.join(' + ')}`
      : serviceName;

    // Create checkout session
    const url = await createCheckout({ 
      providerId, 
      productName: displayName, 
      amountCents: finalAmount,
      serviceBreakdown,
      allowTips: false // Explicitly disable tips
    });

    // Send SMS with payment link
    const smsResult = await sendPaymentLinkSMS(customerPhone, url, {
      customerName,
      serviceName: displayName,
      amount: finalAmount,
      providerName
    });

    res.json({ 
      url,
      serviceName: displayName,
      amountCents: finalAmount,
      breakdown: serviceBreakdown,
      totalServices: 1 + addOns.length,
      sms: smsResult
    });
  } catch (error) {
    console.error("Checkout with SMS error:", error);
    res.status(500).json({ error: "Failed to create checkout session or send SMS" });
  }
});

// Stripe webhook endpoint (requires raw body for signature verification)
app.post("/stripe-webhook", 
  bodyParser.raw({ type: "application/json" }), 
  handleStripeWebhook
);

// Provider onboarding link for WordPress to call
app.post("/provider/account-link", express.json(), async (req, res) => {
  try {
    const { providerId } = req.body;

    if (!providerId) {
      return res.status(400).json({ error: "providerId is required" });
    }

    const url = await createAccountLink(providerId);
    res.json({ url });
  } catch (error) {
    console.error("Account link error:", error);
    res.status(500).json({ error: "Failed to create account link" });
  }
});

// Initialize database tables (call this once after deployment)
app.post("/admin/init-database", async (_req, res) => {
  try {
    const { initializeDatabase } = await import("./db.js");
    await initializeDatabase();
    res.json({ 
      ok: true, 
      message: "Database initialized successfully",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Database initialization error:", error);
    res.status(500).json({ error: "Failed to initialize database" });
  }
});

// Manual trigger for the daily transfer job (for testing or manual runs)
app.post("/admin/run-daily-transfers", async (_req, res) => {
  try {
    await runDailyTransfers();
    res.json({ 
      ok: true, 
      message: "Daily transfers completed successfully",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Daily transfers error:", error);
    res.status(500).json({ error: "Failed to run daily transfers" });
  }
});

// Get provider status (for WordPress to check onboarding status)
app.get("/provider/:providerId/status", async (req, res) => {
  try {
    const { providerId } = req.params;
    // This would be implemented in stripe.js to check Connect account status
    // For now, returning a placeholder
    res.json({ 
      providerId,
      onboarding_status: "pending", // or "complete"
      charges_enabled: false
    });
  } catch (error) {
    console.error("Provider status error:", error);
    res.status(500).json({ error: "Failed to get provider status" });
  }
});

// Test SMS functionality
app.post("/admin/test-sms", express.json(), async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: "phone number is required" });
    }

    const result = await testSMS(phone);
    res.json(result);
  } catch (error) {
    console.error("Test SMS error:", error);
    res.status(500).json({ error: "Failed to send test SMS" });
  }
});

// Send payment confirmation SMS (can be called after successful payment)
app.post("/send-confirmation-sms", express.json(), async (req, res) => {
  try {
    const {
      customerPhone,
      customerName = "Customer",
      serviceName = "Mobile Massage Service",
      amount,
      providerName = "your massage therapist"
    } = req.body;

    if (!customerPhone) {
      return res.status(400).json({ error: "customerPhone is required" });
    }

    const result = await sendPaymentConfirmationSMS(customerPhone, {
      customerName,
      serviceName,
      amount,
      providerName
    });

    res.json(result);
  } catch (error) {
    console.error("Confirmation SMS error:", error);
    res.status(500).json({ error: "Failed to send confirmation SMS" });
  }
});

// Get all service pricing
app.get("/admin/pricing", async (_req, res) => {
  try {
    const pricing = await getAllServicePricing();
    res.json({ pricing });
  } catch (error) {
    console.error("Get pricing error:", error);
    res.status(500).json({ error: "Failed to get pricing" });
  }
});

// Update service pricing
app.post("/admin/pricing", express.json(), async (req, res) => {
  try {
    const {
      serviceName,
      totalAmountCents,
      platformFeeCents,
      providerCutCents
    } = req.body;

    if (!serviceName || !totalAmountCents || !platformFeeCents || !providerCutCents) {
      return res.status(400).json({ 
        error: "serviceName, totalAmountCents, platformFeeCents, and providerCutCents are required" 
      });
    }

    // Validate that fees add up correctly
    if (platformFeeCents + providerCutCents !== totalAmountCents) {
      return res.status(400).json({ 
        error: "platformFeeCents + providerCutCents must equal totalAmountCents" 
      });
    }

    const result = await upsertServicePricing(serviceName, totalAmountCents, platformFeeCents, providerCutCents);
    res.json({ success: true, pricing: result });
  } catch (error) {
    console.error("Update pricing error:", error);
    res.status(500).json({ error: "Failed to update pricing" });
  }
});

// Create/sync provider from main system
app.post("/admin/create-provider", express.json(), async (req, res) => {
  try {
    const {
      id,
      email,
      name,
      phone
    } = req.body;

    if (!id || !email) {
      return res.status(400).json({ 
        error: "id and email are required" 
      });
    }

    const provider = await createProvider(email, id, name, phone);
    
    res.json({ 
      success: true, 
      provider: provider,
      message: "Provider created/updated successfully"
    });
  } catch (error) {
    console.error("Create provider error:", error);
    res.status(500).json({ error: "Failed to create provider" });
  }
});

// Bulk sync providers from main system
app.post("/admin/sync-providers", express.json(), async (req, res) => {
  try {
    const { providers } = req.body;

    if (!providers || !Array.isArray(providers)) {
      return res.status(400).json({ 
        error: "providers array is required" 
      });
    }

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const providerData of providers) {
      try {
        const { id, email, name, phone } = providerData;
        
        if (!id || !email) {
          results.push({ 
            provider: providerData, 
            success: false, 
            error: "Missing id or email" 
          });
          errorCount++;
          continue;
        }

        const provider = await createProvider(email, id, name, phone);
        results.push({ 
          provider: provider, 
          success: true 
        });
        successCount++;
        
      } catch (error) {
        results.push({ 
          provider: providerData, 
          success: false, 
          error: error.message 
        });
        errorCount++;
      }
    }

    res.json({ 
      success: true,
      summary: {
        total: providers.length,
        successful: successCount,
        errors: errorCount
      },
      results: results
    });
    
  } catch (error) {
    console.error("Bulk sync providers error:", error);
    res.status(500).json({ error: "Failed to sync providers" });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({ error: "Internal server error" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

app.listen(PORT, () => {
  console.log(`🚀 Stripe Payment Service running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💳 Stripe: ${process.env.STRIPE_SECRET ? 'Configured' : 'Not configured'}`);
  console.log(`🗄️  Database: ${process.env.DATABASE_URL ? 'Configured' : 'Not configured'}`);
});
