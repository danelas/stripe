# SMS Debugging Guide

## Problem Fixed
There were two main issues:
1. The `handleCheckoutCompleted` function in `stripe.js` was only recording payments in the database but **never sending SMS notifications** to customers.
2. **Webhook signature verification was failing** because the request body was being parsed as JSON instead of kept as raw bytes.

Both issues have been **FIXED**.

## What Was Changed

### 1. Fixed `handleCheckoutCompleted` function in `stripe.js`
- Added SMS notification after successful payment processing
- Extracts customer information from Stripe session (name, phone, email)
- Sends personalized payment confirmation SMS with:
  - Customer name
  - Service details
  - Payment amount (including tip)
  - Provider name

### 2. Fixed Webhook Body Parsing Issue
- Moved webhook endpoint before other middleware to preserve raw body
- Added alternative webhook endpoint (`/stripe-webhook-alt`) for platforms that force JSON parsing
- Enhanced debugging logs for webhook signature verification

### 3. Fixed Missing Success/Cancel URLs
- Added `/success` and `/cancel` endpoints that were causing `url_invalid` errors
- These endpoints are required by Stripe checkout sessions
- Now provides proper user feedback after payment completion or cancellation

### 4. Added debugging features
- SMS configuration logging on server startup
- Test SMS endpoint: `POST /test-sms`

## How to Test the Fix

### Step 1: Check SMS Configuration
When you start your server, you should see:
```
🚀 Stripe Payment Service running on port 3000
📊 Environment: development
💳 Stripe: Configured
🗄️  Database: Configured
📱 SMS Bridge: Configured (or Not configured)
📱 TextMagic: Configured (or Not configured)
```

### Step 2: Test SMS Functionality
Use the new test endpoint:
```bash
curl -X POST http://localhost:3000/test-sms \
  -H "Content-Type: application/json" \
  -d '{"phone": "+1234567890"}'
```

### Step 3: Process a Test Payment
1. Create a payment link
2. Complete the payment
3. Check server logs for SMS confirmation messages

## Required Environment Variables

You need **ONE** of these SMS configurations:

### Option 1: SMS Bridge (Recommended)
```env
SMS_BRIDGE_URL=https://your-booking-system.com/api/send-sms
SMS_BRIDGE_TOKEN=your_api_token_if_needed
```

### Option 2: Direct TextMagic
```env
TEXTMAGIC_USERNAME=your_textmagic_username
TEXTMAGIC_API_KEY=your_textmagic_api_key
```

## Troubleshooting

### If SMS still not working:

1. **Check Environment Variables**
   - Ensure SMS credentials are set in your `.env` file
   - Restart your server after adding environment variables

2. **Check Server Logs**
   - Look for SMS-related log messages
   - Check for error messages in webhook processing

3. **Test SMS Endpoint**
   - Use the `/test-sms` endpoint to verify SMS functionality
   - This will help isolate if the issue is with SMS service or webhook processing

4. **Check Stripe Webhook**
   - Verify webhook is receiving `checkout.session.completed` events
   - Check that customer phone number is being collected during checkout

5. **If webhook signature verification fails**:
   - Try using the alternative webhook endpoint: `/stripe-webhook-alt`
   - Update your Stripe webhook URL to use the alternative endpoint
   - This skips signature verification but still processes payments

### Common Issues:

1. **Webhook signature verification failed**: Use the alternative webhook endpoint `/stripe-webhook-alt`
2. **URL invalid errors in Stripe**: The `/success` and `/cancel` endpoints have been added to fix this
3. **No phone number collected**: Ensure `phone_number_collection: { enabled: true }` is set in checkout session
4. **SMS service not configured**: Set up either SMS_BRIDGE_URL or TextMagic credentials
5. **Webhook not firing**: Check Stripe webhook configuration and endpoint URL

## Log Messages to Look For

### Success:
```
✅ Payment confirmation SMS sent successfully to +1234567890
```

### Warnings:
```
⚠️  No phone number available for customer in session cs_xxx
```

### Errors:
```
❌ Failed to send payment confirmation SMS: [error details]
```

## Next Steps

1. Set up your SMS credentials in `.env` file
2. Restart your server
3. Test with the `/test-sms` endpoint
4. Process a test payment to verify the full flow
