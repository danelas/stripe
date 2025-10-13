# Integration Guide for Your Main SMS/Booking System

## 🎯 Overview
Your main system will call the payment service to:
1. **Sync existing providers** (one-time)
2. **Create new providers** (ongoing)
3. **Send payment links** (after each massage)

## 📋 Step 1: One-Time Provider Sync

### Bulk sync all your existing providers:

**PHP/WordPress Example:**
```php
function sync_all_providers_to_payment_service() {
    // Get all providers from your main database
    $providers = get_all_providers_from_main_db(); // Your existing function
    
    $payment_providers = [];
    foreach ($providers as $provider) {
        $payment_providers[] = [
            'id' => $provider->id,
            'email' => $provider->email,
            'name' => $provider->name,
            'phone' => $provider->phone
        ];
    }
    
    // Send to payment service
    $response = wp_remote_post('https://your-payment-service.onrender.com/admin/sync-providers', [
        'body' => json_encode(['providers' => $payment_providers]),
        'headers' => ['Content-Type' => 'application/json'],
        'timeout' => 60
    ]);
    
    if (!is_wp_error($response)) {
        $result = json_decode(wp_remote_retrieve_body($response), true);
        error_log("Provider sync result: " . print_r($result, true));
        return $result;
    }
    
    return false;
}

// Run this once after payment service is deployed
sync_all_providers_to_payment_service();
```

## 📋 Step 2: Modify Your Provider Creation

### Update your existing provider creation function:

**PHP/WordPress Example:**
```php
function create_new_provider($name, $email, $phone) {
    // 1. Create in your main database (existing code)
    $provider_id = create_provider_in_main_db($name, $email, $phone);
    
    // 2. Also sync to payment service (NEW)
    sync_provider_to_payment_service($provider_id, $name, $email, $phone);
    
    return $provider_id;
}

function sync_provider_to_payment_service($provider_id, $name, $email, $phone) {
    $response = wp_remote_post('https://your-payment-service.onrender.com/admin/create-provider', [
        'body' => json_encode([
            'id' => $provider_id,
            'email' => $email,
            'name' => $name,
            'phone' => $phone
        ]),
        'headers' => ['Content-Type' => 'application/json']
    ]);
    
    if (is_wp_error($response)) {
        error_log("Failed to sync provider to payment service: " . $response->get_error_message());
    } else {
        error_log("Provider {$provider_id} synced to payment service successfully");
    }
}
```

## 📋 Step 3: Send Payment Links After Massage

### Add payment link function:

**PHP/WordPress Example:**
```php
function send_payment_link_after_massage($provider_id, $customer_phone, $customer_name, $service_name) {
    $response = wp_remote_post('https://your-payment-service.onrender.com/checkout-with-sms', [
        'body' => json_encode([
            'providerId' => $provider_id,
            'serviceName' => $service_name, // e.g., "60 min Mobile Massage"
            'customerPhone' => $customer_phone,
            'customerName' => $customer_name,
            'providerName' => get_provider_name($provider_id) // Your existing function
        ]),
        'headers' => ['Content-Type' => 'application/json']
    ]);
    
    if (!is_wp_error($response)) {
        $result = json_decode(wp_remote_retrieve_body($response), true);
        
        if ($result['sms']['success']) {
            error_log("Payment link sent to {$customer_phone} for {$service_name}");
            return [
                'success' => true,
                'payment_url' => $result['url'],
                'amount' => $result['amountCents'] / 100
            ];
        }
    }
    
    error_log("Failed to send payment link: " . print_r($response, true));
    return ['success' => false];
}

// Usage examples:
send_payment_link_after_massage('therapist_123', '+1234567890', 'John Doe', '60 min Mobile Massage');
send_payment_link_after_massage('therapist_456', '+1987654321', 'Jane Smith', 'Facial 45 min');
```

## 📋 Step 4: Provider Stripe Onboarding

### Generate onboarding links for providers:

**PHP/WordPress Example:**
```php
function get_provider_stripe_onboarding_link($provider_id) {
    $response = wp_remote_post('https://your-payment-service.onrender.com/provider/account-link', [
        'body' => json_encode(['providerId' => $provider_id]),
        'headers' => ['Content-Type' => 'application/json']
    ]);
    
    if (!is_wp_error($response)) {
        $result = json_decode(wp_remote_retrieve_body($response), true);
        return $result['url']; // Stripe Connect onboarding URL
    }
    
    return false;
}

// Usage in provider dashboard:
$onboarding_url = get_provider_stripe_onboarding_link('therapist_123');
if ($onboarding_url) {
    echo '<a href="' . $onboarding_url . '" target="_blank" class="button">Complete Stripe Setup</a>';
}
```

## 📋 Step 5: Admin Dashboard Integration

### Add admin functions to your dashboard:

**PHP/WordPress Example:**
```php
// Admin page to manually send payment links
function admin_send_payment_link_form() {
    if ($_POST['send_payment_link']) {
        $result = send_payment_link_after_massage(
            $_POST['provider_id'],
            $_POST['customer_phone'], 
            $_POST['customer_name'],
            $_POST['service_name']
        );
        
        if ($result['success']) {
            echo '<div class="notice notice-success"><p>Payment link sent! Amount: $' . $result['amount'] . '</p></div>';
        } else {
            echo '<div class="notice notice-error"><p>Failed to send payment link</p></div>';
        }
    }
    ?>
    
    <form method="post">
        <table class="form-table">
            <tr>
                <th>Provider</th>
                <td>
                    <select name="provider_id" required>
                        <?php foreach (get_all_providers() as $provider): ?>
                            <option value="<?= $provider->id ?>"><?= $provider->name ?></option>
                        <?php endforeach; ?>
                    </select>
                </td>
            </tr>
            <tr>
                <th>Customer Phone</th>
                <td><input type="tel" name="customer_phone" required placeholder="+1234567890"></td>
            </tr>
            <tr>
                <th>Customer Name</th>
                <td><input type="text" name="customer_name" required></td>
            </tr>
            <tr>
                <th>Service</th>
                <td>
                    <select name="service_name" required>
                        <option value="60 min Mobile Massage">60 min Mobile Massage - $150</option>
                        <option value="90 min Mobile Massage">90 min Mobile Massage - $200</option>
                        <option value="60 min In-Studio Massage">60 min In-Studio Massage - $120</option>
                        <option value="90 min In-Studio Massage">90 min In-Studio Massage - $170</option>
                        <option value="Reflexology 60 min">Reflexology 60 min - $150</option>
                        <option value="Facial 45 min">Facial 45 min - $100</option>
                        <!-- Add all your services -->
                    </select>
                </td>
            </tr>
        </table>
        
        <input type="submit" name="send_payment_link" value="Send Payment Link" class="button button-primary">
    </form>
    <?php
}
```

## 🔧 Testing

### Test the integration:

```php
// Test provider sync
$test_result = sync_provider_to_payment_service('test_123', 'Test Provider', 'test@email.com', '+1234567890');

// Test payment link
$payment_result = send_payment_link_after_massage('test_123', '+1234567890', 'Test Customer', '60 min Mobile Massage');

// Check results
var_dump($test_result, $payment_result);
```

## 🎯 Summary

After implementing this:

1. **All existing providers** → Synced to payment service
2. **New providers** → Automatically synced when created
3. **Payment links** → Sent via one function call
4. **Provider onboarding** → Generate Stripe links easily
5. **Admin dashboard** → Manual payment link sending

**Your main system stays in control, payment service handles Stripe!** 🚀
