import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../common/db/database.service';

@Injectable()
export class WalletsService {
  constructor(private readonly db: DatabaseService) {}

  async createWallet(input: { tenant_id: string; owner_id: string; currency: string }) {
    return this.db.withTransaction(async (client) => {
      const walletId = randomUUID();
      const accountId = randomUUID();
      const accountCode = `WALLET_${walletId.replaceAll('-', '').slice(0, 20)}`;

      await client.query(
        `insert into wallets (id, tenant_id, owner_id, currency, status)
         values ($1, $2, $3, $4, 'active')`,
        [walletId, input.tenant_id, input.owner_id, input.currency]
      );

      await client.query(
        `insert into accounts (id, tenant_id, code, type, currency)
         values ($1, $2, $3, 'liability', $4)`,
        [accountId, input.tenant_id, accountCode, input.currency]
      );

      await client.query(
        `insert into wallet_accounts (wallet_id, account_id, role)
         values ($1, $2, 'principal')`,
        [walletId, accountId]
      );

      return {
        wallet_id: walletId,
        tenant_id: input.tenant_id,
        owner_id: input.owner_id,
        currency: input.currency,
        status: 'active'
      };
    });
  }

  async getWallet(walletId: string) {
    const result = await this.db.query<{
      id: string;
      tenant_id: string;
      owner_id: string;
      currency: string;
      status: string;
    }>(
      `select id, tenant_id, owner_id, currency, status
       from wallets
       where id = $1`,
      [walletId]
    );

    if (!result.rowCount) throw new Error('Wallet not found');
    const row = result.rows[0];
    return {
      wallet_id: row.id,
      tenant_id: row.tenant_id,
      owner_id: row.owner_id,
      currency: row.currency,
      status: row.status
    };
  }

  async getBalance(walletId: string) {
    const result = await this.db.query<{ currency: string; balance: string }>(
      `select w.currency,
              coalesce(
                sum(
                  case le.direction
                    when 'credit' then le.amount
                    else -le.amount
                  end
                ),
                0
              )::text as balance
       from wallets w
       join wallet_accounts wa on wa.wallet_id = w.id and wa.role = 'principal'
       left join ledger_entries le on le.account_id = wa.account_id
       where w.id = $1
       group by w.currency`,
      [walletId]
    );

    if (!result.rowCount) throw new Error('Wallet not found');
    const row = result.rows[0];
    return {
      wallet_id: walletId,
      available: row.balance,
      ledger: row.balance,
      currency: row.currency
    };
  }
}
