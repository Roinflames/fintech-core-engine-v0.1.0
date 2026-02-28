import { LedgerService } from './ledger.service';

describe('LedgerService.validateBalanced', () => {
  const svc = new LedgerService();

  it('passes on balanced two-line batch', () => {
    expect(() => svc.validateBalanced([
      { accountId: 'a', direction: 'debit',  amount: '100', currency: 'CLP' },
      { accountId: 'b', direction: 'credit', amount: '100', currency: 'CLP' }
    ])).not.toThrow();
  });

  it('throws on empty lines', () => {
    expect(() => svc.validateBalanced([])).toThrow('Posting lines are required');
  });

  it('throws when unbalanced', () => {
    expect(() => svc.validateBalanced([
      { accountId: 'a', direction: 'debit',  amount: '100', currency: 'CLP' },
      { accountId: 'b', direction: 'credit', amount: '90',  currency: 'CLP' }
    ])).toThrow('Unbalanced posting batch');
  });

  it('throws on mixed currencies', () => {
    expect(() => svc.validateBalanced([
      { accountId: 'a', direction: 'debit',  amount: '100', currency: 'CLP' },
      { accountId: 'b', direction: 'credit', amount: '100', currency: 'USD' }
    ])).toThrow('Mixed currencies');
  });

  it('throws on non-positive amount', () => {
    expect(() => svc.validateBalanced([
      { accountId: 'a', direction: 'debit',  amount: '0',   currency: 'CLP' },
      { accountId: 'b', direction: 'credit', amount: '0',   currency: 'CLP' }
    ])).toThrow('Posting amount must be > 0');
  });
});
