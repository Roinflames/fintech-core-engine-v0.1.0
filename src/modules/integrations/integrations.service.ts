import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { LedgerService, PostingLine } from '../ledger/ledger.service';
import { ComplianceService } from '../compliance/compliance.service';
import { IConnector } from './connector.interface';
import { MockConnector } from './mock.connector';

type ExternalTransferInput = {
  tenant_id: string;
  wallet_id: string;
  amount: string;
  currency: string;
  provider: string;
  external_reference: string;
};

@Injectable()
export class IntegrationsService implements OnModuleInit {
  private readonly connectors = new Map<string, IConnector>();

  constructor(
    private readonly db: DatabaseService,
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly compliance: ComplianceService
  ) {}

  onModuleInit() {
    this.register(new MockConnector());
  }

  register(connector: IConnector): void {
    this.connectors.set(connector.provider, connector);
  }

  async cashIn(idempotencyKey: string, input: ExternalTransferInput) {
    return this.idempotency.execute(
      input.tenant_id,
      idempotencyKey,
      { ...input, op: 'cash_in' },
      async (client) => {
        const amount = this.mustBePositive(input.amount);
        const connector = this.getConnector(input.provider);

        await connector.validateCashIn({
          tenantId: input.tenant_id,
          walletId: input.wallet_id,
          amount: input.amount,
          currency: input.currency,
          externalReference: input.external_reference
        });

        const wallet = await this.getWalletAccount(client, input.tenant_id, input.wallet_id);
        if (wallet.currency !== input.currency) throw new Error('Currency mismatch');

        await this.compliance.checkCredit(
          client, input.tenant_id, input.wallet_id, amount, input.currency, wallet.balance
        );

        const clearingAccountId = await this.ensureClearingAccount(client, input.tenant_id, input.currency);

        const txId = randomUUID();
        await client.query(
          `insert into transactions (id, tenant_id, type, status, amount, currency, idempotency_key)
           values ($1, $2, 'cash_in', 'pending', $3, $4, $5)`,
          [txId, input.tenant_id, input.amount, input.currency, idempotencyKey]
        );

        const extId = randomUUID();
        await client.query(
          `insert into external_transfers
             (id, tenant_id, wallet_id, transaction_id, provider, external_reference,
              direction, amount, currency, status, idempotency_key)
           values ($1, $2, $3, $4, $5, $6, 'cash_in', $7, $8, 'pending', $9)`,
          [extId, input.tenant_id, input.wallet_id, txId,
           input.provider, input.external_reference, input.amount, input.currency, idempotencyKey]
        );

        const lines: PostingLine[] = [
          { accountId: clearingAccountId, direction: 'debit', amount: input.amount, currency: input.currency },
          { accountId: wallet.account_id, direction: 'credit', amount: input.amount, currency: input.currency }
        ];
        const batch = await this.ledger.post(client, txId, lines);

        await client.query(`update transactions set status = 'posted' where id = $1`, [txId]);
        await client.query(`update external_transfers set status = 'posted' where id = $1`, [extId]);

        return {
          external_transfer_id: extId,
          transaction_id: txId,
          batch_id: batch.batch_id,
          direction: 'cash_in' as const,
          status: 'posted' as const,
          ...input
        };
      }
    );
  }

  async cashOut(idempotencyKey: string, input: ExternalTransferInput) {
    return this.idempotency.execute(
      input.tenant_id,
      idempotencyKey,
      { ...input, op: 'cash_out' },
      async (client) => {
        const amount = this.mustBePositive(input.amount);
        const connector = this.getConnector(input.provider);

        await connector.validateCashOut({
          tenantId: input.tenant_id,
          walletId: input.wallet_id,
          amount: input.amount,
          currency: input.currency,
          externalReference: input.external_reference
        });

        await this.lockWalletRow(client, input.tenant_id, input.wallet_id);
        const wallet = await this.getWalletAccount(client, input.tenant_id, input.wallet_id);
        if (wallet.currency !== input.currency) throw new Error('Currency mismatch');
        if (wallet.balance < amount) throw new Error('Insufficient funds');

        await this.compliance.checkDebit(
          client, input.tenant_id, input.wallet_id, wallet.account_id, amount, input.currency
        );

        const clearingAccountId = await this.ensureClearingAccount(client, input.tenant_id, input.currency);

        const txId = randomUUID();
        await client.query(
          `insert into transactions (id, tenant_id, type, status, amount, currency, idempotency_key)
           values ($1, $2, 'cash_out', 'pending', $3, $4, $5)`,
          [txId, input.tenant_id, input.amount, input.currency, idempotencyKey]
        );

        const extId = randomUUID();
        await client.query(
          `insert into external_transfers
             (id, tenant_id, wallet_id, transaction_id, provider, external_reference,
              direction, amount, currency, status, idempotency_key)
           values ($1, $2, $3, $4, $5, $6, 'cash_out', $7, $8, 'pending', $9)`,
          [extId, input.tenant_id, input.wallet_id, txId,
           input.provider, input.external_reference, input.amount, input.currency, idempotencyKey]
        );

        const lines: PostingLine[] = [
          { accountId: wallet.account_id, direction: 'debit', amount: input.amount, currency: input.currency },
          { accountId: clearingAccountId, direction: 'credit', amount: input.amount, currency: input.currency }
        ];
        const batch = await this.ledger.post(client, txId, lines);

        await client.query(`update transactions set status = 'posted' where id = $1`, [txId]);
        await client.query(`update external_transfers set status = 'posted' where id = $1`, [extId]);

        return {
          external_transfer_id: extId,
          transaction_id: txId,
          batch_id: batch.batch_id,
          direction: 'cash_out' as const,
          status: 'posted' as const,
          ...input
        };
      }
    );
  }

  async getTransfer(externalTransferId: string) {
    const result = await this.db.query<{
      id: string;
      tenant_id: string;
      wallet_id: string;
      transaction_id: string;
      provider: string;
      external_reference: string;
      direction: string;
      amount: string;
      currency: string;
      status: string;
      created_at: string;
    }>(
      `select id, tenant_id, wallet_id, transaction_id, provider, external_reference,
              direction, amount::text, currency, status, created_at::text
       from external_transfers where id = $1`,
      [externalTransferId]
    );
    if (!result.rowCount) throw new Error('External transfer not found');
    const row = result.rows[0];
    return {
      external_transfer_id: row.id,
      tenant_id: row.tenant_id,
      wallet_id: row.wallet_id,
      transaction_id: row.transaction_id,
      provider: row.provider,
      external_reference: row.external_reference,
      direction: row.direction,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      created_at: row.created_at
    };
  }

  private getConnector(provider: string): IConnector {
    const connector = this.connectors.get(provider);
    if (!connector) throw new Error(`Unknown provider: ${provider}`);
    return connector;
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

  private async ensureClearingAccount(client: PoolClient, tenantId: string, currency: string) {
    const code = `EXTERNAL_CLEARING_${currency}`;
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
