import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';

type Policy = {
  max_single_amount: string | null;
  max_daily_wallet_debit: string | null;
  max_wallet_balance: string | null;
  requires_kyc: boolean;
};

export type UpsertPolicyInput = {
  max_single_amount?: string | null;
  max_daily_wallet_debit?: string | null;
  max_wallet_balance?: string | null;
  requires_kyc?: boolean;
};

@Injectable()
export class ComplianceService {
  constructor(private readonly db: DatabaseService) {}

  async getPolicy(tenantId: string, currency: string): Promise<Policy | null> {
    const result = await this.db.query<Policy>(
      `select max_single_amount::text, max_daily_wallet_debit::text,
              max_wallet_balance::text, requires_kyc
       from compliance_policies
       where tenant_id = $1 and currency = $2`,
      [tenantId, currency]
    );
    return result.rowCount ? result.rows[0] : null;
  }

  async upsertPolicy(tenantId: string, currency: string, input: UpsertPolicyInput): Promise<Policy | null> {
    await this.db.query(
      `insert into compliance_policies
         (tenant_id, currency, max_single_amount, max_daily_wallet_debit, max_wallet_balance, requires_kyc)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (tenant_id, currency) do update set
         max_single_amount      = excluded.max_single_amount,
         max_daily_wallet_debit = excluded.max_daily_wallet_debit,
         max_wallet_balance     = excluded.max_wallet_balance,
         requires_kyc           = excluded.requires_kyc,
         updated_at             = now()`,
      [
        tenantId,
        currency,
        input.max_single_amount ?? null,
        input.max_daily_wallet_debit ?? null,
        input.max_wallet_balance ?? null,
        input.requires_kyc ?? false
      ]
    );
    return this.getPolicy(tenantId, currency);
  }

  /**
   * Validates a debit operation against the tenant's compliance policy.
   * Checks: max_single_amount, max_daily_wallet_debit, requires_kyc.
   */
  async checkDebit(
    client: PoolClient,
    tenantId: string,
    walletId: string,
    accountId: string,
    amount: number,
    currency: string
  ): Promise<void> {
    const policy = await this.fetchPolicy(client, tenantId, currency);
    if (!policy) return;

    if (policy.requires_kyc) {
      await this.assertKycVerified(client, walletId);
    }

    if (policy.max_single_amount !== null && amount > Number(policy.max_single_amount)) {
      throw new Error(`Amount exceeds single transaction limit of ${policy.max_single_amount} ${currency}`);
    }

    if (policy.max_daily_wallet_debit !== null) {
      const daily = await client.query<{ total: string }>(
        `select coalesce(sum(le.amount), 0)::text as total
         from ledger_entries le
         join ledger_batches lb on lb.id = le.batch_id
         join transactions t on t.id = lb.transaction_id
         where le.account_id = $1
           and le.direction = 'debit'
           and lb.posted_at >= current_date
           and t.status = 'posted'`,
        [accountId]
      );
      if (Number(daily.rows[0].total) + amount > Number(policy.max_daily_wallet_debit)) {
        throw new Error(`Daily debit limit of ${policy.max_daily_wallet_debit} ${currency} exceeded`);
      }
    }
  }

  /**
   * Validates a credit operation against the tenant's compliance policy.
   * Checks: max_wallet_balance, requires_kyc.
   */
  async checkCredit(
    client: PoolClient,
    tenantId: string,
    walletId: string,
    amount: number,
    currency: string,
    currentBalance: number
  ): Promise<void> {
    const policy = await this.fetchPolicy(client, tenantId, currency);
    if (!policy) return;

    if (policy.requires_kyc) {
      await this.assertKycVerified(client, walletId);
    }

    if (policy.max_wallet_balance !== null) {
      if (currentBalance + amount > Number(policy.max_wallet_balance)) {
        throw new Error(`Balance would exceed max wallet balance of ${policy.max_wallet_balance} ${currency}`);
      }
    }
  }

  private async fetchPolicy(client: PoolClient, tenantId: string, currency: string): Promise<Policy | null> {
    const result = await client.query<Policy>(
      `select max_single_amount::text, max_daily_wallet_debit::text,
              max_wallet_balance::text, requires_kyc
       from compliance_policies
       where tenant_id = $1 and currency = $2`,
      [tenantId, currency]
    );
    return result.rowCount ? result.rows[0] : null;
  }

  private async assertKycVerified(client: PoolClient, walletId: string): Promise<void> {
    const result = await client.query<{ kyc_verified: boolean }>(
      `select kyc_verified from wallets where id = $1`,
      [walletId]
    );
    if (!result.rows[0]?.kyc_verified) {
      throw new Error('KYC verification required for this operation');
    }
  }
}
