import { describe, expect, it } from 'vitest';
import { createLedgerBaseline, replayTransactions } from './portfolioAccounting';
import type { Holding, PortfolioTransaction } from './types';

function holding(symbol: string, shares: number, costBasis: number): Holding {
  return {
    symbol,
    shares,
    costBasis,
    styleTags: [],
    thesisTags: [],
    entryDate: new Date().toISOString().slice(0, 10),
  };
}

describe('createLedgerBaseline', () => {
  it('creates baseline with holdings and cash', () => {
    const holdings = [holding('AAPL', 10, 150)];
    const baseline = createLedgerBaseline(holdings, 1000);

    expect(baseline.holdings).toHaveLength(1);
    expect(baseline.holdings[0].symbol).toBe('AAPL');
    expect(baseline.investableCash).toBe(1000);
    expect(baseline.asOf).toBeDefined();
  });
});

describe('replayTransactions', () => {
  it('applies deposit and updates cash', () => {
    const baseline = createLedgerBaseline([], 1000);
    const transactions: PortfolioTransaction[] = [
      {
        id: '1',
        kind: 'deposit',
        date: new Date().toISOString().slice(0, 10),
        amount: 500,
        source: 'manual',
      },
    ];

    const result = replayTransactions(baseline, transactions);

    expect(result.investableCash).toBe(1500);
  });
});
