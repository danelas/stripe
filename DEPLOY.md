# Deploy to Render - Quick Start Guide

## 🚀 One-Click Deployment

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/danelas/stripe)

## 📋 Manual Deployment Steps

### 1. Create Render Account
- Sign up at [render.com](https://render.com)
- Connect your GitHub account

### 2. Deploy Database First
1. Go to Render Dashboard
2. Click **New** → **PostgreSQL**
3. Name: `stripe-payment-db`
4. Plan: **Starter** (free)
5. Click **Create Database**
6. **Copy the Internal Database URL** (starts with `postgres://`)

### 3. Deploy Web Service
1. Click **New** → **Web Service**
2. Connect repository: `https://github.com/danelas/stripe`
3. Configure:
   - **Name**: `stripe-payment-service`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Starter` (free)

### 4. Set Environment Variables
Add these in the **Environment** tab:

```bash
NODE_ENV=production
DATABASE_URL=[paste your Internal Database URL from step 2]
STRIPE_SECRET=sk_live_xxx  # Your Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_xxx  # Get this after setting up webhook
PLATFORM_FEE_CENTS=5000  # $50 platform fee
PROVIDER_CUT_CENTS=12000  # $120 provider cut
TIMEZONE=America/New_York
```

### 5. Deploy and Get URL
1. Click **Create Web Service**
2. Wait for deployment (2-3 minutes)
3. Copy your service URL: `https://stripe-payment-service-xxx.onrender.com`

### 6. Setup Stripe Webhook
1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Endpoint URL: `https://your-service-url.onrender.com/stripe-webhook`
4. Select events: `checkout.session.completed`
5. Click **Add endpoint**
6. Copy the **Signing secret** and add it to `STRIPE_WEBHOOK_SECRET` in Render

### 7. Setup Daily Transfers (Optional)
1. In Render Dashboard, click **New** → **Cron Job**
2. Configure:
   - **Name**: `daily-transfers`
   - **Command**: `curl -X POST https://your-service-url.onrender.com/admin/run-daily-transfers`
   - **Schedule**: `0 21 * * *` (9 PM ET daily)

## ✅ Test Your Deployment

### Test Health Check
```bash
curl https://your-service-url.onrender.com/
```

### Test Payment Link Generation
```bash
curl -X POST https://your-service-url.onrender.com/checkout \
  -H "Content-Type: application/json" \
  -d '{"providerId": "test123", "productName": "Test Massage", "amountCents": 17000}'
```

## 🔧 WordPress Integration

Add this to your WordPress functions.php:

```php
function generate_payment_link($provider_id, $amount = 17000) {
    $response = wp_remote_post('https://your-service-url.onrender.com/checkout', [
        'body' => json_encode([
            'providerId' => $provider_id,
            'productName' => 'Mobile Massage Service',
            'amountCents' => $amount
        ]),
        'headers' => ['Content-Type' => 'application/json']
    ]);
    
    if (!is_wp_error($response)) {
        $data = json_decode(wp_remote_retrieve_body($response), true);
        return $data['url'];
    }
    
    return false;
}
```

## 🎯 Next Steps

1. **Test payments** with Stripe test mode first
2. **Setup provider onboarding** using the `/provider/account-link` endpoint
3. **Monitor logs** in Render dashboard
4. **Switch to live mode** when ready

## 🆘 Troubleshooting

- **Database connection issues**: Use Internal Database URL, not External
- **Webhook verification fails**: Check `STRIPE_WEBHOOK_SECRET` matches Stripe
- **Service won't start**: Check logs in Render dashboard for errors
- **Payments not working**: Verify Stripe keys are correct

## 📞 Support

- Render issues: [Render Documentation](https://render.com/docs)
- Stripe issues: [Stripe Documentation](https://stripe.com/docs)
- Code issues: Check the logs in Render dashboard
