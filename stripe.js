import Stripe from "stripe";
import { 
  getProviderById, 
  upsertJob, 
  listPaidJobsForDate, 
  markJobsTransferred, 
  ensureConnectAccount 
} from "./db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET);

/**
 * Create a Stripe Checkout session for a provider
 */
export async function createCheckout({ providerId, productName, amountCents }) {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: productName
          }
        },
        quantity: 1
      }],
      success_url: `${process.env.DOMAIN || process.env.RENDER_EXTERNAL_URL || 'https://localhost:3000'}/success?sid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN || process.env.RENDER_EXTERNAL_URL || 'https://localhost:3000'}/cancel`,
      metadata: {
        provider_id: providerId
      }
    });

    console.log(`Created checkout session ${session.id} for provider ${providerId}`);
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
  const paymentIntent = session.payment_intent;

  console.log(`Processing completed checkout ${session.id} for provider ${providerId}`);

  await upsertJob({
    id: session.id,
    providerId,
    amountCents: session.amount_total,
    status: "paid",
    paymentIntentId: typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id,
    createdAt: new Date()
  });

  console.log(`Job recorded for provider ${providerId}, amount: ${session.amount_total} cents`);
}

/**
 * Get today's date in the specified timezone
 */
function todayInTZ(tz) {
  const now = new Date();
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

    // Calculate totals per provider
    const totals = {};
    for (const job of jobs) {
      const providerCut = Number(process.env.PROVIDER_CUT_CENTS || 12000);
      totals[job.providerId] = (totals[job.providerId] || 0) + providerCut;
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
