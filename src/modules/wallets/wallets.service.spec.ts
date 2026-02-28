import { WalletsService } from './wallets.service';
import { DatabaseService } from '../../common/db/database.service';

const mockDb = {
  withTransaction: jest.fn(),
  query: jest.fn()
} as unknown as DatabaseService;

describe('WalletsService', () => {
  let svc: WalletsService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new WalletsService(mockDb);
  });

  describe('createWallet', () => {
    it('returns created wallet shape', async () => {
      (mockDb.withTransaction as jest.Mock).mockImplementation((fn) => {
        const client = { query: jest.fn().mockResolvedValue({}) };
        return fn(client);
      });

      const result = await svc.createWallet({
        tenant_id: 'tenant-1',
        owner_id: 'owner-1',
        currency: 'CLP'
      });

      expect(result).toMatchObject({
        tenant_id: 'tenant-1',
        owner_id: 'owner-1',
        currency: 'CLP',
        status: 'active'
      });
      expect(typeof result.wallet_id).toBe('string');
    });
  });

  describe('getWallet', () => {
    it('returns wallet when found', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({
        rowCount: 1,
        rows: [{ id: 'w1', tenant_id: 't1', owner_id: 'o1', currency: 'CLP', status: 'active' }]
      });

      const result = await svc.getWallet('w1');
      expect(result).toEqual({ wallet_id: 'w1', tenant_id: 't1', owner_id: 'o1', currency: 'CLP', status: 'active' });
    });

    it('throws when wallet not found', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({ rowCount: 0, rows: [] });
      await expect(svc.getWallet('nonexistent')).rejects.toThrow('Wallet not found');
    });
  });

  describe('getBalance', () => {
    it('returns balance fields', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({
        rowCount: 1,
        rows: [{ currency: 'CLP', balance: '1500.00' }]
      });

      const result = await svc.getBalance('w1');
      expect(result).toEqual({ wallet_id: 'w1', available: '1500.00', ledger: '1500.00', currency: 'CLP' });
    });

    it('throws when wallet not found', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({ rowCount: 0, rows: [] });
      await expect(svc.getBalance('nonexistent')).rejects.toThrow('Wallet not found');
    });
  });
});
