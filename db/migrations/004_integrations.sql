-- v0.1.4 integrations:
-- Registro de transferencias externas (cash_in / cash_out) vía conectores banco/PSP.
-- unique (provider, external_reference, direction) previene doble procesamiento.

create table if not exists external_transfers (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  wallet_id         uuid not null references wallets(id),
  transaction_id    uuid references transactions(id),
  provider          text not null,
  external_reference text not null,
  direction         text not null check (direction in ('cash_in', 'cash_out')),
  amount            numeric(20,2) not null check (amount > 0),
  currency          char(3) not null,
  status            text not null check (status in ('pending', 'posted', 'failed')),
  idempotency_key   text not null,
  created_at        timestamptz not null default now(),

  unique (provider, external_reference, direction)
);
