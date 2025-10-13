/**
 * URL Shortener Service for goldtouchmobile.com
 * Creates short URLs to reduce SMS character count
 */

import { query } from './db.js';

/**
 * Generate a random short code
 */
function generateShortCode(length = 5) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create a shortened URL
 */
export async function createShortUrl(originalUrl, expiresHours = 24) {
  try {
    let shortCode;
    let attempts = 0;
    const maxAttempts = 10;

    // Find a unique short code
    do {
      shortCode = generateShortCode();
      attempts++;
      
      const existing = await query(
        'SELECT id FROM short_urls WHERE short_code = ?',
        [shortCode]
      );
      
      if (existing.length === 0) break;
      
      if (attempts >= maxAttempts) {
        shortCode = generateShortCode(6); // Use longer code if needed
        break;
      }
    } while (attempts < maxAttempts);

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiresHours);

    // Insert into database
    await query(
      `INSERT INTO short_urls (short_code, original_url, expires_at, created_at) 
       VALUES (?, ?, ?, ?)`,
      [shortCode, originalUrl, expiresAt.toISOString(), new Date().toISOString()]
    );

    // Return the shortened URL
    return `https://goldtouchmobile.com/s/${shortCode}`;

  } catch (error) {
    console.error('Error creating short URL:', error);
    // Return original URL if shortening fails
    return originalUrl;
  }
}

/**
 * Get original URL from short code
 */
export async function getOriginalUrl(shortCode) {
  try {
    const results = await query(
      `SELECT original_url, expires_at FROM short_urls 
       WHERE short_code = ? AND (expires_at IS NULL OR expires_at > ?)`,
      [shortCode, new Date().toISOString()]
    );

    if (results.length === 0) {
      return null; // URL not found or expired
    }

    // Increment click counter
    await query(
      'UPDATE short_urls SET clicks = clicks + 1 WHERE short_code = ?',
      [shortCode]
    );

    return results[0].original_url;

  } catch (error) {
    console.error('Error getting original URL:', error);
    return null;
  }
}

/**
 * Get URL statistics
 */
export async function getUrlStats(shortCode) {
  try {
    const results = await query(
      `SELECT short_code, original_url, clicks, created_at, expires_at 
       FROM short_urls WHERE short_code = ?`,
      [shortCode]
    );

    return results.length > 0 ? results[0] : null;

  } catch (error) {
    console.error('Error getting URL stats:', error);
    return null;
  }
}

/**
 * Clean up expired URLs (run periodically)
 */
export async function cleanupExpiredUrls() {
  try {
    const result = await query(
      'DELETE FROM short_urls WHERE expires_at IS NOT NULL AND expires_at < ?',
      [new Date().toISOString()]
    );

    console.log(`Cleaned up ${result.affectedRows} expired URLs`);
    return result.affectedRows;

  } catch (error) {
    console.error('Error cleaning up expired URLs:', error);
    return 0;
  }
}

/**
 * Initialize the short_urls table
 */
export async function initializeUrlShortenerTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS short_urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        short_code VARCHAR(10) UNIQUE NOT NULL,
        original_url TEXT NOT NULL,
        clicks INTEGER DEFAULT 0,
        created_at DATETIME NOT NULL,
        expires_at DATETIME NULL
      )
    `);

    // Create index for faster lookups
    await query(`
      CREATE INDEX IF NOT EXISTS idx_short_code ON short_urls(short_code)
    `);

    console.log('✅ URL shortener table initialized');
    return true;

  } catch (error) {
    console.error('❌ Error initializing URL shortener table:', error);
    return false;
  }
}
