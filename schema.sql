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

-- Service pricing table
CREATE TABLE IF NOT EXISTS service_pricing (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(100) UNIQUE NOT NULL,
    total_amount_cents INTEGER NOT NULL,
    platform_fee_cents INTEGER NOT NULL,
    provider_cut_cents INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Gold Touch Massage actual pricing (matching exact form values)
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

ON CONFLICT (service_name) DO NOTHING;
