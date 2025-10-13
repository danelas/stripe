# Integration with Your Existing Booking System

## Step 1: Add SMS Endpoint to Your Booking System

Add this endpoint to your existing booking/provider system (the one with TextMagic):

### If using PHP/Laravel:
```php
// Add to your routes/api.php or similar
Route::post('/api/send-payment-sms', function(Request $request) {
    try {
        $phone = $request->input('phone');
        $message = $request->input('message');
        $type = $request->input('type', 'payment');
        
        // Validate required fields
        if (!$phone || !$message) {
            return response()->json(['success' => false, 'error' => 'Phone and message required'], 400);
        }
        
        // Use your existing TextMagic function/class
        $result = sendTextMagicSMS($phone, $message); // Your existing function
        
        return response()->json([
            'success' => true, 
            'phone' => $phone,
            'type' => $type,
            'message_sent' => true
        ]);
        
    } catch (Exception $e) {
        return response()->json([
            'success' => false, 
            'error' => $e->getMessage()
        ], 500);
    }
});
```

### If using WordPress:
```php
// Add to your theme's functions.php or plugin
add_action('rest_api_init', function() {
    register_rest_route('booking/v1', '/send-payment-sms', array(
        'methods' => 'POST',
        'callback' => 'handle_payment_sms',
        'permission_callback' => '__return_true' // Add proper auth if needed
    ));
});

function handle_payment_sms($request) {
    $phone = $request->get_param('phone');
    $message = $request->get_param('message');
    $type = $request->get_param('type');
    
    if (!$phone || !$message) {
        return new WP_Error('missing_params', 'Phone and message required', array('status' => 400));
    }
    
    // Use your existing TextMagic function
    $result = send_textmagic_sms($phone, $message); // Your existing function
    
    return array(
        'success' => true,
        'phone' => $phone,
        'type' => $type,
        'message_sent' => true
    );
}
```

### If using Node.js/Express:
```javascript
// Add to your existing booking system
app.post('/api/send-payment-sms', async (req, res) => {
    try {
        const { phone, message, type = 'payment' } = req.body;
        
        if (!phone || !message) {
            return res.status(400).json({ success: false, error: 'Phone and message required' });
        }
        
        // Use your existing TextMagic function
        const result = await sendTextMagicSMS(phone, message); // Your existing function
        
        res.json({
            success: true,
            phone: phone,
            type: type,
            message_sent: true
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
```

## Step 2: Configure Payment Service

Set these environment variables in your Render payment service:

```bash
SMS_BRIDGE_URL=https://your-booking-system.com/api/send-payment-sms
SMS_BRIDGE_TOKEN=optional_security_token_if_you_want
```

## Step 3: Test the Integration

### Test from payment service:
```bash
curl -X POST https://your-payment-service.onrender.com/admin/test-sms \
  -H "Content-Type: application/json" \
  -d '{"phone": "+1234567890"}'
```

### Test direct to your booking system:
```bash
curl -X POST https://your-booking-system.com/api/send-payment-sms \
  -H "Content-Type: application/json" \
  -d '{"phone": "+1234567890", "message": "Test message", "type": "test"}'
```

## Step 4: Usage Examples

### Generate payment link with SMS:
```javascript
const response = await fetch('https://your-payment-service.onrender.com/checkout-with-sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        providerId: 'therapist_123',
        customerPhone: '+1234567890',
        customerName: 'John Doe',
        productName: 'Mobile Massage 60min',
        amountCents: 17000,
        providerName: 'Sarah\'s Massage'
    })
});
```

### From your WordPress booking system:
```php
function send_payment_link_after_massage($provider_id, $customer_phone, $customer_name) {
    // Call payment service to generate link and send SMS
    $response = wp_remote_post('https://your-payment-service.onrender.com/checkout-with-sms', [
        'body' => json_encode([
            'providerId' => $provider_id,
            'customerPhone' => $customer_phone,
            'customerName' => $customer_name,
            'productName' => 'Mobile Massage Service',
            'amountCents' => 17000,
            'providerName' => get_provider_name($provider_id)
        ]),
        'headers' => ['Content-Type' => 'application/json']
    ]);
    
    return json_decode(wp_remote_retrieve_body($response), true);
}
```

## Security (Optional)

If you want to secure the SMS endpoint, add a token:

```php
// In your booking system endpoint
$token = $request->header('Authorization');
if ($token !== 'Bearer your_secret_token') {
    return response()->json(['error' => 'Unauthorized'], 401);
}
```

Then set in payment service:
```bash
SMS_BRIDGE_TOKEN=your_secret_token
```

## That's It! 🎉

Your payment service will now use your existing TextMagic setup through the API bridge. The payment service handles Stripe, your booking system handles SMS - clean separation!
