import { ComplianceService } from './compliance.service';
import { DatabaseService } from '../../common/db/database.service';
import { PoolClient } from 'pg';

const mockDb = { query: jest.fn() } as unknown as DatabaseService;

function makeClient(overrides: Record<string, unknown> = {}) {
  return { query: jest.fn(), ...overrides } as unknown as PoolClient;
}

describe('ComplianceService', () => {
  let svc: ComplianceService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new ComplianceService(mockDb);
  });

  describe('getPolicy', () => {
    it('returns null when no policy exists', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({ rowCount: 0, rows: [] });
      expect(await svc.getPolicy('t1', 'CLP')).toBeNull();
    });

    it('returns policy when found', async () => {
      const policy = { max_single_amount: '500000', max_daily_wallet_debit: null, max_wallet_balance: null, requires_kyc: false };
      (mockDb.query as jest.Mock).mockResolvedValue({ rowCount: 1, rows: [policy] });
      expect(await svc.getPolicy('t1', 'CLP')).toEqual(policy);
    });
  });

  describe('checkDebit', () => {
    it('skips all checks when no policy', async () => {
      const client = makeClient();
      (client.query as jest.Mock).mockResolvedValue({ rowCount: 0, rows: [] }); // no policy
      await expect(svc.checkDebit(client, 't1', 'w1', 'acc1', 100, 'CLP')).resolves.toBeUndefined();
    });

    it('throws when amount exceeds max_single_amount', async () => {
      const client = makeClient();
      (client.query as jest.Mock).mockResolvedValue({
        rowCount: 1,
        rows: [{ max_single_amount: '500', max_daily_wallet_debit: null, max_wallet_balance: null, requires_kyc: false }]
      });
      await expect(svc.checkDebit(client, 't1', 'w1', 'acc1', 1000, 'CLP')).rejects.toThrow('single transaction limit');
    });

    it('throws when daily debit limit exceeded', async () => {
      const client = makeClient();
      (client.query as jest.Mock)
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ max_single_amount: null, max_daily_wallet_debit: '1000', max_wallet_balance: null, requires_kyc: false }]
        }) // policy
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ total: '900' }] }); // daily already 900

      await expect(svc.checkDebit(client, 't1', 'w1', 'acc1', 200, 'CLP')).rejects.toThrow('Daily debit limit');
    });

    it('throws when KYC required but wallet not verified', async () => {
      const client = makeClient();
      (client.query as jest.Mock)
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ max_single_amount: null, max_daily_wallet_debit: null, max_wallet_balance: null, requires_kyc: true }]
        }) // policy
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ kyc_verified: false }] }); // wallet not verified

      await expect(svc.checkDebit(client, 't1', 'w1', 'acc1', 100, 'CLP')).rejects.toThrow('KYC verification');
    });

    it('passes when KYC verified', async () => {
      const client = makeClient();
      (client.query as jest.Mock)
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ max_single_amount: null, max_daily_wallet_debit: null, max_wallet_balance: null, requires_kyc: true }]
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ kyc_verified: true }] });

      await expect(svc.checkDebit(client, 't1', 'w1', 'acc1', 100, 'CLP')).resolves.toBeUndefined();
    });
  });

  describe('checkCredit', () => {
    it('skips all checks when no policy', async () => {
      const client = makeClient();
      (client.query as jest.Mock).mockResolvedValue({ rowCount: 0, rows: [] });
      await expect(svc.checkCredit(client, 't1', 'w1', 100, 'CLP', 0)).resolves.toBeUndefined();
    });

    it('throws when balance would exceed max_wallet_balance', async () => {
      const client = makeClient();
      (client.query as jest.Mock).mockResolvedValue({
        rowCount: 1,
        rows: [{ max_single_amount: null, max_daily_wallet_debit: null, max_wallet_balance: '1000', requires_kyc: false }]
      });
      // current balance 900 + amount 200 = 1100 > 1000
      await expect(svc.checkCredit(client, 't1', 'w1', 200, 'CLP', 900)).rejects.toThrow('max wallet balance');
    });

    it('passes when new balance is within limit', async () => {
      const client = makeClient();
      (client.query as jest.Mock).mockResolvedValue({
        rowCount: 1,
        rows: [{ max_single_amount: null, max_daily_wallet_debit: null, max_wallet_balance: '1000', requires_kyc: false }]
      });
      // 500 + 400 = 900 <= 1000
      await expect(svc.checkCredit(client, 't1', 'w1', 400, 'CLP', 500)).resolves.toBeUndefined();
    });
  });
});
