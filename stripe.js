import Stripe from "stripe";
import { 
  getProviderById, 
  upsertJob, 
  listPaidJobsForDate, 
  markJobsTransferred, 
  ensureConnectAccount,
  getServicePricing
} from "./db.js";
import { sendPaymentConfirmationSMS, sendTransferNotificationSMS } from "./textmagic.js";

const stripe = new Stripe(process.env.STRIPE_SECRET);

/**
 * Create a Stripe Checkout session for a provider with tip option
 */
export async function createCheckout({ providerId, productName, amountCents, allowTips = true, serviceBreakdown = null }) {
  try {
    const lineItems = [{
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        product_data: {
          name: productName || "Gold Touch Massage Service"
        }
      },
      quantity: 1
    }];

    // Add tip options if enabled
    const sessionConfig = {
      mode: "payment",
      line_items: lineItems,
      success_url: `${process.env.DOMAIN || process.env.RENDER_EXTERNAL_URL || 'https://localhost:3000'}/success?sid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN || process.env.RENDER_EXTERNAL_URL || 'https://localhost:3000'}/cancel`,
      metadata: {
        provider_id: providerId,
        service_amount_cents: amountCents.toString(),
        service_breakdown: serviceBreakdown ? JSON.stringify(serviceBreakdown) : null
      }
    };
    
    // Add tip options if enabled
    if (allowTips) {
      // Add custom tip amounts (15%, 20%, 25%)
      const tipAmounts = [
        Math.round(amountCents * 0.15), // 15%
        Math.round(amountCents * 0.20), // 20% 
        Math.round(amountCents * 0.25)  // 25%
      ];
      
      sessionConfig.custom_text = {
        submit: {
          message: "Thank you for supporting our massage therapists!"
        }
      };
      
      // Add tip line items
      sessionConfig.line_items.push({
        price_data: {
          currency: "usd",
          unit_amount: tipAmounts[0],
          product_data: {
            name: `Tip (15%) - Thank you for supporting ${productName}!`
          }
        },
        quantity: 0, // Optional tip
        adjustable_quantity: {
          enabled: true,
          minimum: 0,
          maximum: 1
        }
      });
      
      sessionConfig.line_items.push({
        price_data: {
          currency: "usd",
          unit_amount: tipAmounts[1],
          product_data: {
            name: `Tip (20%) - Thank you for supporting ${productName}!`
          }
        },
        quantity: 0, // Optional tip
        adjustable_quantity: {
          enabled: true,
          minimum: 0,
          maximum: 1
        }
      });
      
      sessionConfig.line_items.push({
        price_data: {
          currency: "usd",
          unit_amount: tipAmounts[2],
          product_data: {
            name: `Tip (25%) - Thank you for supporting ${productName}!`
          }
        },
        quantity: 0, // Optional tip
        adjustable_quantity: {
          enabled: true,
          minimum: 0,
          maximum: 1
        }
      });
    }
    const session = await stripe.checkout.sessions.create(sessionConfig);

    console.log(`Created checkout session ${session.id} for provider ${providerId} (${productName}: $${amountCents/100})`);
    return session.url;
  } catch (error) {
    console.error("Error creating checkout session:", error);
    throw error;
  }
}

/**
 * Handle Stripe webhook events
 */
export async function handleStripeWebhook(req, res) {
  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Handle the event
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;
      
      case "account.updated":
        // Handle Connect account updates if needed
        console.log("Connect account updated:", event.data.object.id);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

/**
 * Handle successful checkout completion
 */
async function handleCheckoutCompleted(session) {
  const providerId = session.metadata.provider_id;
  const serviceAmountCents = parseInt(session.metadata.service_amount_cents || session.amount_total);
  const serviceBreakdown = session.metadata.service_breakdown ? JSON.parse(session.metadata.service_breakdown) : null;
  
  if (!providerId) {
    console.error("No provider_id in session metadata");
    return;
  }

  // Calculate tip amount
  const totalPaid = session.amount_total;
  const tipAmount = totalPaid - serviceAmountCents;
  
  console.log(`Payment breakdown - Service: $${serviceAmountCents/100}, Tip: $${tipAmount/100}, Total: $${totalPaid/100}`);

  // Record the job in our database with full amount (service + tip)
  await upsertJob(
    session.id,
    providerId,
    totalPaid, // Total amount including tip
    "paid",
    session.payment_intent,
    {
      service_amount_cents: serviceAmountCents,
      tip_amount_cents: tipAmount,
      service_breakdown: serviceBreakdown
    }
  );

  console.log(`Recorded payment: ${session.id} for provider ${providerId}, service: $${serviceAmountCents/100}, tip: $${tipAmount/100}, total: $${totalPaid/100}`);
}

/**
 * Get today's date in the specified timezone
 */
function todayInTZ(tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now); // Returns YYYY-MM-DD format
}

