/**
 * Initialize Lead Generation Database
 * Run this script to set up the lead generation tables
 */

import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initializeLeadDatabase() {
  try {
    console.log('🚀 Initializing Lead Generation Database...');

    // Read SQL file
    const sqlPath = path.join(__dirname, 'lead-generation.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Execute SQL
    await pool.query(sql);

    console.log('✅ Lead Generation Database initialized successfully!');
    console.log('📊 Tables created:');
    console.log('   - leads');
    console.log('   - lead_interactions');
    console.log('   - provider_optouts');
    console.log('   - lead_config');
    console.log('🎯 Ready to process lead generation requests!');

  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeLeadDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { initializeLeadDatabase };
