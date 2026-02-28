create table tenants (
  id uuid primary key,
  name text not null,
  country_code text not null,
  created_at timestamptz not null default now()
);

create table wallets (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  owner_id uuid not null,
  currency char(3) not null,
  status text not null check (status in ('active','blocked','closed')),
  created_at timestamptz not null default now()
);

create table accounts (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  code text not null,
  type text not null check (type in ('asset','liability','equity','revenue','expense')),
  currency char(3) not null,
  parent_account_id uuid references accounts(id),
  unique (tenant_id, code)
);

create table wallet_accounts (
  wallet_id uuid not null references wallets(id),
  account_id uuid not null references accounts(id),
  role text not null check (role in ('principal','fees','reserve')),
  primary key (wallet_id, account_id)
);

create table transactions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  type text not null check (type in ('transfer','issue','redeem','cash_in','cash_out','reversal')),
  status text not null check (status in ('pending','posted','failed','reversed')),
  amount numeric(20,2) not null check (amount > 0),
  currency char(3) not null,
  idempotency_key text not null,
  original_transaction_id uuid references transactions(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create table ledger_batches (
  id uuid primary key,
  transaction_id uuid not null references transactions(id),
  posted_at timestamptz not null default now()
);

create table ledger_entries (
  id uuid primary key,
  batch_id uuid not null references ledger_batches(id),
  account_id uuid not null references accounts(id),
  direction text not null check (direction in ('debit','credit')),
  amount numeric(20,2) not null check (amount > 0),
  currency char(3) not null,
  created_at timestamptz not null default now()
);

create table idempotency_keys (
  tenant_id uuid not null references tenants(id),
  key text not null,
  request_hash text not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table audit_logs (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