/**
 * Run daily transfers to providers
 */
export async function runDailyTransfers(date = todayInTZ(process.env.TIMEZONE || "America/New_York")) {
  console.log(`Running daily transfers for date: ${date}`);

  try {
    // Get all paid jobs for the date
    const jobs = await listPaidJobsForDate(date);
    console.log(`Found ${jobs.length} paid jobs for ${date}`);

    if (jobs.length === 0) {
      console.log("No jobs to process for transfers");
      return;
    }

    // Calculate totals per provider (including tips)
    const totals = {};
    for (const job of jobs) {
      // Get service pricing to calculate proper provider cut
      const serviceAmountCents = parseInt(job.metadata?.service_amount_cents || job.amount_cents);
      const tipAmount = job.amount_cents - serviceAmountCents;
      const serviceBreakdown = job.metadata?.service_breakdown ? JSON.parse(job.metadata.service_breakdown) : null;
      
      let providerCut = 0;
      
      if (serviceBreakdown && Array.isArray(serviceBreakdown)) {
        // Calculate provider cut from service breakdown (for combined services)
        for (const service of serviceBreakdown) {
          providerCut += service.providerCut || 0;
        }
        console.log(`Job ${job.id}: Combined services provider cut $${providerCut/100}`);
      } else {
        // Single service - look up pricing
        const serviceName = job.metadata?.service_name || 'Unknown Service';
        const pricing = await getServicePricing(serviceName);
        
        if (pricing) {
          providerCut = pricing.provider_cut_cents;
        } else {
          // Fallback to environment variable
          providerCut = Number(process.env.PROVIDER_CUT_CENTS || 12000);
        }
        console.log(`Job ${job.id}: Single service provider cut $${providerCut/100}`);
      }
      
      const totalProviderAmount = providerCut + tipAmount; // Service cut + full tip
      totals[job.provider_id] = (totals[job.provider_id] || 0) + totalProviderAmount;
      
      console.log(`Job ${job.id}: Service cut $${providerCut/100}, Tip $${tipAmount/100}, Total to provider $${totalProviderAmount/100}`);
    }

    console.log("Provider totals:", totals);

    // Create transfers for each provider
    for (const [providerId, totalAmount] of Object.entries(totals)) {
      try {
        const provider = await getProviderById(providerId);
        if (!provider) {
          console.error(`Provider ${providerId} not found`);
          continue;
        }

        const accountId = await ensureConnectAccount(provider);
        if (!accountId) {
          console.error(`No Connect account for provider ${providerId}`);
          continue;
        }

        // Create the transfer
        const transfer = await stripe.transfers.create({
          amount: totalAmount,
          currency: "usd",
          destination: accountId,
          metadata: {
            date,
            providerId,
            job_count: jobs.filter(j => j.providerId === providerId).length.toString()
          }
        });

        console.log(`Created transfer ${transfer.id} for provider ${providerId}: $${totalAmount/100}`);

        // Mark jobs as transferred
        await markJobsTransferred(providerId, date, transfer.id);

      } catch (error) {
        console.error(`Error processing transfer for provider ${providerId}:`, error);
        // Continue with other providers even if one fails
      }
    }

    console.log("Daily transfers completed successfully");
  } catch (error) {
    console.error("Error in runDailyTransfers:", error);
    throw error;
  }
}

/**
 * Create an account link for provider onboarding
 */
export async function createAccountLink(providerId) {
  try {
    const provider = await getProviderById(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    const accountId = await ensureConnectAccount(provider);

    const baseUrl = process.env.DOMAIN || process.env.RENDER_EXTERNAL_URL || 'https://localhost:3000';
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/providers/${providerId}?retry=1`,
      return_url: `${baseUrl}/providers/${providerId}?done=1`,
      type: "account_onboarding"
    });

    console.log(`Created account link for provider ${providerId}`);
    return accountLink.url;
  } catch (error) {
    console.error("Error creating account link:", error);
    throw error;
  }
}

/**
 * Get provider's Connect account status
 */
export async function getProviderStatus(providerId) {
  try {
    const provider = await getProviderById(providerId);
    if (!provider || !provider.stripe_account_id) {
      return {
        onboarding_status: "pending",
        charges_enabled: false
      };
    }

    const account = await stripe.accounts.retrieve(provider.stripe_account_id);
    
    return {
      onboarding_status: account.details_submitted ? "complete" : "pending",
      charges_enabled: account.charges_enabled
    };
  } catch (error) {
    console.error("Error getting provider status:", error);
    return {
      onboarding_status: "error",
      charges_enabled: false
    };
  }
}
