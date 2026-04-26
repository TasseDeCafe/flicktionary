-- Template migration for app monorepo
-- This migration creates the base tables needed for Stripe/RevenueCat integration

-- Create custom enum types

CREATE TYPE stripe_subscription_status AS ENUM (
    'active',
    'trialing',
    'past_due',
    'canceled',
    'unpaid',
    'incomplete_expired',
    'incomplete',
    'paused'
);

CREATE TYPE subscription_interval AS ENUM ('month', 'year');

CREATE TYPE revenuecat_auto_renewal_status AS ENUM (
    'will_renew',
    'will_not_renew',
    'will_change_product',
    'will_pause',
    'requires_price_increase_consent',
    'has_already_renewed'
);

CREATE TYPE revenuecat_subscription_status AS ENUM (
    'trialing',
    'active',
    'expired',
    'in_grace_period',
    'in_billing_retry',
    'paused',
    'unknown',
    'incomplete'
);

CREATE TYPE revenuecat_store AS ENUM (
    'amazon',
    'app_store',
    'mac_app_store',
    'play_store',
    'promotional',
    'stripe',
    'rc_billing',
    'test_store'
);

-- Create users table

CREATE TABLE public.users (
    id uuid NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    stripe_customer_id VARCHAR(255) NULL,
    referral VARCHAR(30) NULL,
    utm_source VARCHAR NULL,
    utm_medium VARCHAR NULL,
    utm_campaign VARCHAR NULL,
    utm_term VARCHAR NULL,
    utm_content VARCHAR NULL,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_stripe_customer_id_key UNIQUE (stripe_customer_id),
    CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON public.users USING btree (stripe_customer_id) TABLESPACE pg_default;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Create stripe_subscriptions table

CREATE TABLE public.stripe_subscriptions (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    user_id uuid NOT NULL,
    stripe_subscription_id VARCHAR(255) NOT NULL,
    stripe_product_id VARCHAR(255) NOT NULL,
    status stripe_subscription_status NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE NULL,
    cancel_at_period_end BOOLEAN NULL DEFAULT FALSE,
    trial_end TIMESTAMP WITH TIME ZONE NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    currency VARCHAR(10) NULL,
    amount NUMERIC(20, 6) NULL,
    interval subscription_interval NULL,
    interval_count INTEGER NULL,
    CONSTRAINT stripe_subscriptions_pkey PRIMARY KEY (id),
    CONSTRAINT stripe_subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id),
    CONSTRAINT stripe_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_user_id ON public.stripe_subscriptions USING btree (user_id) TABLESPACE pg_default;

ALTER TABLE public.stripe_subscriptions ENABLE ROW LEVEL SECURITY;

-- Create revenuecat_subscriptions table

CREATE TABLE public.revenuecat_subscriptions (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    user_id uuid NOT NULL,
    revenuecat_subscription_id VARCHAR(255) NOT NULL,
    revenuecat_original_customer_id VARCHAR(255) NOT NULL,
    revenuecat_product_id VARCHAR(255) NULL,
    starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_ends_at TIMESTAMP WITH TIME ZONE NULL,
    gives_access BOOLEAN NOT NULL,
    pending_payment BOOLEAN NOT NULL,
    auto_renewal_status revenuecat_auto_renewal_status NOT NULL,
    status revenuecat_subscription_status NOT NULL,
    total_revenue_in_usd NUMERIC(10, 2) NOT NULL,
    presented_offering_id VARCHAR(255) NULL,
    environment VARCHAR(50) NOT NULL,
    store revenuecat_store NOT NULL,
    store_subscription_identifier VARCHAR(255) NOT NULL,
    ownership_type VARCHAR(50) NOT NULL,
    billing_country_code VARCHAR(2) NULL,
    management_url TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT revenuecat_subscriptions_subscription_id UNIQUE (revenuecat_subscription_id),
    CONSTRAINT revenuecat_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_revenuecat_subscriptions_user_id ON public.revenuecat_subscriptions USING btree (user_id) TABLESPACE pg_default;

ALTER TABLE public.revenuecat_subscriptions ENABLE ROW LEVEL SECURITY;

-- Create removals table

CREATE TABLE public.removals (
    id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
    user_id uuid NOT NULL,
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    was_successful BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT removals_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;

ALTER TABLE public.removals ENABLE ROW LEVEL SECURITY;

-- Create handled_stripe_events table

CREATE TABLE public.handled_stripe_events (
    id SERIAL NOT NULL,
    event_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT handled_stripe_events_pkey PRIMARY KEY (id),
    CONSTRAINT handled_stripe_events_event_id_key UNIQUE (event_id)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_handled_stripe_events_event_id ON public.handled_stripe_events USING btree (event_id) TABLESPACE pg_default;

ALTER TABLE public.handled_stripe_events ENABLE ROW LEVEL SECURITY;

-- Create handled_revenuecat_events table

CREATE TABLE public.handled_revenuecat_events (
    id SERIAL NOT NULL,
    event_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT handled_revenuecat_events_pkey PRIMARY KEY (id),
    CONSTRAINT handled_revenuecat_events_event_id_key UNIQUE (event_id)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_handled_revenuecat_events_event_id ON public.handled_revenuecat_events USING btree (event_id) TABLESPACE pg_default;

ALTER TABLE public.handled_revenuecat_events ENABLE ROW LEVEL SECURITY;