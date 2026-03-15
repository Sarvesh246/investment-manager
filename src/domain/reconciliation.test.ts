import { describe, expect, it } from 'vitest';
import { buildPortfolioReconciliation } from './reconciliation';

describe('buildPortfolioReconciliation', () => {
  it('flags missing positions and value differences cleanly', () => {
    const reconciliation = buildPortfolioReconciliation({
      brokerSnapshot: {
        importedAt: '2026-03-15T00:00:00.000Z',
        source: 'broker.csv',
        format: 'generic',
        positions: [
          { symbol: 'AAPL', shares: 2, costBasis: 150, marketValue: 350 },
          { symbol: 'NVDA', shares: 1, costBasis: 800, marketValue: 900 },
        ],
        cash: 100,
        holdingsValue: 1250,
        portfolioValue: 1350,
        rawRowCount: 2,
        notes: [],
      },
      holdings: [
        {
          symbol: 'AAPL',
          shares: 2,
          costBasis: 150,
          marketValue: 352,
          unrealizedPnl: 52,
          weight: 50,
          gainLossPct: 17.3,
          action: 'Hold',
          riskContribution: 10,
          overlapToPortfolio: 20,
          concentrationFlag: false,
          thesisHealth: 'Stable',
          confidenceBand: 'High confidence',
        },
        {
          symbol: 'MSFT',
          shares: 1,
          costBasis: 300,
          marketValue: 400,
          unrealizedPnl: 100,
          weight: 50,
          gainLossPct: 33.3,
          action: 'Hold',
          riskContribution: 10,
          overlapToPortfolio: 20,
          concentrationFlag: false,
          thesisHealth: 'Stable',
          confidenceBand: 'High confidence',
        },
      ],
      investableCash: 120,
      portfolioValue: 872,
    });

    expect(reconciliation).not.toBeNull();
    expect(reconciliation?.items.find((item) => item.symbol === 'MSFT')?.status).toBe('Missing in broker');
    expect(reconciliation?.items.find((item) => item.symbol === 'NVDA')?.status).toBe('Missing in app');
    expect(reconciliation?.items.find((item) => item.symbol === 'AAPL')?.status).toBe('Price differs');
    expect(reconciliation?.likelyCauses).toContain(
      'One or more positions are missing between the app and the imported broker snapshot.',
    );
  });
});
