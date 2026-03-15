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

  it('clips oversized sells and records a note', () => {
    const baseline = createLedgerBaseline([holding('AAPL', 2, 100)], 0);
    const transactions: PortfolioTransaction[] = [
      {
        id: 'sell-1',
        kind: 'sell',
        date: new Date().toISOString().slice(0, 10),
        symbol: 'AAPL',
        shares: 5,
        price: 120,
        source: 'manual',
      },
    ];

    const result = replayTransactions(baseline, transactions);

    expect(result.holdings).toHaveLength(0);
    expect(result.investableCash).toBe(240);
    expect(result.summary.realizedPnl).toBe(40);
    expect(result.summary.notes[0]).toContain('clipped to 2 shares');
  });

  it('applies splits by increasing shares and reducing cost basis', () => {
    const baseline = createLedgerBaseline([holding('NVDA', 3, 900)], 100);
    const transactions: PortfolioTransaction[] = [
      {
        id: 'split-1',
        kind: 'split',
        date: new Date().toISOString().slice(0, 10),
        symbol: 'NVDA',
        splitRatio: 10,
        source: 'manual',
      },
    ];

    const result = replayTransactions(baseline, transactions);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].shares).toBe(30);
    expect(result.holdings[0].costBasis).toBe(90);
    expect(result.investableCash).toBe(100);
  });
});
