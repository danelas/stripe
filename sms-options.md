# SMS Integration Options

Since you already have a TextMagic account for booking/provider SMS, here are your options:

## Option 1: API Bridge (Recommended) ✅

**Set up an endpoint in your existing booking system:**

```php
// In your current booking/provider SMS system
Route::post('/api/send-payment-sms', function(Request $request) {
    $phone = $request->phone;
    $message = $request->message;
    $type = $request->type; // 'payment', 'confirmation', etc.
    
    // Use your existing TextMagic setup
    $result = sendTextMagicSMS($phone, $message);
    
    return response()->json(['success' => true, 'result' => $result]);
});
```

**Configure payment service to use your existing system:**
```bash
# In your payment service .env
SMS_BRIDGE_URL=https://your-booking-system.com/api/send-payment-sms
SMS_BRIDGE_TOKEN=optional_security_token
```

## Option 2: Webhook Integration

**Your booking system listens for payment webhooks:**

```php
// In your booking system - listen for payment events
Route::post('/webhooks/payment-completed', function(Request $request) {
    $customerPhone = $request->customer_phone;
    $paymentUrl = $request->payment_url;
    $customerName = $request->customer_name;
    
    $message = "Hi {$customerName}! Payment link: {$paymentUrl}";
    sendTextMagicSMS($customerPhone, $message);
    
    return response()->json(['success' => true]);
});
```

**Payment service calls your webhook:**
```javascript
// After creating checkout session
await axios.post('https://your-booking-system.com/webhooks/payment-completed', {
    customer_phone: customerPhone,
    payment_url: checkoutUrl,
    customer_name: customerName
});
```

## Option 3: Remove SMS from Payment Service

Keep payment processing separate from SMS. Your booking system handles all SMS, payment service only handles Stripe.

**Workflow:**
1. Booking system creates appointment
2. Booking system calls payment service for checkout URL
3. Booking system sends SMS with payment link
4. Customer pays
5. Payment service processes payment
6. Booking system gets notified and sends confirmation SMS

## Option 4: Shared Database

Both systems use the same database to coordinate SMS sending.

**Payment service writes to shared table:**
```sql
INSERT INTO sms_queue (phone, message, type, status) 
VALUES ('+1234567890', 'Payment link: https://...', 'payment', 'pending');
```

**Booking system processes SMS queue:**
```php
$pendingSMS = DB::table('sms_queue')->where('status', 'pending')->get();
foreach($pendingSMS as $sms) {
    sendTextMagicSMS($sms->phone, $sms->message);
    DB::table('sms_queue')->where('id', $sms->id)->update(['status' => 'sent']);
}
```

## Recommendation

**Use Option 1 (API Bridge)** - it's the cleanest and keeps your existing TextMagic setup intact while allowing the payment service to trigger SMS when needed.

Just add one endpoint to your existing system and configure the payment service to call it!
