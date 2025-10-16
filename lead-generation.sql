-- Lead Generation Database Schema
-- Gold Touch Lead Generation Service

-- Leads table - stores client inquiries
CREATE TABLE IF NOT EXISTS leads (
    lead_id VARCHAR(50) PRIMARY KEY,
    
    -- Non-identifying fields (always visible)
    city VARCHAR(100) NOT NULL,
    service_type VARCHAR(200) NOT NULL,
    preferred_time_window VARCHAR(100),
    budget_range VARCHAR(50),
    notes_snippet VARCHAR(160), -- Max 160 chars, PII stripped
    
    -- Locked PII fields (only revealed after payment)
    client_name VARCHAR(200) NOT NULL,
    client_phone VARCHAR(20) NOT NULL,
    client_email VARCHAR(200),
    exact_address TEXT,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    
    -- Audit fields
    source VARCHAR(50) DEFAULT 'fluentforms',
    original_notes TEXT -- Full notes before PII stripping
);

-- Lead provider interactions - tracks state machine per provider per lead
CREATE TABLE IF NOT EXISTS lead_interactions (
    id SERIAL PRIMARY KEY,
    lead_id VARCHAR(50) NOT NULL REFERENCES leads(lead_id),
    provider_id VARCHAR(50) NOT NULL,
    
    -- State machine
    status VARCHAR(50) NOT NULL DEFAULT 'NEW_LEAD',
    -- Status values: NEW_LEAD, TEASER_SENT, AWAIT_CONFIRM, CHECK_EXISTING_PAYMENT, 
    --                CREATE_PAYMENT_LINK, PAYMENT_LINK_SENT, AWAITING_PAYMENT, 
    --                PAID, REVEAL_DETAILS_SENT, DONE, EXPIRED, OPTED_OUT
    
    -- Timing
    last_sent_at TIMESTAMP,
    ttl_expires_at TIMESTAMP,
    unlocked_at TIMESTAMP,
    
    -- Payment tracking
    payment_link_url TEXT,
    checkout_session_id VARCHAR(200),
    payment_intent_id VARCHAR(200),
    
    -- Idempotency and audit
    idempotency_key VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Ensure one interaction per lead per provider
    UNIQUE(lead_id, provider_id)
);

-- Provider opt-outs
CREATE TABLE IF NOT EXISTS provider_optouts (
    provider_id VARCHAR(50) PRIMARY KEY,
    opted_out_at TIMESTAMP DEFAULT NOW(),
    reason VARCHAR(200)
);

-- Lead generation config
CREATE TABLE IF NOT EXISTS lead_config (
    id SERIAL PRIMARY KEY,
    price_cents INTEGER DEFAULT 2000, -- $20.00
    currency VARCHAR(3) DEFAULT 'usd',
    ttl_hours INTEGER DEFAULT 24,
    quiet_start_hour INTEGER DEFAULT 21, -- 21:30
    quiet_start_minute INTEGER DEFAULT 30,
    quiet_end_hour INTEGER DEFAULT 8, -- 08:00
    quiet_end_minute INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default config
INSERT INTO lead_config (price_cents, currency, ttl_hours) 
VALUES (2000, 'usd', 24) 
ON CONFLICT DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_active ON leads(is_active, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_interactions_status ON lead_interactions(status, ttl_expires_at);
CREATE INDEX IF NOT EXISTS idx_lead_interactions_provider ON lead_interactions(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_interactions_payment ON lead_interactions(checkout_session_id);

-- Views for easy querying
CREATE OR REPLACE VIEW active_leads AS
SELECT 
    l.*,
    COUNT(li.provider_id) as providers_notified,
    COUNT(CASE WHEN li.status = 'PAID' THEN 1 END) as providers_paid
FROM leads l
LEFT JOIN lead_interactions li ON l.lead_id = li.lead_id
WHERE l.is_active = true
GROUP BY l.lead_id, l.city, l.service_type, l.preferred_time_window, 
         l.budget_range, l.notes_snippet, l.client_name, l.client_phone, 
         l.client_email, l.exact_address, l.created_at, l.expires_at, 
         l.is_active, l.source, l.original_notes;

CREATE OR REPLACE VIEW provider_lead_summary AS
SELECT 
    li.provider_id,
    COUNT(*) as total_leads_received,
    COUNT(CASE WHEN li.status = 'PAID' THEN 1 END) as leads_purchased,
    SUM(CASE WHEN li.status = 'PAID' THEN 2000 ELSE 0 END) as total_spent_cents,
    MAX(li.created_at) as last_lead_received
FROM lead_interactions li
GROUP BY li.provider_id;
