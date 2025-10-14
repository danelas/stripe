/**
 * URL Shortener Service for goldtouchmobile.com
 * Creates short URLs to reduce SMS character count
 */

import pg from 'pg';
const { Pool } = pg;

// Use the same database pool as the main app
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false,
});

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
      
      const existing = await pool.query(
        'SELECT id FROM short_urls WHERE short_code = $1',
        [shortCode]
      );
      
      if (existing.rows.length === 0) break;
      
      if (attempts >= maxAttempts) {
        shortCode = generateShortCode(6); // Use longer code if needed
        break;
      }
    } while (attempts < maxAttempts);

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiresHours);

    // Insert into database
    await pool.query(
      `INSERT INTO short_urls (short_code, original_url, expires_at, created_at) 
       VALUES ($1, $2, $3, $4)`,
      [shortCode, originalUrl, expiresAt.toISOString(), new Date().toISOString()]
    );

    // Return the shortened URL
    return `https://stripe-45lh.onrender.com/s/${shortCode}`;

  } catch (error) {
    console.error('Error creating short URL:', error);
    
    // If table doesn't exist, suggest initialization
    if (error.code === '42P01') {
      console.error('❌ short_urls table does not exist. Please call /admin/init-database endpoint first.');
    }
    
    // Return original URL if shortening fails
    console.log('⚠️  Falling back to original URL due to shortener error');
    return originalUrl;
  }
}

/**
 * Get original URL from short code
 */
export async function getOriginalUrl(shortCode) {
  try {
    const results = await pool.query(
      `SELECT original_url, expires_at FROM short_urls 
       WHERE short_code = $1 AND (expires_at IS NULL OR expires_at > $2)`,
      [shortCode, new Date().toISOString()]
    );

    if (results.rows.length === 0) {
      return null; // URL not found or expired
    }

    // Increment click counter
    await pool.query(
      'UPDATE short_urls SET clicks = clicks + 1 WHERE short_code = $1',
      [shortCode]
    );

    return results.rows[0].original_url;

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
    const results = await pool.query(
      `SELECT short_code, original_url, clicks, created_at, expires_at 
       FROM short_urls WHERE short_code = $1`,
      [shortCode]
    );

    return results.rows.length > 0 ? results.rows[0] : null;

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
    const result = await pool.query(
      'DELETE FROM short_urls WHERE expires_at IS NOT NULL AND expires_at < $1',
      [new Date().toISOString()]
    );

    console.log(`Cleaned up ${result.rowCount} expired URLs`);
    return result.rowCount;

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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS short_urls (
        id SERIAL PRIMARY KEY,
        short_code VARCHAR(10) UNIQUE NOT NULL,
        original_url TEXT NOT NULL,
        clicks INTEGER DEFAULT 0,
        created_at TIMESTAMP NOT NULL,
        expires_at TIMESTAMP NULL
      )
    `);

    // Create index for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_short_code ON short_urls(short_code)
    `);

    console.log('✅ URL shortener table initialized');
    return true;

  } catch (error) {
    console.error('❌ Error initializing URL shortener table:', error);
    return false;
  }
}
