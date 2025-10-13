# Form Integration Guide - Exact Service Names

## 🎯 Your Form Fields → Payment Service

Your payment service database now contains **exact matches** for your form values. No mapping needed!

## 📋 Massage Length Field Values:
```
- "60 min · Mobile · $150"
- "90 min · Mobile · $200" 
- "60 min · In-Studio · $120"
- "90 min. - In-Studio - $170"
```

## 📋 Service Type Field Values:
```
- "Aromatherapy - $15"
- "Body Scrubs / Wraps - $40"
- "Hot Stones - $30"
- "Basic / Natural Makeup (daytime, casual events): $100"
- "Full Glam / Evening Makeup: $140"
- "Bridal Makeup (trial + day-of): $240"
- "Brow Shaping - $60"
- "Microblading (initial session) - $400"
- "Cupping Therapy - 45 min. – $100"
- "Facial 45 min. - $100"
- "Reflexology - 30 min. - $80"
- "Reflexology - 45 min. - $100"
- "Reflexology - 60 min. - $130"
- "Scalp Treatments - $15"
- "Personal Training - 30 minutes: $45"
- "Personal Training - 60 minutes: $70"
- "Nutritional Counseling - Follow-up sessions - 60 minutes: $60"
```

## 🔧 Integration Code (No Mapping Needed!):

### PHP/WordPress Integration:
```php
function send_payment_link_with_booking($provider_id, $booking_request) {
    // Get service type directly from form (exact match in database)
    $service_name = $booking_request['service_type']; // e.g., "60 min · Mobile · $150"
    
    // Call payment service with exact form value
    $response = wp_remote_post('https://your-payment-service.onrender.com/checkout', [
        'body' => json_encode([
            'providerId' => $provider_id,
            'serviceName' => $service_name, // Exact match - no conversion needed!
        ]),
        'headers' => ['Content-Type' => 'application/json']
    ]);
    
    if (!is_wp_error($response)) {
        $result = json_decode(wp_remote_retrieve_body($response), true);
        $payment_url = $result['url'];
        $amount = $result['amountCents'] / 100;
        
        // Send SMS
        $message = "Your {$service_name} is confirmed! Pay here: {$payment_url}";
        sendTextMagicSMS($booking_request['customer_phone'], $message);
        
        return [
            'success' => true,
            'payment_url' => $payment_url,
            'amount' => $amount,
            'service' => $service_name
        ];
    }
    
    return ['success' => false];
}
```

### Example Usage:
```php
// When provider accepts booking
$booking_request = [
    'service_type' => '60 min · Mobile · $150', // Exact form value
    'customer_phone' => '+1234567890',
    'customer_name' => 'John Doe',
    'provider_id' => 'therapist_123'
];

$result = send_payment_link_with_booking('therapist_123', $booking_request);

if ($result['success']) {
    echo "Payment link sent! Service: {$result['service']}, Amount: \${$result['amount']}";
}
```

## 📱 Customer SMS Examples:

**Massage Services:**
```
"Your 60 min · Mobile · $150 is confirmed! Pay here: https://checkout.stripe.com/..."
"Your 90 min · Mobile · $200 is confirmed! Pay here: https://checkout.stripe.com/..."
```

**Other Services:**
```
"Your Facial 45 min. - $100 is confirmed! Pay here: https://checkout.stripe.com/..."
"Your Bridal Makeup (trial + day-of): $240 is confirmed! Pay here: https://checkout.stripe.com/..."
```

## 🎯 Stripe Checkout Display:

**Customer sees exactly:**
```
60 min · Mobile · $150                    $150.00
Tip for your massage therapist             $0.00  [+ -]
                                         --------
Total                                    $150.00
```

## 💰 Pricing Breakdown:

### Massage Services:
- **60 min · Mobile · $150**: Customer pays $150 → Provider gets $100, You keep $50
- **90 min · Mobile · $200**: Customer pays $200 → Provider gets $130, You keep $70
- **60 min · In-Studio · $120**: Customer pays $120 → Provider gets $72, You keep $48
- **90 min. - In-Studio - $170**: Customer pays $170 → Provider gets $120, You keep $50

### Add-On Services (100% to Provider):
- **Aromatherapy - $15**: Customer pays $15 → Provider gets $15, You keep $0
- **Hot Stones - $30**: Customer pays $30 → Provider gets $30, You keep $0
- **Scalp Treatments - $15**: Customer pays $15 → Provider gets $15, You keep $0

### Other Services:
- **Facial 45 min. - $100**: Customer pays $100 → Provider gets $65, You keep $35
- **Microblading (initial session) - $400**: Customer pays $400 → Provider gets $260, You keep $140

## ✅ Benefits:

- **No mapping needed** - form values match database exactly
- **Automatic pricing** - payment service looks up correct amount
- **Tip support** - customers can add tips to any service
- **Provider payouts** - automatic daily transfers with tips included

**Just pass your form's `service_type` value directly to the payment service!** 🚀
