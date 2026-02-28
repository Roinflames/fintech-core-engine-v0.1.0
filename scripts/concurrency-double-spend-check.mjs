#!/usr/bin/env node

const rawApiBase = process.env.API_BASE_URL || 'http://127.0.0.1:3000/v1';
const apiBase = rawApiBase.endsWith('/') ? rawApiBase.slice(0, -1) : rawApiBase;
const tenantId = process.env.TENANT_ID;
const fromWallet = process.env.FROM_WALLET_ID;
const toWalletA = process.env.TO_WALLET_A_ID;
const toWalletB = process.env.TO_WALLET_B_ID;
const amount = process.env.TRANSFER_AMOUNT || '100.00';
const currency = process.env.CURRENCY || 'CLP';

if (!tenantId || !fromWallet || !toWalletA || !toWalletB) {
  console.error('Missing required env vars: TENANT_ID, FROM_WALLET_ID, TO_WALLET_A_ID, TO_WALLET_B_ID');
  process.exit(1);
}

const headers = (key) => ({
  'content-type': 'application/json',
  'idempotency-key': key
});

async function transfer(idempotencyKey, toWalletId) {
  const response = await fetch(`${apiBase}/transfers`, {
    method: 'POST',
    headers: headers(idempotencyKey),
    body: JSON.stringify({
      tenant_id: tenantId,
      from_wallet_id: fromWallet,
      to_wallet_id: toWalletId,
      amount,
      currency
    })
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { parse_error: true };
  }
  return { status: response.status, payload };
}

async function main() {
  const [a, b] = await Promise.all([
    transfer(`concurrency-a-${Date.now()}`, toWalletA),
    transfer(`concurrency-b-${Date.now()}`, toWalletB)
  ]);

  console.log(JSON.stringify({ attempt_a: a, attempt_b: b }, null, 2));
  console.log('Expected: at most one success if source wallet cannot fund both transfers.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
