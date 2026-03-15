import { describe, expect, it } from 'vitest';
import { mergeRecommendationHistory, summarizeRecommendationHistory } from './recommendationHistory';
import type { RecommendationRunSnapshot } from './types';

function run(
  runAt: string,
  priceAtRun: number,
  benchmarkPrice: number,
  action: RecommendationRunSnapshot['records'][number]['action'] = 'Buy now',
): RecommendationRunSnapshot {
  return {
    runAt,
    datasetAsOf: runAt.slice(0, 10),
    regimeKey: 'Sideways / low conviction',
    deploymentTilt: 0,
    portfolioValue: 10_000,
    benchmarkPrice,
    records: [
      {
        symbol: 'MSFT',
        sector: 'Technology',
        action,
        composite: 78,
        opportunityScore: 80,
        timingScore: 72,
        portfolioFitScore: 68,
        confidence: 74,
        dataQualityScore: 82,
        riskOverall: 44,
        riskBucket: 'Moderate',
        expected12m: 0.12,
        confidenceBand: 'High confidence',
        priceAtRun,
        reasonTags: ['Quality', 'Momentum'],
      },
    ],
  };
}

describe('mergeRecommendationHistory', () => {
  it('backfills forward outcomes when enough time has elapsed', () => {
    const first = run('2026-01-01T12:00:00.000Z', 100, 400);
    const second = run('2026-02-05T12:00:00.000Z', 110, 420);

    const history = mergeRecommendationHistory([first], second);
    const outcomes = history[0].records[0].outcomes;

    expect(outcomes?.['1W']?.forwardReturn).toBe(0.1);
    expect(outcomes?.['1M']?.benchmarkRelativeReturn).toBe(0.05);
    expect(outcomes?.['1M']?.hit).toBe(true);
  });

  it('does not append an unchanged duplicate run', () => {
    const first = run('2026-01-01T12:00:00.000Z', 100, 400);
    const history = mergeRecommendationHistory([first], {
      ...first,
      runAt: '2026-01-02T12:00:00.000Z',
    });

    expect(history).toHaveLength(1);
  });
});

describe('summarizeRecommendationHistory', () => {
  it('summarizes action accuracy and horizon coverage', () => {
    const first = run('2026-01-01T12:00:00.000Z', 100, 400);
    const second = run('2026-02-05T12:00:00.000Z', 110, 420, 'Buy partial');
    const history = mergeRecommendationHistory([first], second);

    const summary = summarizeRecommendationHistory(history);

    expect(summary.runs).toBe(2);
    expect(summary.actionAccuracy[0].action).toBe('Buy now');
    expect(summary.horizonCoverage.find((item) => item.horizon === '1M')?.resolved).toBeGreaterThan(0);
  });
});
