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
 * Create a new provider (helper function for testing/setup)
 */
export async function createProvider(email, id = null) {
  try {
    const result = await pool.query(`
      INSERT INTO providers (id, email, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (email) DO NOTHING
      RETURNING *
    `, [id || generateProviderId(), email]);

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
 * Initialize database tables (run this once during setup)
 */
export async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS providers (
        id VARCHAR(50) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
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
      CREATE INDEX IF NOT EXISTS idx_jobs_provider_date 
      ON jobs(provider_id, DATE(created_at))
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_status_date 
      ON jobs(status, DATE(created_at))
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
