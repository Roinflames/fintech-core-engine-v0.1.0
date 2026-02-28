import { MockConnector } from './mock.connector';

const params = { tenantId: 't1', walletId: 'w1', amount: '100', currency: 'CLP', externalReference: 'REF-001' };

describe('MockConnector', () => {
  const connector = new MockConnector();

  it('provider is "mock"', () => {
    expect(connector.provider).toBe('mock');
  });

  it('validateCashIn passes with valid params', async () => {
    await expect(connector.validateCashIn(params)).resolves.toBeUndefined();
  });

  it('validateCashOut passes with valid params', async () => {
    await expect(connector.validateCashOut(params)).resolves.toBeUndefined();
  });

  it('validateCashIn throws when external_reference is empty', async () => {
    await expect(connector.validateCashIn({ ...params, externalReference: '' })).rejects.toThrow('external_reference');
  });

  it('validateCashOut throws when external_reference is empty', async () => {
    await expect(connector.validateCashOut({ ...params, externalReference: '' })).rejects.toThrow('external_reference');
  });
});
