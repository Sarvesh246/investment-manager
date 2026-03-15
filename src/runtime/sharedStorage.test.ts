import { describe, expect, it } from 'vitest';
import { mergePortfolioHistoryStores, normalizePortfolioHistory } from './sharedStorage';

describe('normalizePortfolioHistory', () => {
  it('keeps the latest snapshot per intraday bucket', () => {
    const history = normalizePortfolioHistory({
      intraday: [
        {
          timestamp: '2026-03-13T10:03:00.000Z',
          portfolioValue: 100,
          holdingsValue: 80,
          cashValue: 20,
          costBasisValue: 90,
          holdingCount: 1,
        },
        {
          timestamp: '2026-03-13T10:12:00.000Z',
          portfolioValue: 125,
          holdingsValue: 100,
          cashValue: 25,
          costBasisValue: 90,
          holdingCount: 1,
        },
      ],
    });

    expect(history.intraday).toHaveLength(1);
    expect(history.intraday[0].portfolioValue).toBe(125);
  });
});

describe('mergePortfolioHistoryStores', () => {
  it('prefers the newer snapshot when the same bucket exists in both stores', () => {
    const merged = mergePortfolioHistoryStores(
      {
        intraday: [
          {
            timestamp: '2026-03-13T10:00:00.000Z',
            granularity: 'intraday',
            portfolioValue: 100,
            holdingsValue: 80,
            cashValue: 20,
            costBasisValue: 90,
            holdingCount: 1,
          },
        ],
        daily: [],
      },
      {
        intraday: [
          {
            timestamp: '2026-03-13T10:10:00.000Z',
            granularity: 'intraday',
            portfolioValue: 110,
            holdingsValue: 90,
            cashValue: 20,
            costBasisValue: 90,
            holdingCount: 1,
          },
        ],
        daily: [],
      },
    );

    expect(merged.intraday).toHaveLength(1);
    expect(merged.intraday[0].portfolioValue).toBe(110);
  });
});
