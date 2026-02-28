import { IntegrationsService } from './integrations.service';
import { DatabaseService } from '../../common/db/database.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { LedgerService } from '../ledger/ledger.service';
import { ComplianceService } from '../compliance/compliance.service';
import { IConnector } from './connector.interface';
import { PoolClient } from 'pg';

const mockDb = { query: jest.fn() } as unknown as DatabaseService;

function makeLedgerMock() {
  return { post: jest.fn().mockResolvedValue({ batch_id: 'batch-1' }) } as unknown as LedgerService;
}

function makeComplianceMock() {
  return {
    checkDebit: jest.fn().mockResolvedValue(undefined),
    checkCredit: jest.fn().mockResolvedValue(undefined)
  } as unknown as ComplianceService;
}

function makeIdempotencyMock(client: PoolClient) {
  return {
    execute: jest.fn().mockImplementation((_t, _k, _p, handler) => handler(client))
  } as unknown as IdempotencyService;
}

const baseInput = {
  tenant_id: 't1',
  wallet_id: 'w1',
  amount: '100',
  currency: 'CLP',
  provider: 'mock',
  external_reference: 'REF-001'
};

describe('IntegrationsService', () => {
  let svc: IntegrationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new IntegrationsService(mockDb, {} as any, makeLedgerMock(), makeComplianceMock());
    svc.onModuleInit(); // registers MockConnector
  });

  describe('connector registry', () => {
    it('throws on unknown provider', async () => {
      const client = { query: jest.fn() } as unknown as PoolClient;
      const idempotency = makeIdempotencyMock(client);
      const s = new IntegrationsService(mockDb, idempotency, makeLedgerMock(), makeComplianceMock());
      s.onModuleInit();
      await expect(s.cashIn('key-1', { ...baseInput, provider: 'unknown_bank' })).rejects.toThrow('Unknown provider');
    });

    it('register() makes a custom provider available', async () => {
      const custom: IConnector = {
        provider: 'custom_bank',
        validateCashIn: jest.fn().mockResolvedValue(undefined),
        validateCashOut: jest.fn().mockResolvedValue(undefined)
      };

      const client = { query: jest.fn().mockResolvedValue({}) } as unknown as PoolClient;

      // setup client for cashIn happy path
      (client.query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ account_id: 'acc1', currency: 'CLP' }] }) // wallet account
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance: '0' }] })                         // balance
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'clearing-acc' }] })                   // clearing account
        .mockResolvedValue({});

      const idempotency = makeIdempotencyMock(client);
      const s = new IntegrationsService(mockDb, idempotency, makeLedgerMock(), makeComplianceMock());
      s.onModuleInit();
      s.register(custom);

      const result = await s.cashIn('key-2', { ...baseInput, provider: 'custom_bank' });
      expect(custom.validateCashIn).toHaveBeenCalled();
      expect(result.provider).toBe('custom_bank');
    });
  });

  describe('cashIn', () => {
    it('returns posted result on success', async () => {
      const client = { query: jest.fn() } as unknown as PoolClient;
      (client.query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ account_id: 'acc1', currency: 'CLP' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance: '0' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'clearing-acc' }] })
        .mockResolvedValue({});

      const s = new IntegrationsService(mockDb, makeIdempotencyMock(client), makeLedgerMock(), makeComplianceMock());
      s.onModuleInit();

      const result = await s.cashIn('key-ci', baseInput);
      expect(result.direction).toBe('cash_in');
      expect(result.status).toBe('posted');
      expect(typeof result.external_transfer_id).toBe('string');
    });

    it('throws on currency mismatch', async () => {
      const client = { query: jest.fn() } as unknown as PoolClient;
      (client.query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ account_id: 'acc1', currency: 'USD' }] }) // wallet is USD
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance: '0' }] });

      const s = new IntegrationsService(mockDb, makeIdempotencyMock(client), makeLedgerMock(), makeComplianceMock());
      s.onModuleInit();

      await expect(s.cashIn('key-ci2', { ...baseInput, currency: 'CLP' })).rejects.toThrow('Currency mismatch');
    });
  });

  describe('cashOut', () => {
    it('throws on insufficient funds', async () => {
      const client = { query: jest.fn() } as unknown as PoolClient;
      (client.query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'w1' }] }) // lock
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ account_id: 'acc1', currency: 'CLP' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance: '50' }] }); // balance 50 < 100

      const s = new IntegrationsService(mockDb, makeIdempotencyMock(client), makeLedgerMock(), makeComplianceMock());
      s.onModuleInit();

      await expect(s.cashOut('key-co', { ...baseInput, amount: '100' })).rejects.toThrow('Insufficient funds');
    });

    it('returns posted result on success', async () => {
      const client = { query: jest.fn() } as unknown as PoolClient;
      (client.query as jest.Mock)
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'w1' }] })                            // lock
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ account_id: 'acc1', currency: 'CLP' }] }) // wallet account
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance: '500' }] })                      // balance
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'clearing-acc' }] })                  // clearing account
        .mockResolvedValue({});

      const s = new IntegrationsService(mockDb, makeIdempotencyMock(client), makeLedgerMock(), makeComplianceMock());
      s.onModuleInit();

      const result = await s.cashOut('key-co2', baseInput);
      expect(result.direction).toBe('cash_out');
      expect(result.status).toBe('posted');
    });
  });

  describe('getTransfer', () => {
    it('returns transfer when found', async () => {
      const row = {
        id: 'et1', tenant_id: 't1', wallet_id: 'w1', transaction_id: 'tx1',
        provider: 'mock', external_reference: 'REF-001', direction: 'cash_in',
        amount: '100', currency: 'CLP', status: 'posted', created_at: '2024-01-01'
      };
      (mockDb.query as jest.Mock).mockResolvedValue({ rowCount: 1, rows: [row] });

      const s = new IntegrationsService(mockDb, {} as any, {} as any, {} as any);
      const result = await s.getTransfer('et1');
      expect(result.external_transfer_id).toBe('et1');
      expect(result.direction).toBe('cash_in');
    });

    it('throws when not found', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({ rowCount: 0, rows: [] });
      const s = new IntegrationsService(mockDb, {} as any, {} as any, {} as any);
      await expect(s.getTransfer('missing')).rejects.toThrow('External transfer not found');
    });
  });
});
