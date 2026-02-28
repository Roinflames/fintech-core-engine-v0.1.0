import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { LedgerService, PostingLine } from '../ledger/ledger.service';
import { ComplianceService } from '../compliance/compliance.service';

type TransferInput = {
  tenant_id: string;
  from_wallet_id: string;
  to_wallet_id: string;
  amount: string;
  currency: string;
};

@Injectable()
export class TransactionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly compliance: ComplianceService
  ) {}

  async createTransfer(idempotencyKey: string, input: TransferInput) {
    return this.idempotency.execute(input.tenant_id, idempotencyKey, input, async (client) => {
      const amount = this.mustBePositive(input.amount);
      await this.lockWalletRows(client, input.tenant_id, [input.from_wallet_id, input.to_wallet_id]);
      const from = await this.getWalletAccount(client, input.tenant_id, input.from_wallet_id);
      const to = await this.getWalletAccount(client, input.tenant_id, input.to_wallet_id);

      if (from.currency !== input.currency || to.currency !== input.currency) {
        throw new Error('Currency mismatch');
      }
      if (from.balance < amount) {
        throw new Error('Insufficient funds');
      }

      await this.compliance.checkDebit(client, input.tenant_id, input.from_wallet_id, from.account_id, amount, input.currency);
      await this.compliance.checkCredit(client, input.tenant_id, input.to_wallet_id, amount, input.currency, to.balance);

      const txId = randomUUID();
      await client.query(
        `insert into transactions (id, tenant_id, type, status, amount, currency, idempotency_key)
         values ($1, $2, 'transfer', 'pending', $3, $4, $5)`,
        [txId, input.tenant_id, input.amount, input.currency, idempotencyKey]
      );

      const lines: PostingLine[] = [
        { accountId: from.account_id, direction: 'debit', amount: input.amount, currency: input.currency },
        { accountId: to.account_id, direction: 'credit', amount: input.amount, currency: input.currency }
      ];

      const batch = await this.ledger.post(client, txId, lines);

      await client.query(`update transactions set status = 'posted' where id = $1`, [txId]);
      return {
        transaction_id: txId,
        status: 'posted',
        type: 'transfer',
        batch_id: batch.batch_id,
        ...input
      };
    });
  }

  async getTransaction(transactionId: string) {
    const result = await this.db.query<{
      id: string;
      tenant_id: string;
      type: string;
      status: string;
      amount: string;
      currency: string;
      original_transaction_id: string | null;
      created_at: string;
    }>(
      `select id, tenant_id, type, status, amount::text, currency, original_transaction_id, created_at::text
       from transactions where id = $1`,
      [transactionId]
    );

    if (!result.rowCount) throw new Error('Transaction not found');
    const row = result.rows[0];
    return {
      transaction_id: row.id,
      tenant_id: row.tenant_id,
      type: row.type,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      original_transaction_id: row.original_transaction_id,
      created_at: row.created_at
    };
  }

  async reverseTransaction(idempotencyKey: string, transactionId: string) {
    const original = await this.db.query<{
      id: string;
      tenant_id: string;
      amount: string;
      currency: string;
      status: string;
    }>(
      `select id, tenant_id, amount::text, currency, status
       from transactions
       where id = $1`,
      [transactionId]
    );

    if (!original.rowCount) throw new Error('Original transaction not found');
    const originalRow = original.rows[0];
    if (originalRow.status !== 'posted') {
      throw new Error('Only posted transactions can be reversed');
    }

    return this.idempotency.execute(
      originalRow.tenant_id,
      idempotencyKey,
      { original_transaction_id: transactionId },
      async (client) => {
        const entries = await client.query<{
          account_id: string;
          direction: 'debit' | 'credit';
          amount: string;
          currency: string;
        }>(
          `select le.account_id, le.direction, le.amount::text, le.currency
           from ledger_entries le
           join ledger_batches lb on lb.id = le.batch_id
           where lb.transaction_id = $1`,
          [transactionId]
        );

        if (!entries.rowCount) throw new Error('Original transaction has no ledger entries');

        const reverseTxId = randomUUID();
        await client.query(
          `insert into transactions (
             id, tenant_id, type, status, amount, currency, idempotency_key, original_transaction_id
           ) values ($1, $2, 'reversal', 'pending', $3, $4, $5, $6)`,
          [reverseTxId, originalRow.tenant_id, originalRow.amount, originalRow.currency, idempotencyKey, transactionId]
        );

        const reverseLines: PostingLine[] = entries.rows.map((e) => ({
          accountId: e.account_id,
          direction: e.direction === 'debit' ? 'credit' : 'debit',
          amount: e.amount,
          currency: e.currency
        }));

        const batch = await this.ledger.post(client, reverseTxId, reverseLines);
        await client.query(`update transactions set status = 'posted' where id = $1`, [reverseTxId]);
        await client.query(`update transactions set status = 'reversed' where id = $1`, [transactionId]);

        return {
          transaction_id: reverseTxId,
          original_transaction_id: transactionId,
          status: 'posted',
          batch_id: batch.batch_id
        };
      }
    );
  }

  private mustBePositive(amountText: string): number {
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Amount must be positive');
    }
    return amount;
  }

  private async lockWalletRows(client: PoolClient, tenantId: string, walletIds: string[]) {
    const uniqueIds = [...new Set(walletIds)].sort();
    const locked = await client.query<{ id: string }>(
      `select id
       from wallets
       where tenant_id = $1 and id = any($2::uuid[])
       order by id
       for update`,
      [tenantId, uniqueIds]
    );
    if (locked.rowCount !== uniqueIds.length) {
      throw new Error('Wallet lock failed: one or more wallets do not exist');
    }
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
}
