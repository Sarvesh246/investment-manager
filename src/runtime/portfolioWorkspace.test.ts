import { describe, expect, it } from 'vitest';
import { createLedgerBaseline } from '../domain/portfolioAccounting';
import { currentDataset } from '../data/currentDataset';
import { parsePersistedState, resolveLedgerBaselineForTransactions } from './portfolioWorkspace';

describe('parsePersistedState', () => {
  it('preserves explicitly empty journal and watchlists arrays', () => {
    const parsed = parsePersistedState(
      JSON.stringify({
        investableCash: 250,
        holdings: [],
        transactions: [],
        journal: [],
        watchlists: [],
      }),
    );

    expect(parsed.journal).toEqual([]);
    expect(parsed.watchlists).toEqual([]);
    expect(parsed.investableCash).toBe(250);
  });

  it('falls back to seeded journal and watchlists when keys are missing', () => {
    const parsed = parsePersistedState(
      JSON.stringify({
        investableCash: 0,
        holdings: [],
        transactions: [],
      }),
    );

    expect(parsed.journal).toHaveLength(currentDataset.journal.length);
    expect(parsed.watchlists).toHaveLength(currentDataset.watchlists.length);
  });
});

describe('resolveLedgerBaselineForTransactions', () => {
  it('keeps the current baseline when there are no transactions', () => {
    const current = createLedgerBaseline([], 100);

    const next = resolveLedgerBaselineForTransactions(current, [], 250, 0);

    expect(next).toBe(current);
  });

  it('refreshes the baseline when holdings or cash change while ledger mode is active', () => {
    const current = createLedgerBaseline([], 100);

    const next = resolveLedgerBaselineForTransactions(
      current,
      [
        {
          symbol: 'AAPL',
          shares: 2,
          costBasis: 150,
          styleTags: [],
          thesisTags: [],
          entryDate: '2026-03-13',
        },
      ],
      250,
      2,
    );

    expect(next).not.toBe(current);
    expect(next?.investableCash).toBe(250);
    expect(next?.holdings[0].symbol).toBe('AAPL');
  });
});
