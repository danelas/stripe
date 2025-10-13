# Add-Ons Integration Guide

## 🎯 Combining Services with Add-Ons

Your payment service now supports combining main services with add-ons to create bundled pricing.

## 📋 Example: Massage + Aromatherapy

### API Call:
```javascript
POST /checkout-with-sms
{
  "providerId": "therapist_123",
  "serviceName": "60 min · Mobile · $150",
  "addOns": ["Aromatherapy - $15"],
  "customerPhone": "+1234567890",
  "customerName": "John Doe",
  "providerName": "Sarah"
}
```

### Response:
```json
{
  "url": "https://checkout.stripe.com/c/pay/cs_xxx",
  "serviceName": "60 min · Mobile · $150 + Aromatherapy - $15",
  "amountCents": 16500,
  "breakdown": [
    {
      "name": "60 min · Mobile · $150",
      "amount": 15000,
      "platformFee": 5000,
      "providerCut": 10000
    },
    {
      "name": "Aromatherapy - $15", 
      "amount": 1500,
      "platformFee": 0,
      "providerCut": 1500
    }
  ],
  "totalServices": 2,
  "sms": {"success": true}
}
```

## 💰 Pricing Calculation:

**Customer Pays:** $165 ($150 + $15)
**Provider Gets:** $115 ($100 + $15) + tips
**You Keep:** $50 ($50 + $0)

## 📱 Customer Experience:

### SMS:
```
"Hi John Doe! Your 60 min · Mobile · $150 + Aromatherapy - $15 ($165.00) is confirmed. 
Pay after your massage here: https://checkout.stripe.com/..."
```

### Stripe Checkout:
```
60 min · Mobile · $150 + Aromatherapy - $15    $165.00
Tip for your massage therapist                   $0.00  [+ -]
                                               --------
Total                                          $165.00
```

## 🔧 Integration Examples:

### PHP/WordPress:
```php
function send_payment_with_addons($provider_id, $booking_request) {
    $main_service = $booking_request['service_type']; // e.g., "60 min · Mobile · $150"
    $add_ons = $booking_request['add_ons'] ?? []; // e.g., ["Aromatherapy - $15", "Hot Stones - $30"]
    
    $response = wp_remote_post('https://your-payment-service.onrender.com/checkout-with-sms', [
        'body' => json_encode([
            'providerId' => $provider_id,
            'serviceName' => $main_service,
            'addOns' => $add_ons,
            'customerPhone' => $booking_request['customer_phone'],
            'customerName' => $booking_request['customer_name'],
            'providerName' => get_provider_name($provider_id)
        ]),
        'headers' => ['Content-Type' => 'application/json']
    ]);
    
    if (!is_wp_error($response)) {
        $result = json_decode(wp_remote_retrieve_body($response), true);
        
        return [
            'success' => true,
            'payment_url' => $result['url'],
            'total_amount' => $result['amountCents'] / 100,
            'service_name' => $result['serviceName'],
            'breakdown' => $result['breakdown']
        ];
    }
    
    return ['success' => false];
}

// Usage examples:
$booking_request = [
    'service_type' => '60 min · Mobile · $150',
    'add_ons' => ['Aromatherapy - $15'],
    'customer_phone' => '+1234567890',
    'customer_name' => 'John Doe'
];

$result = send_payment_with_addons('therapist_123', $booking_request);
// Customer pays $165, provider gets $115 + tips
```

### Multiple Add-Ons:
```php
$booking_request = [
    'service_type' => '90 min · Mobile · $200',
    'add_ons' => [
        'Aromatherapy - $15',
        'Hot Stones - $30',
        'Scalp Treatments - $15'
    ],
    'customer_phone' => '+1234567890',
    'customer_name' => 'Jane Smith'
];

$result = send_payment_with_addons('therapist_456', $booking_request);
// Customer pays $260 ($200 + $15 + $30 + $15)
// Provider gets $200 ($130 + $15 + $30 + $15) + tips
// You keep $70 (only from main service)
```

## 🎯 Common Add-On Combinations:

### Relaxation Package:
```
Main: "60 min · Mobile · $150"
Add-ons: ["Aromatherapy - $15", "Hot Stones - $30"]
Total: $195
```

### Full Spa Experience:
```
Main: "90 min · Mobile · $200"
Add-ons: ["Aromatherapy - $15", "Hot Stones - $30", "Scalp Treatments - $15"]
Total: $260
```

### Beauty Package:
```
Main: "Facial 45 min. - $100"
Add-ons: ["Brow Shaping - $60"]
Total: $160
```

## 💡 Form Integration:

### HTML Form Example:
```html
<form id="booking-form">
    <!-- Main Service -->
    <select name="service_type" required>
        <option value="60 min · Mobile · $150">60 min Mobile Massage - $150</option>
        <option value="90 min · Mobile · $200">90 min Mobile Massage - $200</option>
        <option value="Facial 45 min. - $100">Facial 45 min - $100</option>
    </select>
    
    <!-- Add-Ons (Multiple Selection) -->
    <div class="add-ons">
        <h3>Add-Ons:</h3>
        <label><input type="checkbox" name="add_ons[]" value="Aromatherapy - $15"> Aromatherapy (+$15)</label>
        <label><input type="checkbox" name="add_ons[]" value="Hot Stones - $30"> Hot Stones (+$30)</label>
        <label><input type="checkbox" name="add_ons[]" value="Scalp Treatments - $15"> Scalp Treatment (+$15)</label>
        <label><input type="checkbox" name="add_ons[]" value="Body Scrubs / Wraps - $40"> Body Scrub (+$40)</label>
    </div>
    
    <button type="submit">Book Service</button>
</form>
```

### JavaScript Total Calculator:
```javascript
function calculateTotal() {
    const serviceSelect = document.querySelector('[name="service_type"]');
    const addOnCheckboxes = document.querySelectorAll('[name="add_ons[]"]:checked');
    
    // Extract price from service name (e.g., "$150" from "60 min · Mobile · $150")
    const servicePrice = parseFloat(serviceSelect.value.match(/\$(\d+)/)[1]);
    
    let addOnTotal = 0;
    addOnCheckboxes.forEach(checkbox => {
        const price = parseFloat(checkbox.value.match(/\$(\d+)/)[1]);
        addOnTotal += price;
    });
    
    const total = servicePrice + addOnTotal;
    document.getElementById('total-display').textContent = `Total: $${total}`;
}

// Update total when selections change
document.addEventListener('change', calculateTotal);
```

## ✅ Benefits:

- **Automatic Pricing** - No manual calculation needed
- **Proper Provider Cuts** - Each service maintains its own provider percentage
- **Tip Support** - Customers can tip on the total amount
- **Clean Display** - Combined service name in Stripe checkout
- **Accurate Payouts** - Daily transfers calculate correct provider cuts for each service

**Your customers can now easily add services and see the total price automatically!** 🚀💰
