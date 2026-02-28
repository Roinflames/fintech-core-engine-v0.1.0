-- v0.1.2 hardening:
-- 1) Ledger append-only (no update/delete on ledger tables)
-- 2) Exactly one reversal transaction per original transaction
-- 3) Every ledger batch must be balanced at commit time

create or replace function prevent_mutation_ledger()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ledger tables are append-only (% on %)', tg_op, tg_table_name;
end;
$$;

drop trigger if exists trg_no_update_ledger_entries on ledger_entries;
create trigger trg_no_update_ledger_entries
before update or delete on ledger_entries
for each row execute function prevent_mutation_ledger();

drop trigger if exists trg_no_update_ledger_batches on ledger_batches;
create trigger trg_no_update_ledger_batches
before update or delete on ledger_batches
for each row execute function prevent_mutation_ledger();

create unique index if not exists uq_one_reversal_per_original
on transactions (original_transaction_id)
where type = 'reversal' and original_transaction_id is not null;

create or replace function enforce_ledger_batch_balance()
returns trigger
language plpgsql
as $$
declare
  target_batch_id uuid;
  debit_total numeric;
  credit_total numeric;
  entry_count integer;
begin
  if tg_table_name = 'ledger_batches' then
    target_batch_id := coalesce(new.id, old.id);
  else
    target_batch_id := coalesce(new.batch_id, old.batch_id);
  end if;

  select
    count(*)::int,
    coalesce(sum(case when direction = 'debit' then amount else 0 end), 0),
    coalesce(sum(case when direction = 'credit' then amount else 0 end), 0)
  into entry_count, debit_total, credit_total
  from ledger_entries
  where batch_id = target_batch_id;

  if entry_count = 0 then
    raise exception 'ledger batch % has no entries', target_batch_id;
  end if;

  if debit_total <> credit_total then
    raise exception 'ledger batch % not balanced: debit %, credit %', target_batch_id, debit_total, credit_total;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_check_batch_balance_entries on ledger_entries;
create constraint trigger trg_check_batch_balance_entries
after insert on ledger_entries
deferrable initially deferred
for each row execute function enforce_ledger_batch_balance();

drop trigger if exists trg_check_batch_balance_batches on ledger_batches;
create constraint trigger trg_check_batch_balance_batches
after insert on ledger_batches
deferrable initially deferred
for each row execute function enforce_ledger_batch_balance();
