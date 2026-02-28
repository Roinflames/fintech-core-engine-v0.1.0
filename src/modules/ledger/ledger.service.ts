import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';

export type PostingLine = {
  accountId: string;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
};

@Injectable()
export class LedgerService {
  validateBalanced(lines: PostingLine[]) {
    if (!lines.length) {
      throw new Error('Posting lines are required');
    }

    let debitTotal = 0;
    let creditTotal = 0;
    const currencies = new Set<string>();

    for (const line of lines) {
      const amount = Number(line.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Posting amount must be > 0');
      }
      currencies.add(line.currency);
      if (line.direction === 'debit') debitTotal += amount;
      else creditTotal += amount;
    }

    if (currencies.size !== 1) {
      throw new Error('Mixed currencies in one posting batch are not allowed');
    }
    if (Math.abs(debitTotal - creditTotal) > 0.000001) {
      throw new Error('Unbalanced posting batch');
    }
  }

  async post(client: PoolClient, transactionId: string, lines: PostingLine[]) {
    this.validateBalanced(lines);
    const batchId = randomUUID();

    await client.query(
      `insert into ledger_batches (id, transaction_id)
       values ($1, $2)`,
      [batchId, transactionId]
    );

    for (const line of lines) {
      await client.query(
        `insert into ledger_entries (id, batch_id, account_id, direction, amount, currency)
         values ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), batchId, line.accountId, line.direction, line.amount, line.currency]
      );
    }

    return { batch_id: batchId };
  }
}
