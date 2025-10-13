import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { createCheckout, handleStripeWebhook, runDailyTransfers, createAccountLink } from "./stripe.js";

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

// Create checkout session for a provider
app.post("/checkout", express.json(), async (req, res) => {
  try {
    const { 
      providerId, 
      productName = "Mobile Massage 60", 
      amountCents = 17000 
    } = req.body;

    if (!providerId) {
      return res.status(400).json({ error: "providerId is required" });
    }

    const url = await createCheckout({ providerId, productName, amountCents });
    res.json({ url });
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
