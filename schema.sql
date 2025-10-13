-- Database schema for Stripe Payment Service
-- Run this SQL to set up your database tables

-- Providers table
CREATE TABLE IF NOT EXISTS providers (
    id VARCHAR(50) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    stripe_account_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Jobs table (tracks payments and transfers)
CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(100) PRIMARY KEY, -- Stripe checkout session ID
    provider_id VARCHAR(50) NOT NULL REFERENCES providers(id),
    amount_cents INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, paid, transferred
    payment_intent_id VARCHAR(100),
    transfer_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_jobs_provider_date 
ON jobs(provider_id, DATE(created_at));

CREATE INDEX IF NOT EXISTS idx_jobs_status_date 
ON jobs(status, DATE(created_at));

CREATE INDEX IF NOT EXISTS idx_jobs_transfer_id 
ON jobs(transfer_id);

-- Example data (optional - remove in production)
-- INSERT INTO providers (id, email) VALUES 
-- ('prov_123', 'provider1@example.com'),
-- ('prov_456', 'provider2@example.com');
