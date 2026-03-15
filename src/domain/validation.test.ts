import { describe, expect, it } from 'vitest';
import { mockDataset } from '../data/mockData';
import { buildValidationReport } from './validation';
import type { MockDataset } from './types';

function cloneDataset(asOf: string, priceBump: number): MockDataset {
  return {
    ...mockDataset,
    asOf,
    benchmark: {
      ...mockDataset.benchmark,
      price: mockDataset.benchmark.price * (1 + priceBump / 2),
    },
    securities: mockDataset.securities.map((security, index) => ({
      ...security,
      price: security.price * (1 + priceBump + index * 0.001),
      priceHistory: [...security.priceHistory],
      scoreHistory: [...security.scoreHistory],
      thesisNotes: [...security.thesisNotes],
      watchPoints: [...security.watchPoints],
      metrics: { ...security.metrics },
      factors: { ...security.factors },
      dataQuality: security.dataQuality
        ? {
            ...security.dataQuality,
            missingCoreFields: [...security.dataQuality.missingCoreFields],
            notes: [...security.dataQuality.notes],
          }
        : undefined,
    })),
    holdings: mockDataset.holdings.map((holding) => ({ ...holding, styleTags: [...holding.styleTags], thesisTags: [...holding.thesisTags] })),
    watchlists: mockDataset.watchlists.map((watchlist) => ({ ...watchlist, symbols: [...watchlist.symbols] })),
    journal: mockDataset.journal.map((entry) => ({ ...entry })),
    syncNotes: mockDataset.syncNotes ? [...mockDataset.syncNotes] : undefined,
  };
}

describe('buildValidationReport', () => {
  it('builds action, confidence, and sector slices from snapshot pairs', () => {
    const report = buildValidationReport([
      cloneDataset('2026-01-01', 0),
      cloneDataset('2026-02-01', 0.04),
    ]);

    expect(report.pairCount).toBe(1);
    expect(report.scoreDeciles.length).toBeGreaterThan(0);
    expect(report.actions && report.actions.length).toBeGreaterThan(0);
    expect(report.confidenceBands && report.confidenceBands.length).toBeGreaterThan(0);
    expect(report.sectors && report.sectors.length).toBeGreaterThan(0);
    expect(report.notes.length).toBeGreaterThan(2);
  });
});
