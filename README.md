# Stripe Payment Service

A Node.js service for handling Stripe payments with automatic provider payouts. This service processes payments through Stripe Checkout, tracks jobs, and automatically transfers provider cuts via Stripe Connect.

## Architecture

- **Client payments**: Processed via Stripe Checkout or Payment Links
- **Webhook handling**: Receives `checkout.session.completed` events
- **Job tracking**: Records paid jobs in PostgreSQL
- **Daily transfers**: Automated cron job transfers provider cuts at 9 PM ET
- **Provider onboarding**: Stripe Connect Express accounts for automatic payouts

## Features

- ✅ Stripe Checkout session creation
- ✅ Webhook signature verification
- ✅ Job tracking and status management
- ✅ Automated daily transfers to providers
- ✅ Provider Connect account onboarding
- ✅ Provider status checking
- ✅ **TextMagic SMS integration**
- ✅ **Automatic payment link SMS delivery**
- ✅ **Payment confirmation SMS**
- ✅ **Provider payout notifications**
- ✅ Error handling and logging

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Stripe Configuration
STRIPE_SECRET=sk_live_xxx                    # Your Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_xxx              # Webhook signing secret

# Database Configuration  
DATABASE_URL=postgres://username:password@host:port/database

# Payment Configuration (in cents)
PLATFORM_FEE_CENTS=5000                     # Your platform fee
PROVIDER_CUT_CENTS=12000                    # Amount providers receive per job

# Timezone for daily transfers
TIMEZONE=America/New_York

# Domain Configuration
DOMAIN=https://yourdomain.com               # Your domain for redirect URLs

# TextMagic SMS Configuration
TEXTMAGIC_USERNAME=your_textmagic_username  # Your TextMagic username
TEXTMAGIC_API_KEY=your_textmagic_api_key    # Your TextMagic API key
```

### 2. Database Setup

**Option A: Neon (Recommended)**
1. Create account at [neon.tech](https://neon.tech)
2. Create a new database
3. Copy connection string to `DATABASE_URL`

**Option B: Render Postgres**
1. Create Postgres service in Render dashboard
2. Copy internal connection string to `DATABASE_URL`

Run the schema:
```bash
psql $DATABASE_URL -f schema.sql
```

### 3. Stripe Dashboard Setup

1. **Enable Stripe Connect**:
   - Go to Connect → Settings
   - Enable Express accounts

2. **Create Webhook Endpoint**:
   - Go to Developers → Webhooks
   - Add endpoint: `https://your-app.onrender.com/stripe-webhook`
   - Select event: `checkout.session.completed`
   - Copy signing secret to `STRIPE_WEBHOOK_SECRET`

## Deployment on Render

### 1. Create Web Service

1. Connect your GitHub repository
2. Configure build settings:
   - **Runtime**: Node 18+
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

### 2. Set Environment Variables

Add all variables from your `.env` file in Render dashboard.

### 3. Create Cron Job

**Option A: Background Cron Job**
1. Create new Cron Job in Render
2. Command: `curl -X POST https://your-app.onrender.com/admin/run-daily-transfers`
3. Schedule: `0 21 * * *` (9 PM ET daily)

**Option B: Background Worker** (Alternative)
Create a separate worker service that runs the transfer job on schedule.

## API Endpoints

### `POST /checkout`
Create a Stripe Checkout session.

```json
{
  "providerId": "prov_123",
  "productName": "Mobile Massage 60",
  "amountCents": 17000
}
```

### `POST /checkout-with-sms`
Create a Stripe Checkout session and send payment link via SMS.

```json
{
  "providerId": "prov_123",
  "productName": "Mobile Massage 60",
  "amountCents": 17000,
  "customerPhone": "+1234567890",
  "customerName": "John Doe",
  "providerName": "Sarah's Massage"
}
```

### `POST /stripe-webhook`
Stripe webhook endpoint (handles `checkout.session.completed`).

### `POST /provider/account-link`
Generate Stripe Connect onboarding link for providers.

```json
{
  "providerId": "prov_123"
}
```

### `GET /provider/:providerId/status`
Check provider's Connect account status.

### `POST /admin/run-daily-transfers`
Manually trigger daily transfer process.

### `POST /admin/test-sms`
Test SMS functionality.

```json
{
  "phone": "+1234567890"
}
```

### `POST /send-confirmation-sms`
Send payment confirmation SMS to customer.

```json
{
  "customerPhone": "+1234567890",
  "customerName": "John Doe",
  "serviceName": "Mobile Massage 60",
  "amount": 17000,
  "providerName": "Sarah's Massage"
}
```

## 📱 Customer Experience

### Updated SMS Flow:
```
1. Gets SMS: "Your 60 min Mobile Massage ($150.00) is confirmed. Pay after your massage here: [stripe-link]"
2. Completes massage service
3. Clicks link → Sees "$150 + tip option"  
4. Adds $20 tip → Total $170
5. Pays → Provider gets $120 + $20 tip = $140, You keep $50
```

## WordPress Integration

### Provider Onboarding

Add this to your WordPress provider dashboard:

```php
// Add "Connect Stripe Payouts" button
function render_stripe_connect_button($provider_id) {
    $api_url = 'https://your-app.onrender.com/provider/account-link';
    
    $response = wp_remote_post($api_url, [
        'body' => json_encode(['providerId' => $provider_id]),
        'headers' => ['Content-Type' => 'application/json']
    ]);
    
    if (!is_wp_error($response)) {
        $data = json_decode(wp_remote_retrieve_body($response), true);
        echo '<a href="' . esc_url($data['url']) . '" class="button">Connect Stripe Payouts</a>';
    }
}
```

### Payment Links

Create payment links that redirect to your service:

```php
function create_payment_link($provider_id, $service_name = 'Mobile Massage 60', $amount_cents = 17000) {
    $api_url = 'https://your-app.onrender.com/checkout';
    
    $response = wp_remote_post($api_url, [
        'body' => json_encode([
            'providerId' => $provider_id,
            'productName' => $service_name,
            'amountCents' => $amount_cents
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

## Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your values
# Start development server
npm run dev
```

## Monitoring & Logs

- **Render Logs**: View in Render dashboard
- **Stripe Dashboard**: Monitor payments and transfers
- **Database**: Query jobs table for payment tracking

## Security Notes

- ✅ Webhook signature verification
- ✅ Environment variable protection
- ✅ SQL injection prevention with parameterized queries
- ✅ Error handling without sensitive data exposure

## Troubleshooting

### Common Issues

1. **Webhook verification fails**:
   - Check `STRIPE_WEBHOOK_SECRET` matches Stripe dashboard
   - Ensure raw body parsing for webhook endpoint

2. **Database connection fails**:
   - Verify `DATABASE_URL` format
   - Check SSL settings for production

3. **Transfers not working**:
   - Verify providers have completed Connect onboarding
   - Check provider `stripe_account_id` in database
   - Review Stripe Connect account status

### Testing

Test the service locally:

```bash
# Test health check
curl https://your-app.onrender.com/

# Test checkout creation
curl -X POST https://your-app.onrender.com/checkout \
  -H "Content-Type: application/json" \
  -d '{"providerId": "prov_123"}'

# Test manual transfer
curl -X POST https://your-app.onrender.com/admin/run-daily-transfers
```

## Support

For issues with:
- **Stripe integration**: Check Stripe documentation
- **Render deployment**: Check Render documentation  
- **Database issues**: Check your database provider's logs
