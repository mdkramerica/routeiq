-- TerritoryPilot Supabase Schema
-- Run in Supabase SQL editor

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Users (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'solo', 'team', 'agency')),
  plan_active BOOLEAN DEFAULT FALSE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Accounts (territory accounts)
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) <= 255),
  address TEXT CHECK (char_length(address) <= 500),
  lat FLOAT,
  lng FLOAT,
  contact_name TEXT CHECK (char_length(contact_name) <= 255),
  contact_email TEXT CHECK (char_length(contact_email) <= 255),
  contact_phone TEXT CHECK (char_length(contact_phone) <= 50),
  notes TEXT CHECK (char_length(notes) <= 2000),
  last_visited DATE,
  visit_frequency_days INT DEFAULT 30 CHECK (visit_frequency_days BETWEEN 1 AND 365),
  priority INT DEFAULT 2 CHECK (priority IN (1, 2, 3)),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Call logs
CREATE TABLE IF NOT EXISTS public.call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  transcript TEXT,
  summary TEXT,
  outcome TEXT CHECK (outcome IN ('positive', 'neutral', 'needs_followup', 'closed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI briefs (cached)
CREATE TABLE IF NOT EXISTS public.briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  brief TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Route plans
CREATE TABLE IF NOT EXISTS public.route_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  account_order JSONB,
  total_miles FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, plan_date)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own data" ON public.users FOR ALL USING (auth.uid() = id);
CREATE POLICY "Users can access own accounts" ON public.accounts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can access own logs" ON public.call_logs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can access own briefs" ON public.briefs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can access own routes" ON public.route_plans FOR ALL USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON public.accounts(user_id);
CREATE INDEX IF NOT EXISTS call_logs_account_id_idx ON public.call_logs(account_id);
CREATE INDEX IF NOT EXISTS call_logs_user_date_idx ON public.call_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS briefs_cache_idx ON public.briefs(account_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS route_plans_user_date_idx ON public.route_plans(user_id, plan_date);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Auto-update updated_at on accounts
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- MAINTENANCE: Purge expired briefs (run as scheduled function or cron)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION purge_expired_briefs()
RETURNS void AS $$
BEGIN
  DELETE FROM public.briefs WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;
