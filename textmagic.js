import axios from 'axios';
import { createShortUrl } from './url-shortener.js';

/**
 * TextMagic SMS Service Integration
 * Handles sending SMS notifications for payment links and confirmations
 */

const TEXTMAGIC_API_URL = 'https://rest.textmagic.com/api/v2';

/**
 * Send SMS via your existing TextMagic system (API Bridge)
 */
async function sendSMS(phone, message) {
  try {
    if (!process.env.SMS_BRIDGE_URL) {
      console.warn('SMS Bridge URL not configured - using direct TextMagic');
      return await sendDirectTextMagic(phone, message);
    }

    // Clean phone number (remove spaces, dashes, etc.)
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    
    // Ensure phone starts with country code
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`;

    // Call your existing SMS system
    const response = await axios.post(process.env.SMS_BRIDGE_URL, {
      phone: formattedPhone,
      message: message,
      type: 'payment'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SMS_BRIDGE_TOKEN || ''}`
      }
    });

    console.log(`✅ SMS sent via bridge to ${formattedPhone}`);
    return { 
      success: true, 
      phone: formattedPhone,
      bridge: true
    };

  } catch (error) {
    console.error('❌ SMS Bridge error:', error.response?.data || error.message);
    return { 
      success: false, 
      error: error.response?.data?.message || error.message 
    };
  }
}

/**
 * Fallback: Send SMS directly via TextMagic (if you want to keep this option)
 */
async function sendDirectTextMagic(phone, message) {
  try {
    if (!process.env.TEXTMAGIC_USERNAME || !process.env.TEXTMAGIC_API_KEY) {
      console.warn('TextMagic credentials not configured - SMS not sent');
      return { success: false, error: 'TextMagic not configured' };
    }

    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+1${cleanPhone}`;

    const response = await axios.post(
      `${TEXTMAGIC_API_URL}/messages`,
      {
        text: message,
        phones: formattedPhone
      },
      {
        auth: {
          username: process.env.TEXTMAGIC_USERNAME,
          password: process.env.TEXTMAGIC_API_KEY
        },
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`✅ SMS sent directly to ${formattedPhone}: ${response.data.id}`);
    return { 
      success: true, 
      messageId: response.data.id,
      phone: formattedPhone 
    };

  } catch (error) {
    console.error('❌ TextMagic direct SMS error:', error.response?.data || error.message);
    return { 
      success: false, 
      error: error.response?.data?.message || error.message 
    };
  }
}

/**
 * Send payment link SMS to customer
 */
export async function sendPaymentLinkSMS(customerPhone, paymentUrl, options = {}) {
  const {
    customerName = 'Customer',
    serviceName = 'Mobile Massage Service',
    amount = '',
    providerName = 'your massage therapist'
  } = options;

  try {
    // Create shortened URL to save characters
    const shortUrl = await createShortUrl(paymentUrl, 24); // Expires in 24 hours
    
    // Create concise message to stay under character limit
    const amountText = amount ? ` $${(amount / 100).toFixed(2)}` : '';
    
    // Shortened message template
    const message = `Hi ${customerName}! ${serviceName}${amountText} confirmed. Pay: ${shortUrl}`;
    
    // Check message length and truncate if needed
    if (message.length > 400) {
      const fallbackMessage = `Payment${amountText}: ${shortUrl}`;
      console.log(`⚠️  Message too long (${message.length} chars), using fallback (${fallbackMessage.length} chars)`);
      return await sendSMS(customerPhone, fallbackMessage);
    }
    
    console.log(`📱 SMS (${message.length} chars): ${message}`);
    return await sendSMS(customerPhone, message);
    
  } catch (error) {
    console.error('Error in sendPaymentLinkSMS:', error);
    // Fallback to original URL if shortening fails
    const fallbackMessage = `Payment link: ${paymentUrl}`;
    return await sendSMS(customerPhone, fallbackMessage);
  }
}

/**
 * Send payment confirmation SMS to customer
 */
export async function sendPaymentConfirmationSMS(customerPhone, options = {}) {
  const {
    customerName = 'Customer',
    serviceName = 'Mobile Massage Service',
    amount = '',
    providerName = 'your massage therapist'
  } = options;

  const amountText = amount ? ` of $${(amount / 100).toFixed(2)}` : '';
  
  const message = `Thank you ${customerName}! Your payment${amountText} for ${serviceName} has been processed successfully. 

From ${providerName}`;

  return await sendSMS(customerPhone, message);
}

/**
 * Send provider notification SMS
 */
export async function sendProviderNotificationSMS(providerPhone, options = {}) {
  const {
    customerName = 'Customer',
    serviceName = 'Mobile Massage Service',
    amount = '',
    transferDate = 'today'
  } = options;

  const amountText = amount ? ` $${(amount / 100).toFixed(2)}` : '';
  
  const message = `Payment received! ${customerName} paid${amountText} for ${serviceName}. Your payout will be transferred ${transferDate}.`;

  return await sendSMS(providerPhone, message);
}

/**
 * Send daily transfer notification to provider
 */
export async function sendTransferNotificationSMS(providerPhone, options = {}) {
  const {
    totalAmount = 0,
    jobCount = 0,
    transferId = ''
  } = options;

  const message = `Daily payout processed! $${(totalAmount / 100).toFixed(2)} from ${jobCount} job(s) has been transferred to your account. Transfer ID: ${transferId}`;

  return await sendSMS(providerPhone, message);
}

/**
 * Test SMS functionality
 */
export async function testSMS(phone) {
  const message = `Test message from your Stripe Payment Service. SMS integration is working! Time: ${new Date().toLocaleString()}`;
  return await sendSMS(phone, message);
}
