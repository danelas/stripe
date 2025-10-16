import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { createCheckout, handleStripeWebhook, runDailyTransfers, createAccountLink } from "./stripe.js";
import { sendPaymentLinkSMS, sendPaymentConfirmationSMS, testSMS } from "./textmagic.js";
import { getAllServicePricing, getServicePricing, upsertServicePricing, createProvider } from "./db.js";
import { syncProvidersFromMainDatabase, testProviderDatabaseConnection } from "./provider-sync.js";
import { createShortUrl, getOriginalUrl, initializeUrlShortenerTable } from "./url-shortener.js";
import leadRoutes from "./lead-endpoints.js";
import { initializeLeadDatabase } from "./init-lead-db.js";

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

// Mount lead generation routes
app.use("/api", leadRoutes);

// Create open amount checkout (temporary workaround for pricing issues)
app.post("/checkout-open-amount", express.json(), async (req, res) => {
  try {
    const { 
      providerId, 
      serviceName = "Service Payment",
      minimumAmount = 1000, // $10 minimum
      maximumAmount = 50000, // $500 maximum
      defaultAmount = 5000   // $50 default
    } = req.body;

    if (!providerId) {
      return res.status(400).json({ error: "providerId is required" });
    }

    // Create checkout with adjustable amount
    const stripeUrl = await createCheckout({ 
      providerId, 
      productName: `${serviceName} - Enter Your Amount`, 
      amountCents: defaultAmount,
      serviceBreakdown: [],
      allowTips: false, // Tips not needed since amount is adjustable
      adjustableAmount: {
        minimum: minimumAmount,
        maximum: maximumAmount
      }
    });

    // Create shortened URL
    const shortUrl = await createShortUrl(stripeUrl, 24);

    res.json({ 
      url: shortUrl,
      originalUrl: stripeUrl,
      serviceName: `${serviceName} (Custom Amount)`,
      defaultAmount: defaultAmount,
      minimumAmount: minimumAmount,
      maximumAmount: maximumAmount,
      note: "Customer can adjust the amount at checkout"
    });
  } catch (error) {
    console.error("Open amount checkout error:", error);
    res.status(500).json({ error: "Failed to create open amount checkout session" });
  }
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

    const stripeUrl = await createCheckout({ 
      providerId, 
      productName: displayName, 
      amountCents: finalAmount,
      serviceBreakdown,
      allowTips: true // Enable tips with fixed minimum values
    });

    // Create shortened URL for SMS
    const shortUrl = await createShortUrl(stripeUrl, 24); // Expires in 24 hours

    res.json({ 
      url: shortUrl, // Return shortened URL
      originalUrl: stripeUrl, // Include original for reference
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

// Legacy endpoint - kept for backward compatibility but now just returns shortened URL
// Your Main SMS System should use /checkout endpoint instead
app.post("/checkout-with-sms", express.json(), async (req, res) => {
  try {
    const { 
      providerId, 
      serviceName,
      addOns = [], // Array of add-on service names
      amountCents, // Optional override
      customerPhone, // Not used anymore, but kept for compatibility
      customerName = "Customer", // Not used anymore
      providerName = "your massage therapist" // Not used anymore
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
    const stripeUrl = await createCheckout({ 
      providerId, 
      productName: displayName, 
      amountCents: finalAmount,
      serviceBreakdown,
      allowTips: true // Enable tips with fixed minimum values
    });

    // Create shortened URL (NO SMS SENDING - that's handled by your Main SMS System)
    const shortUrl = await createShortUrl(stripeUrl, 24); // Expires in 24 hours

    res.json({ 
      url: shortUrl, // Shortened URL for SMS
      originalUrl: stripeUrl, // Original Stripe URL for reference
      serviceName: displayName,
      amountCents: finalAmount,
      breakdown: serviceBreakdown,
      totalServices: 1 + addOns.length,
      note: "SMS sending should be handled by your Main SMS System using this shortened URL"
    });
  } catch (error) {
    console.error("Checkout error:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
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

// Create personalized onboarding link with provider ID embedded
app.post("/provider/create-onboarding-link", express.json(), async (req, res) => {
  try {
    const { providerId, email, name, phone } = req.body;

    if (!providerId) {
      return res.status(400).json({ error: "providerId is required" });
    }

    // Create or update provider in database first
    const provider = await createProvider(email, providerId, name, phone);
    
    // Create personalized onboarding URL
    const onboardingUrl = `https://stripe-45lh.onrender.com/provider/onboard/${providerId}`;
    
    res.json({ 
      onboardingUrl,
      providerId,
      message: "Send this personalized link to the provider"
    });
  } catch (error) {
    console.error("Create onboarding link error:", error);
    res.status(500).json({ error: "Failed to create onboarding link" });
  }
});

// Provider onboarding page with embedded ID
app.get("/provider/onboard/:providerId", async (req, res) => {
  try {
    const { providerId } = req.params;
    
    // Get provider info
    const provider = await getProviderById(providerId);
    if (!provider) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Provider Not Found - Gold Touch Mobile</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .error { color: #dc3545; }
          </style>
        </head>
        <body>
          <h1 class="error">Provider Not Found</h1>
          <p>Provider ID '${providerId}' not found in our system.</p>
          <p>Please contact Gold Touch Mobile for assistance.</p>
        </body>
        </html>
      `);
    }

    // If provider already has Stripe account, show completion page
    if (provider.stripe_account_id) {
      return res.redirect(`/providers/${providerId}?done=1`);
    }

    // Execute the correct two-step Express account onboarding process
    const onboardingResult = await createAccountLink(providerId);
    
    // Show enhanced onboarding page with provider info
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Setup Payments - Gold Touch Mobile</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            max-width: 600px; 
            margin: 50px auto; 
            padding: 20px; 
            background-color: #f5f5f5;
          }
          .onboard-card {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
          }
          .provider-info {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 5px;
            margin: 20px 0;
            text-align: left;
          }
          .account-info {
            background: #e7f3ff;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
            font-size: 14px;
            color: #0066cc;
          }
          .btn {
            background: #28a745;
            color: white;
            padding: 15px 30px;
            text-decoration: none;
            border-radius: 5px;
            font-size: 18px;
            display: inline-block;
            margin-top: 20px;
          }
          .btn:hover { background: #218838; }
          .steps {
            text-align: left;
            margin: 20px 0;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 5px;
          }
        </style>
      </head>
      <body>
        <div class="onboard-card">
          <h1>🏦 Express Account Setup</h1>
          <p>Welcome! Your Stripe Express account has been created and is ready for setup.</p>
          
          <div class="provider-info">
            <h3>Your Provider Information:</h3>
            <p><strong>Provider ID:</strong> ${providerId}</p>
            <p><strong>Email:</strong> ${provider.email || 'Not provided'}</p>
            <p><strong>Name:</strong> ${provider.name || 'Not provided'}</p>
          </div>

          <div class="account-info">
            <strong>✅ Step 1 Complete:</strong> Express account created (${onboardingResult.account_id})<br>
            <strong>🔗 Step 2:</strong> Complete your onboarding setup
          </div>

          <div class="steps">
            <h3>What happens next:</h3>
            <ol>
              <li>Click the button below to go to Stripe</li>
              <li>Verify your identity and business information</li>
              <li>Connect your bank account for payouts</li>
              <li>Start receiving automatic payments!</li>
            </ol>
          </div>
          
          <a href="${onboardingResult.url}" class="btn">🚀 Complete Setup on Stripe</a>
          
          <p style="margin-top: 30px; font-size: 14px; color: #666;">
            <strong>Secure:</strong> This link goes directly to Stripe's secure platform.<br>
            <strong>Automatic:</strong> No manual account ID sharing needed.<br>
            <strong>Fast:</strong> Setup takes just a few minutes.
          </p>

          <p style="font-size: 12px; color: #999; margin-top: 20px;">
            Link expires: ${new Date(onboardingResult.expires_at * 1000).toLocaleString()}<br>
            Account ID: ${onboardingResult.account_id}
          </p>
        </div>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error("Provider onboarding error:", error);
    res.status(500).send("Error loading onboarding page");
  }
});

// Initialize database tables (call this once after deployment)
app.post("/admin/init-database", async (_req, res) => {
  try {
    const { initializeDatabase } = await import("./db.js");
    await initializeDatabase();
    
    // Also initialize URL shortener table
    const shortenerResult = await initializeUrlShortenerTable();
    
    res.json({ 
      ok: true, 
      message: "Database and URL shortener initialized successfully",
      shortenerTableCreated: shortenerResult,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Database initialization error:", error);
    res.status(500).json({ error: "Failed to initialize database", details: error.message });
  }
});

// Initialize just the URL shortener table (quick fix)
app.post("/admin/init-url-shortener", async (_req, res) => {
  try {
    const result = await initializeUrlShortenerTable();
    
    res.json({ 
      success: true, 
      message: "URL shortener table initialized",
      result 
    });
  } catch (error) {
    console.error("Init URL shortener error:", error);
    res.status(500).json({ error: "Failed to initialize URL shortener table", details: error.message });
  }
});

// Initialize lead generation database
app.post("/admin/init-lead-database", async (_req, res) => {
  try {
    await initializeLeadDatabase();
    
    res.json({ 
      success: true, 
      message: "Lead generation database initialized successfully",
      tables: ["leads", "lead_interactions", "provider_optouts", "lead_config"]
    });
  } catch (error) {
    console.error("Init lead database error:", error);
    res.status(500).json({ error: "Failed to initialize lead database" });
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

// Get service names only (for FluentForms comparison)
app.get("/admin/service-names", async (_req, res) => {
  try {
    const pricing = await getAllServicePricing();
    const serviceNames = pricing.map(p => ({
      serviceName: p.service_name,
      price: `$${(p.total_amount_cents / 100).toFixed(2)}`
    }));
    
    res.json({ 
      serviceNames,
      count: serviceNames.length,
      message: "These are the exact service names in your Stripe database. Your FluentForms must use these exact names."
    });
  } catch (error) {
    console.error("Get service names error:", error);
    res.status(500).json({ error: "Failed to get service names" });
  }
});

// Debug service name lookup
app.post("/admin/debug-service", express.json(), async (req, res) => {
  try {
    const { serviceName } = req.body;
    
    if (!serviceName) {
      return res.status(400).json({ error: "serviceName is required" });
    }
    
    console.log(`=== DEBUGGING SERVICE LOOKUP ===`);
    console.log(`Looking for service: "${serviceName}"`);
    console.log(`Service length: ${serviceName.length}`);
    console.log(`Service bytes: ${Buffer.from(serviceName).toString('hex')}`);
    
    // Test normalization function
    const { normalizeServiceName } = await import("./db.js");
    const normalizedSearch = serviceName
      .replace(/[·•●◦–—]/g, '-')
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    
    console.log(`Normalized search: "${normalizedSearch}"`);
    
    // Get all services for comparison
    const allServices = await getAllServicePricing();
    console.log(`Total services in database: ${allServices.length}`);
    
    // Test normalization on database services
    const normalizedDbServices = allServices.map(s => ({
      original: s.service_name,
      normalized: s.service_name
        .replace(/[·•●◦–—]/g, '-')
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase(),
      matches: (s.service_name
        .replace(/[·•●◦–—]/g, '-')
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()) === normalizedSearch
    }));
    
    // Try exact match
    const exactMatch = await getServicePricing(serviceName);
    console.log(`Exact match found: ${!!exactMatch}`);
    
    const matchingServices = normalizedDbServices.filter(s => s.matches);
    
    res.json({
      searchedFor: serviceName,
      normalizedSearch: normalizedSearch,
      exactMatch: exactMatch,
      normalizedDbServices: normalizedDbServices,
      matchingServices: matchingServices,
      allServices: allServices.map(s => s.service_name)
    });
    
  } catch (error) {
    console.error("Debug service error:", error);
    res.status(500).json({ error: "Failed to debug service", details: error.message });
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

// Test connection to your provider database
app.get("/admin/test-provider-db", async (req, res) => {
  try {
    const result = await testProviderDatabaseConnection();
    res.json(result);
  } catch (error) {
    console.error("Test provider DB error:", error);
    res.status(500).json({ error: "Failed to test provider database connection" });
  }
});

// Sync all providers from your main database
app.post("/admin/sync-from-main-db", async (req, res) => {
  try {
    const result = await syncProvidersFromMainDatabase();
    res.json(result);
  } catch (error) {
    console.error("Sync from main DB error:", error);
    res.status(500).json({ error: "Failed to sync from main database" });
  }
});

// Get provider info from your main database
app.get("/admin/provider-info/:providerId", async (req, res) => {
  try {
    const { providerId } = req.params;
    const provider = await getProviderFromMainDatabase(providerId);
    
    if (!provider) {
      return res.status(404).json({ error: "Provider not found in main database" });
    }
    
    res.json({ provider });
  } catch (error) {
    console.error("Get provider info error:", error);
    res.status(500).json({ error: "Failed to get provider info" });
  }
});

// Generate onboarding links for all providers from main database
app.post("/admin/generate-all-onboarding-links", async (req, res) => {
  try {
    // Sync providers from main database first
    const syncResult = await syncProvidersFromMainDatabase();
    
    if (!syncResult.success) {
      return res.status(500).json({ error: "Failed to sync providers from main database" });
    }
    
    // Get all providers
    const { getAllProviders } = await import("./db.js");
    const providers = await getAllProviders();
    
    // Generate onboarding links for each provider
    const onboardingLinks = providers.map(provider => ({
      providerId: provider.id,
      name: provider.name,
      email: provider.email,
      phone: provider.phone,
      onboardingUrl: `https://stripe-45lh.onrender.com/provider/onboard/${provider.id}`,
      hasStripeAccount: !!provider.stripe_account_id
    }));
    
    res.json({
      success: true,
      totalProviders: providers.length,
      onboardingLinks,
      message: "Send these personalized links to your providers"
    });
    
  } catch (error) {
    console.error("Generate onboarding links error:", error);
    res.status(500).json({ error: "Failed to generate onboarding links" });
  }
});

// URL Shortener redirect route
app.get("/s/:shortCode", async (req, res) => {
  try {
    const { shortCode } = req.params;
    const originalUrl = await getOriginalUrl(shortCode);
    
    if (!originalUrl) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Link Not Found - Gold Touch Mobile</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .error { color: #dc3545; }
          </style>
        </head>
        <body>
          <h1 class="error">Link Not Found</h1>
          <p>This payment link has expired or doesn't exist.</p>
          <p>Please contact Gold Touch Mobile for assistance.</p>
        </body>
        </html>
      `);
    }
    
    // Redirect to the original URL
    res.redirect(originalUrl);
    
  } catch (error) {
    console.error("URL redirect error:", error);
    res.status(500).send("Error processing redirect");
  }
});

// Get URL statistics (optional - for debugging)
app.get("/s/:shortCode/stats", async (req, res) => {
  try {
    const { shortCode } = req.params;
    const stats = await getUrlStats(shortCode);
    
    if (!stats) {
      return res.status(404).json({ error: "Short URL not found" });
    }
    
    res.json(stats);
  } catch (error) {
    console.error("URL stats error:", error);
    res.status(500).json({ error: "Failed to get URL stats" });
  }
});

// Provider onboarding completion page (Stripe redirects here)
app.get("/providers/:providerId", async (req, res) => {
  try {
    const { providerId } = req.params;
    const { done } = req.query;
    
    if (done === '1') {
      // Provider completed Stripe Connect setup
      console.log(`Provider ${providerId} completed Stripe Connect onboarding`);
      
      // Send success page
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Setup Complete - Gold Touch Massage</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { 
              font-family: Arial, sans-serif; 
              max-width: 600px; 
              margin: 50px auto; 
              padding: 20px; 
              text-align: center;
              background-color: #f5f5f5;
            }
            .success-card {
              background: white;
              padding: 40px;
              border-radius: 10px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .checkmark {
              color: #28a745;
              font-size: 60px;
              margin-bottom: 20px;
            }
            h1 { color: #333; margin-bottom: 20px; }
            p { color: #666; line-height: 1.6; margin-bottom: 15px; }
            .next-steps {
              background: #f8f9fa;
              padding: 20px;
              border-radius: 5px;
              margin-top: 30px;
              text-align: left;
            }
            .next-steps h3 { color: #333; margin-top: 0; }
            .next-steps ul { padding-left: 20px; }
            .next-steps li { margin-bottom: 10px; }
          </style>
        </head>
        <body>
          <div class="success-card">
            <div class="checkmark">✅</div>
            <h1>Payout Setup Complete!</h1>
            <p><strong>Congratulations!</strong> Your automatic payout system is now active.</p>
            <p>You'll receive payments directly to your bank account the day after customers pay for your services.</p>
            
            <div class="next-steps">
              <h3>What happens next:</h3>
              <ul>
                <li><strong>Start accepting bookings</strong> - You're ready to receive massage appointments</li>
                <li><strong>Customers pay after service</strong> - They'll get a payment link via SMS</li>
                <li><strong>Daily payouts</strong> - Money appears in your bank account the next business day</li>
                <li><strong>Email notifications</strong> - Stripe will email you about each payout</li>
              </ul>
            </div>
            
            <p style="margin-top: 30px; font-size: 14px; color: #888;">
              Questions? Contact Gold Touch Massage support.
            </p>
          </div>
        </body>
        </html>
      `);
    } else {
      // Regular provider page (not completion)
      res.json({ 
        providerId, 
        message: "Provider page", 
        setupComplete: false 
      });
    }
  } catch (error) {
    console.error("Provider page error:", error);
    res.status(500).json({ error: "Failed to load provider page" });
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
