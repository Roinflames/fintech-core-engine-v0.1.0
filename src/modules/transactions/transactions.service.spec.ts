import { TransactionsService } from './transactions.service';
import { DatabaseService } from '../../common/db/database.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { ComplianceService } from '../compliance/compliance.service';
import { PoolClient } from 'pg';

// Mock idempotency to directly invoke the handler with a mock client
function makeIdempotencyMock(client: PoolClient) {
  return {
    execute: jest.fn().mockImplementation((_tid, _key, _payload, handler) => handler(client))
  } as unknown as IdempotencyService;
}

function makeLedgerMock() {
  return {
    post: jest.fn().mockResolvedValue({ batch_id: 'batch-uuid' })
  } as unknown as LedgerService;
}

function makeComplianceMock() {
  return {
    checkDebit: jest.fn().mockResolvedValue(undefined),
    checkCredit: jest.fn().mockResolvedValue(undefined)
  } as unknown as ComplianceService;
}

const mockDb = { query: jest.fn() } as unknown as DatabaseService;

describe('TransactionsService', () => {
  let client: { query: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    client = { query: jest.fn() };
  });

  describe('createTransfer', () => {
    const input = {
      tenant_id: 't1',
      from_wallet_id: 'from-w',
      to_wallet_id: 'to-w',
      amount: '100',
      currency: 'CLP'
    };

    function setupHappyPath() {
      client.query
        .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'from-w' }, { id: 'to-w' }] }) // lock wallets
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ account_id: 'acc-from', currency: 'CLP' }] }) // from account
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance: '500' }] })  // from balance
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ account_id: 'acc-to', currency: 'CLP' }] }) // to account
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance: '0' }] })    // to balance
        .mockResolvedValue({});  // insert tx + update tx
    }

    it('returns posted transfer on success', async () => {
      setupHappyPath();
      const idempotency = makeIdempotencyMock(client as unknown as PoolClient);
      const svc = new TransactionsService(mockDb, idempotency, makeLedgerMock(), makeComplianceMock());

      const result = await svc.createTransfer('key-1', input);

      expect(result.status).toBe('posted');
      expect(result.type).toBe('transfer');
      expect(typeof result.transaction_id).toBe('string');
      expect(result.batch_id).toBe('batch-uuid');
    });

    it('throws on insufficient funds', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'from-w' }, { id: 'to-w' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ account_id: 'acc-from', currency: 'CLP' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance: '50' }] })   // balance 50 < amount 100
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ account_id: 'acc-to', currency: 'CLP' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance: '0' }] });

      const svc = new TransactionsService(mockDb, makeIdempotencyMock(client as unknown as PoolClient), makeLedgerMock(), makeComplianceMock());
      await expect(svc.createTransfer('key-2', input)).rejects.toThrow('Insufficient funds');
    });

    it('throws on currency mismatch', async () => {
      client.query
        .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'from-w' }, { id: 'to-w' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ account_id: 'acc-from', currency: 'USD' }] }) // wrong currency
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance: '500' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ account_id: 'acc-to', currency: 'CLP' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance: '0' }] });

      const svc = new TransactionsService(mockDb, makeIdempotencyMock(client as unknown as PoolClient), makeLedgerMock(), makeComplianceMock());
      await expect(svc.createTransfer('key-3', input)).rejects.toThrow('Currency mismatch');
    });

    it('throws when amount is not positive', async () => {
      const svc = new TransactionsService(mockDb, makeIdempotencyMock(client as unknown as PoolClient), makeLedgerMock(), makeComplianceMock());
      await expect(svc.createTransfer('key-4', { ...input, amount: '-50' })).rejects.toThrow('positive');
    });
  });

  describe('getTransaction', () => {
    it('returns transaction when found', async () => {
      const row = {
        id: 'tx1', tenant_id: 't1', type: 'transfer', status: 'posted',
        amount: '100', currency: 'CLP', original_transaction_id: null, created_at: '2024-01-01'
      };
      (mockDb.query as jest.Mock).mockResolvedValue({ rowCount: 1, rows: [row] });

      const svc = new TransactionsService(mockDb, {} as any, {} as any, {} as any);
      const result = await svc.getTransaction('tx1');
      expect(result.transaction_id).toBe('tx1');
      expect(result.status).toBe('posted');
    });

    it('throws when transaction not found', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({ rowCount: 0, rows: [] });
      const svc = new TransactionsService(mockDb, {} as any, {} as any, {} as any);
      await expect(svc.getTransaction('missing')).rejects.toThrow('Transaction not found');
    });
  });

  describe('reverseTransaction', () => {
    it('throws when original transaction not found', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({ rowCount: 0, rows: [] });
      const svc = new TransactionsService(mockDb, {} as any, {} as any, {} as any);
      await expect(svc.reverseTransaction('key-r', 'missing-tx')).rejects.toThrow('not found');
    });

    it('throws when original transaction is not posted', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({
        rowCount: 1,
        rows: [{ id: 'tx1', tenant_id: 't1', amount: '100', currency: 'CLP', status: 'pending' }]
      });
      const svc = new TransactionsService(mockDb, {} as any, {} as any, {} as any);
      await expect(svc.reverseTransaction('key-r', 'tx1')).rejects.toThrow('Only posted transactions');
    });

    it('returns reversal on success', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({
        rowCount: 1,
        rows: [{ id: 'tx1', tenant_id: 't1', amount: '100', currency: 'CLP', status: 'posted' }]
      });

      client.query
        .mockResolvedValueOnce({
          rowCount: 2,
          rows: [
            { account_id: 'acc-a', direction: 'debit',  amount: '100', currency: 'CLP' },
            { account_id: 'acc-b', direction: 'credit', amount: '100', currency: 'CLP' }
          ]
        }) // ledger entries
        .mockResolvedValue({}); // insert + updates

      const idempotency = makeIdempotencyMock(client as unknown as PoolClient);
      const svc = new TransactionsService(mockDb, idempotency, makeLedgerMock(), makeComplianceMock());
      const result = await svc.reverseTransaction('key-r', 'tx1');

      expect(result.status).toBe('posted');
      expect(result.original_transaction_id).toBe('tx1');
      expect(typeof result.transaction_id).toBe('string');
    });
  });
});
