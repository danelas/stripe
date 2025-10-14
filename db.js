import pg from "pg";

const { Pool } = pg;

// Create connection pool optimized for Render PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false,
  // Render-optimized connection pool settings
  max: 10, // Render starter plan limit
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  acquireTimeoutMillis: 10000,
});

// Test database connection on startup
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Database connected successfully');
    await client.query('SELECT NOW()');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    // Don't throw error on startup - let the app start and retry connections
    return false;
  }
}

// Test connection but don't block startup
testConnection();

/**
 * Get provider by ID
 */
export async function getProviderById(id) {
  try {
    const result = await pool.query(
      'SELECT id, email, stripe_account_id, created_at FROM providers WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting provider by ID:', error);
    throw error;
  }
}

/**
 * Get all providers
 */
export async function getAllProviders() {
  try {
    const result = await pool.query(
      'SELECT id, email, name, phone, stripe_account_id, created_at FROM providers ORDER BY id'
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting all providers:', error);
    throw error;
  }
}

/**
 * Ensure a Stripe Connect account exists for the provider
 */
export async function ensureConnectAccount(provider) {
  try {
    // If provider already has a Stripe account, return it
    if (provider.stripe_account_id) {
      return provider.stripe_account_id;
    }

    // Create a new Stripe Connect account
    const stripe = (await import('./stripe.js')).default || 
                   (await import('stripe')).default(process.env.STRIPE_SECRET);
    
    const account = await stripe.accounts.create({
      type: 'express',
      email: provider.email,
      metadata: {
        provider_id: provider.id
      }
    });

    // Save the account ID to the database
    await pool.query(
      'UPDATE providers SET stripe_account_id = $1, updated_at = NOW() WHERE id = $2',
      [account.id, provider.id]
    );

    console.log(`Created Stripe Connect account ${account.id} for provider ${provider.id}`);
    return account.id;
  } catch (error) {
    console.error('Error ensuring Connect account:', error);
    throw error;
  }
}

/**
 * Insert or update a job record
 */
export async function upsertJob(job) {
  try {
    const result = await pool.query(`
      INSERT INTO jobs (id, provider_id, amount_cents, status, payment_intent_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) 
      DO UPDATE SET 
        status = EXCLUDED.status,
        payment_intent_id = EXCLUDED.payment_intent_id,
        updated_at = NOW()
      RETURNING *
    `, [
      job.id,
      job.providerId,
      job.amountCents,
      job.status,
      job.paymentIntentId,
      job.createdAt || new Date()
    ]);

    console.log(`Upserted job ${job.id} for provider ${job.providerId}`);
    return result.rows[0];
  } catch (error) {
    console.error('Error upserting job:', error);
    throw error;
  }
}

/**
 * List paid jobs for a specific date
 */
export async function listPaidJobsForDate(date) {
  try {
    const result = await pool.query(`
      SELECT id, provider_id as "providerId", amount_cents, status, payment_intent_id, created_at
      FROM jobs 
      WHERE status = 'paid' 
        AND DATE(created_at AT TIME ZONE $2) = $1
        AND transfer_id IS NULL
      ORDER BY created_at ASC
    `, [date, process.env.TIMEZONE || 'America/New_York']);

    return result.rows;
  } catch (error) {
    console.error('Error listing paid jobs for date:', error);
    throw error;
  }
}

/**
 * Mark jobs as transferred
 */
export async function markJobsTransferred(providerId, date, transferId) {
  try {
    const result = await pool.query(`
      UPDATE jobs 
      SET 
        status = 'transferred',
        transfer_id = $3,
        updated_at = NOW()
      WHERE provider_id = $1 
        AND DATE(created_at AT TIME ZONE $4) = $2
        AND status = 'paid'
        AND transfer_id IS NULL
      RETURNING id
    `, [providerId, date, transferId, process.env.TIMEZONE || 'America/New_York']);

    console.log(`Marked ${result.rows.length} jobs as transferred for provider ${providerId}`);
    return result.rows.length;
  } catch (error) {
    console.error('Error marking jobs as transferred:', error);
    throw error;
  }
}

/**
 * Create a new provider (with full details)
 */
export async function createProvider(email, id = null, name = null, phone = null) {
  try {
    const providerId = id || generateProviderId();
    
    const result = await pool.query(`
      INSERT INTO providers (id, email, name, phone, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id) 
      DO UPDATE SET 
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        updated_at = NOW()
      RETURNING *
    `, [providerId, email, name, phone]);

    console.log(`Created/updated provider ${providerId}: ${name || email}`);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating provider:', error);
    throw error;
  }
}

/**
 * Get job statistics for a provider
 */
export async function getProviderStats(providerId, startDate = null, endDate = null) {
  try {
    let query = `
      SELECT 
        COUNT(*) as total_jobs,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_jobs,
        COUNT(CASE WHEN status = 'transferred' THEN 1 END) as transferred_jobs,
        SUM(amount_cents) as total_amount_cents,
        SUM(CASE WHEN status = 'transferred' THEN amount_cents ELSE 0 END) as transferred_amount_cents
      FROM jobs 
      WHERE provider_id = $1
    `;
    
    const params = [providerId];
    
    if (startDate) {
      query += ` AND created_at >= $${params.length + 1}`;
      params.push(startDate);
    }
    
    if (endDate) {
      query += ` AND created_at <= $${params.length + 1}`;
      params.push(endDate);
    }

    const result = await pool.query(query, params);
    return result.rows[0];
  } catch (error) {
    console.error('Error getting provider stats:', error);
    throw error;
  }
}

/**
 * Helper function to generate provider ID
 */
function generateProviderId() {
  return 'prov_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Normalize service name for fuzzy matching
 */
function normalizeServiceName(serviceName) {
  if (!serviceName) return '';
  
  return serviceName
    // Normalize bullet points: · • ● ◦ → ·
    .replace(/[·•●◦]/g, '·')
    // Normalize dashes: – — - → -
    .replace(/[–—]/g, '-')
    // Normalize quotes: " " ' ' → " '
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    // Normalize spaces (remove extra spaces)
    .replace(/\s+/g, ' ')
    // Trim whitespace
    .trim()
    // Convert to lowercase for comparison
    .toLowerCase();
}

/**
 * Get service pricing by name with fuzzy matching
 */
export async function getServicePricing(serviceName) {
  try {
    // First try exact match
    let result = await pool.query(
      'SELECT * FROM service_pricing WHERE service_name = $1',
      [serviceName]
    );
    
    if (result.rows.length > 0) {
      console.log(`✅ Exact match found for: "${serviceName}"`);
      return result.rows[0];
    }
    
    // If no exact match, try fuzzy matching
    console.log(`⚠️ No exact match for: "${serviceName}", trying fuzzy match...`);
    
    const normalizedSearch = normalizeServiceName(serviceName);
    console.log(`Normalized search: "${normalizedSearch}"`);
    
    // Get all services and find fuzzy match
    const allServices = await pool.query('SELECT * FROM service_pricing');
    
    for (const service of allServices.rows) {
      const normalizedService = normalizeServiceName(service.service_name);
      
      if (normalizedService === normalizedSearch) {
        console.log(`✅ Fuzzy match found: "${service.service_name}" matches "${serviceName}"`);
        return service;
      }
    }
    
    // If still no match, show available options
    console.log(`❌ No match found for: "${serviceName}"`);
    console.log(`Available services:`);
    allServices.rows.forEach(s => {
      console.log(`  - "${s.service_name}"`);
    });
    
    return null;
  } catch (error) {
    console.error('Error getting service pricing:', error);
    throw error;
  }
}

/**
 * Get all service pricing
 */
export async function getAllServicePricing() {
  try {
    const result = await pool.query(
      'SELECT * FROM service_pricing ORDER BY service_name'
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting all service pricing:', error);
    throw error;
  }
}

/**
 * Update or create service pricing
 */
export async function upsertServicePricing(serviceName, totalAmountCents, platformFeeCents, providerCutCents) {
  try {
    const result = await pool.query(`
      INSERT INTO service_pricing (service_name, total_amount_cents, platform_fee_cents, provider_cut_cents)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (service_name) 
      DO UPDATE SET 
        total_amount_cents = EXCLUDED.total_amount_cents,
        platform_fee_cents = EXCLUDED.platform_fee_cents,
        provider_cut_cents = EXCLUDED.provider_cut_cents,
        updated_at = NOW()
      RETURNING *
    `, [serviceName, totalAmountCents, platformFeeCents, providerCutCents]);

    console.log(`Updated pricing for ${serviceName}`);
    return result.rows[0];
  } catch (error) {
    console.error('Error upserting service pricing:', error);
    throw error;
  }
}

/**
 * Initialize database tables (run this once during setup)
 */
export async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS providers (
        id VARCHAR(50) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        phone VARCHAR(20),
        stripe_account_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id VARCHAR(100) PRIMARY KEY,
        provider_id VARCHAR(50) NOT NULL REFERENCES providers(id),
        amount_cents INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        payment_intent_id VARCHAR(100),
        transfer_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_pricing (
        id SERIAL PRIMARY KEY,
        service_name VARCHAR(100) UNIQUE NOT NULL,
        total_amount_cents INTEGER NOT NULL,
        platform_fee_cents INTEGER NOT NULL,
        provider_cut_cents INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_provider_date 
      ON jobs(provider_id, DATE(created_at))
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_status_date 
      ON jobs(status, DATE(created_at))
    `);

    // Insert Gold Touch Massage actual pricing (matching exact form values)
    await pool.query(`
      INSERT INTO service_pricing (service_name, total_amount_cents, platform_fee_cents, provider_cut_cents) VALUES 
      -- Massage Services (from Massage Length field)
      ('60 min · Mobile · $150', 15000, 5000, 10000),
      ('90 min · Mobile · $200', 20000, 7000, 13000),
      ('60 min · In-Studio · $120', 12000, 4800, 7200),
      ('90 min. - In-Studio - $170', 17000, 5000, 12000),
      
      -- Reflexology Services
      ('Reflexology - 30 min. - $80', 8000, 2800, 5200),
      ('Reflexology - 45 min. - $100', 10000, 3500, 6500),
      ('Reflexology - 60 min. - $130', 13000, 4500, 8500),
      
      -- Wellness & Add-On Services
      ('Aromatherapy - $15', 1500, 0, 1500),
      ('Scalp Treatments - $15', 1500, 0, 1500),
      ('Hot Stones - $30', 3000, 0, 3000),
      ('Body Scrubs / Wraps - $40', 4000, 1000, 3000),
      ('Cupping Therapy - 45 min. – $100', 10000, 3500, 6500),
      
      -- Personal Training
      ('Personal Training - 30 minutes: $45', 4500, 2250, 2250),
      ('Personal Training - 60 minutes: $70', 7000, 3500, 3500),
      
      -- Nutritional Counseling
      ('Nutritional Counseling - Follow-up sessions - 60 minutes: $60', 6000, 3000, 3000),
      
      -- Facials & Makeup Services
      ('Facial 45 min. - $100', 10000, 3500, 6500),
      ('Basic / Natural Makeup (daytime, casual events): $100', 10000, 3500, 6500),
      ('Full Glam / Evening Makeup: $140', 14000, 5000, 9000),
      ('Bridal Makeup (trial + day-of): $240', 24000, 8000, 16000),
      ('Brow Shaping - $60', 6000, 2000, 4000),
      ('Microblading (initial session) - $400', 40000, 14000, 26000)
      
      ON CONFLICT (service_name) DO NOTHING
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing database pool...');
  await pool.end();
  process.exit(0);
});
