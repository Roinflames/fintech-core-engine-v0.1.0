-- v0.1.3 compliance:
-- 1) kyc_verified flag on wallets
-- 2) compliance_policies per tenant+currency (limits + KYC requirement)

alter table wallets
  add column if not exists kyc_verified boolean not null default false;

create table if not exists compliance_policies (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  currency    char(3) not null,

  -- null means no limit enforced
  max_single_amount       numeric(20,2),
  max_daily_wallet_debit  numeric(20,2),
  max_wallet_balance      numeric(20,2),

  requires_kyc boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (tenant_id, currency)
);
