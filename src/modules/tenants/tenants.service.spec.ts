import { TenantsService } from './tenants.service';
import { DatabaseService } from '../../common/db/database.service';

const mockDb = {
  query: jest.fn()
} as unknown as DatabaseService;

describe('TenantsService', () => {
  let svc: TenantsService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new TenantsService(mockDb);
  });

  describe('createTenant', () => {
    it('returns created tenant shape', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({});

      const result = await svc.createTenant({ name: 'Acme', country_code: 'cl' });

      expect(result).toMatchObject({
        name: 'Acme',
        country_code: 'CL'
      });
      expect(typeof result.tenant_id).toBe('string');
    });

    it('uppercases country_code', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({});

      const result = await svc.createTenant({ name: 'Test', country_code: 'us' });
      expect(result.country_code).toBe('US');
    });
  });

  describe('getTenant', () => {
    it('returns tenant when found', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({
        rowCount: 1,
        rows: [{ id: 't1', name: 'Acme', country_code: 'CL', created_at: '2024-01-01' }]
      });

      const result = await svc.getTenant('t1');
      expect(result).toEqual({
        tenant_id: 't1',
        name: 'Acme',
        country_code: 'CL',
        created_at: '2024-01-01'
      });
    });

    it('throws when tenant not found', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue({ rowCount: 0, rows: [] });
      await expect(svc.getTenant('missing')).rejects.toThrow('Tenant not found');
    });
  });
});
