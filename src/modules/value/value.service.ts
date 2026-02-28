import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { LedgerService, PostingLine } from '../ledger/ledger.service';
import { ComplianceService } from '../compliance/compliance.service';

type ValueInput = {
  tenant_id: string;
  wallet_id: string;
  amount: string;
  currency: string;
};

@Injectable()
export class ValueService {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly compliance: ComplianceService
  ) {}

  async issue(idempotencyKey: string, input: ValueInput) {
    return this.idempotency.execute(input.tenant_id, idempotencyKey, { ...input, op: 'issue' }, async (client) => {
      const amount = this.mustBePositive(input.amount);
      const wallet = await this.getWalletAccount(client, input.tenant_id, input.wallet_id);
      if (wallet.currency !== input.currency) throw new Error('Currency mismatch');
      await this.compliance.checkCredit(client, input.tenant_id, input.wallet_id, amount, input.currency, wallet.balance);
      const treasuryAccountId = await this.ensureTreasuryAccount(client, input.tenant_id, input.currency);

      const txId = randomUUID();
      await client.query(
        `insert into transactions (id, tenant_id, type, status, amount, currency, idempotency_key)
         values ($1, $2, 'issue', 'pending', $3, $4, $5)`,
        [txId, input.tenant_id, input.amount, input.currency, idempotencyKey]
      );

      const lines: PostingLine[] = [
        { accountId: treasuryAccountId, direction: 'debit', amount: input.amount, currency: input.currency },
        { accountId: wallet.account_id, direction: 'credit', amount: input.amount, currency: input.currency }
      ];
      const batch = await this.ledger.post(client, txId, lines);
      await client.query(`update transactions set status = 'posted' where id = $1`, [txId]);

      return {
        operation: 'issue',
        transaction_id: txId,
        status: 'posted',
        batch_id: batch.batch_id,
        ...input
      };
    });
  }

  async redeem(idempotencyKey: string, input: ValueInput) {
    return this.idempotency.execute(input.tenant_id, idempotencyKey, { ...input, op: 'redeem' }, async (client) => {
      const amount = this.mustBePositive(input.amount);
      await this.lockWalletRow(client, input.tenant_id, input.wallet_id);
      const wallet = await this.getWalletAccount(client, input.tenant_id, input.wallet_id);
      if (wallet.currency !== input.currency) throw new Error('Currency mismatch');
      if (wallet.balance < amount) throw new Error('Insufficient funds');
      await this.compliance.checkDebit(client, input.tenant_id, input.wallet_id, wallet.account_id, amount, input.currency);

      const treasuryAccountId = await this.ensureTreasuryAccount(client, input.tenant_id, input.currency);
      const txId = randomUUID();

      await client.query(
        `insert into transactions (id, tenant_id, type, status, amount, currency, idempotency_key)
         values ($1, $2, 'redeem', 'pending', $3, $4, $5)`,
        [txId, input.tenant_id, input.amount, input.currency, idempotencyKey]
      );

      const lines: PostingLine[] = [
        { accountId: wallet.account_id, direction: 'debit', amount: input.amount, currency: input.currency },
        { accountId: treasuryAccountId, direction: 'credit', amount: input.amount, currency: input.currency }
      ];
      const batch = await this.ledger.post(client, txId, lines);
      await client.query(`update transactions set status = 'posted' where id = $1`, [txId]);

      return {
        operation: 'redeem',
        transaction_id: txId,
        status: 'posted',
        batch_id: batch.batch_id,
        ...input
      };
    });
  }

  private mustBePositive(amountText: string): number {
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be positive');
    return amount;
  }

  private async lockWalletRow(client: PoolClient, tenantId: string, walletId: string) {
    const locked = await client.query<{ id: string }>(
      `select id from wallets where tenant_id = $1 and id = $2 for update`,
      [tenantId, walletId]
    );
    if (!locked.rowCount) throw new Error('Wallet lock failed');
  }

  private async getWalletAccount(client: PoolClient, tenantId: string, walletId: string) {
    const account = await client.query<{ account_id: string; currency: string }>(
      `select wa.account_id, w.currency
       from wallets w
       join wallet_accounts wa on wa.wallet_id = w.id and wa.role = 'principal'
       where w.id = $1 and w.tenant_id = $2 and w.status = 'active'`,
      [walletId, tenantId]
    );
    if (!account.rowCount) throw new Error('Wallet principal account not found');

    const balanceResult = await client.query<{ balance: string }>(
      `select coalesce(
                sum(case le.direction when 'credit' then le.amount else -le.amount end),
                0
              )::text as balance
       from ledger_entries le
       where le.account_id = $1`,
      [account.rows[0].account_id]
    );

    return {
      account_id: account.rows[0].account_id,
      currency: account.rows[0].currency,
      balance: Number(balanceResult.rows[0].balance)
    };
  }

  private async ensureTreasuryAccount(client: PoolClient, tenantId: string, currency: string) {
    const code = `INTERNAL_TREASURY_${currency}`;
    const existing = await client.query<{ id: string }>(
      `select id from accounts where tenant_id = $1 and code = $2`,
      [tenantId, code]
    );
    if (existing.rowCount) return existing.rows[0].id;

    const accountId = randomUUID();
    await client.query(
      `insert into accounts (id, tenant_id, code, type, currency)
       values ($1, $2, $3, 'asset', $4)`,
      [accountId, tenantId, code, currency]
    );
    return accountId;
  }
}
