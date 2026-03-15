import { buildCommandCenterModel } from './engine';
import { average, round } from './math';
import type { ActionLabel, ConfidenceBand, MockDataset, ValidationReport } from './types';

interface ValidationObservation {
  symbol: string;
  sector: string;
  action: ActionLabel;
  confidenceBand: ConfidenceBand;
  composite: number;
  probabilityPositive: number;
  forwardReturn: number;
  benchmarkRelativeReturn: number;
  regime: string;
}

function decileForScore(score: number) {
  return Math.max(1, Math.min(10, Math.ceil(score / 10)));
}

function bucketForProbability(probability: number) {
  const lower = Math.floor(probability * 10) * 10;
  const upper = Math.min(lower + 10, 100);
  return `${lower}-${upper}%`;
}

function topActionableSymbols(dataset: MockDataset) {
  const model = buildCommandCenterModel(dataset);
  return model.scorecards
    .filter((card) => ['Buy now', 'Buy partial', 'Accumulate slowly'].includes(card.action))
    .slice(0, 10)
    .map((card) => card.symbol);
}

export function buildValidationReport(snapshots: MockDataset[]): ValidationReport {
  if (snapshots.length < 2) {
    return {
      generatedAt: new Date().toISOString(),
      snapshotCount: snapshots.length,
      pairCount: 0,
      hitRate: 0,
      averageForwardReturn: 0,
      averageBenchmarkRelativeReturn: 0,
      averageTurnover: 0,
      brierScore: 0,
      scoreDeciles: [],
      calibration: [],
      regimes: [],
      notes: ['At least two point-in-time snapshots are required to build a validation report.'],
    };
  }

  const ordered = [...snapshots].sort((left, right) => left.asOf.localeCompare(right.asOf));
  const observations: ValidationObservation[] = [];
  const turnoverSeries: number[] = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    const currentModel = buildCommandCenterModel(current);
    const nextLookup = new Map(next.securities.map((security) => [security.symbol, security]));
    const benchmarkReturn =
      current.benchmark.price > 0 ? next.benchmark.price / current.benchmark.price - 1 : 0;
    const currentActionable = topActionableSymbols(current);
    const nextActionable = topActionableSymbols(next);
    const retained = currentActionable.filter((symbol) => nextActionable.includes(symbol)).length;
    const turnover =
      currentActionable.length === 0
        ? 0
        : 1 - retained / Math.max(currentActionable.length, nextActionable.length, 1);

    turnoverSeries.push(turnover);

    currentModel.scorecards.forEach((card) => {
      const nextSecurity = nextLookup.get(card.symbol);
      const currentSecurity = current.securities.find((security) => security.symbol === card.symbol);

      if (!currentSecurity || !nextSecurity || currentSecurity.price <= 0) {
        return;
      }

      const forwardReturn = nextSecurity.price / currentSecurity.price - 1;

      observations.push({
        symbol: card.symbol,
        sector: currentSecurity.sector,
        action: card.action,
        confidenceBand: card.confidenceBand,
        composite: card.composite,
        probabilityPositive: card.expectedReturns[2].probabilityPositive,
        forwardReturn,
        benchmarkRelativeReturn: forwardReturn - benchmarkReturn,
        regime: currentModel.regime.key,
      });
    });
  }

  const hitRate =
    observations.length === 0
      ? 0
      : observations.filter((observation) => observation.forwardReturn > 0).length / observations.length;
  const averageForwardReturn = average(observations.map((observation) => observation.forwardReturn));
  const averageBenchmarkRelativeReturn = average(
    observations.map((observation) => observation.benchmarkRelativeReturn),
  );
  const brierScore = average(
    observations.map((observation) => {
      const actual = observation.forwardReturn > 0 ? 1 : 0;
      return (observation.probabilityPositive - actual) ** 2;
    }),
  );

  const scoreDeciles = Array.from({ length: 10 }, (_, index) => index + 1)
    .map((decile) => {
      const bucket = observations.filter((observation) => decileForScore(observation.composite) === decile);

      return {
        decile,
        count: bucket.length,
        avgForwardReturn: round(average(bucket.map((observation) => observation.forwardReturn)), 4),
        avgBenchmarkRelativeReturn: round(
          average(bucket.map((observation) => observation.benchmarkRelativeReturn)),
          4,
        ),
        hitRate: round(
          bucket.length === 0
            ? 0
            : bucket.filter((observation) => observation.forwardReturn > 0).length / bucket.length,
          4,
        ),
      };
    })
    .filter((bucket) => bucket.count > 0);

  const calibration = [...new Set(observations.map((observation) => bucketForProbability(observation.probabilityPositive)))]
    .sort()
    .map((bucketLabel) => {
      const bucket = observations.filter(
        (observation) => bucketForProbability(observation.probabilityPositive) === bucketLabel,
      );

      return {
        bucket: bucketLabel,
        count: bucket.length,
        predicted: round(average(bucket.map((observation) => observation.probabilityPositive)), 4),
        realized: round(
          bucket.length === 0
            ? 0
            : bucket.filter((observation) => observation.forwardReturn > 0).length / bucket.length,
          4,
        ),
        brier: round(
          average(
            bucket.map((observation) => {
              const actual = observation.forwardReturn > 0 ? 1 : 0;
              return (observation.probabilityPositive - actual) ** 2;
            }),
          ),
          4,
        ),
      };
    });

  const regimes = [...new Set(observations.map((observation) => observation.regime))].map((regime) => {
    const bucket = observations.filter((observation) => observation.regime === regime);

    return {
      regime,
      count: bucket.length,
      avgForwardReturn: round(average(bucket.map((observation) => observation.forwardReturn)), 4),
      hitRate: round(
        bucket.length === 0
          ? 0
          : bucket.filter((observation) => observation.forwardReturn > 0).length / bucket.length,
        4,
      ),
    };
  });

  const actions = [...new Set(observations.map((observation) => observation.action))]
    .map((action) => {
      const bucket = observations.filter((observation) => observation.action === action);

      return {
        action,
        count: bucket.length,
        avgForwardReturn: round(average(bucket.map((observation) => observation.forwardReturn)), 4),
        avgBenchmarkRelativeReturn: round(
          average(bucket.map((observation) => observation.benchmarkRelativeReturn)),
          4,
        ),
        hitRate: round(
          bucket.length === 0
            ? 0
            : bucket.filter((observation) => observation.forwardReturn > 0).length / bucket.length,
          4,
        ),
      };
    })
    .filter((bucket) => bucket.count > 0)
    .sort((left, right) => right.count - left.count);

  const confidenceBands = [...new Set(observations.map((observation) => observation.confidenceBand))]
    .map((band) => {
      const bucket = observations.filter((observation) => observation.confidenceBand === band);

      return {
        band,
        count: bucket.length,
        predicted: round(average(bucket.map((observation) => observation.probabilityPositive)), 4),
        realized: round(
          bucket.length === 0
            ? 0
            : bucket.filter((observation) => observation.forwardReturn > 0).length / bucket.length,
          4,
        ),
        avgForwardReturn: round(average(bucket.map((observation) => observation.forwardReturn)), 4),
        hitRate: round(
          bucket.length === 0
            ? 0
            : bucket.filter((observation) => observation.forwardReturn > 0).length / bucket.length,
          4,
        ),
        brier: round(
          average(
            bucket.map((observation) => {
              const actual = observation.forwardReturn > 0 ? 1 : 0;
              return (observation.probabilityPositive - actual) ** 2;
            }),
          ),
          4,
        ),
      };
    })
    .filter((bucket) => bucket.count > 0)
    .sort((left, right) => right.count - left.count);

  const sectors = [...new Set(observations.map((observation) => observation.sector))]
    .map((sector) => {
      const bucket = observations.filter((observation) => observation.sector === sector);

      return {
        sector,
        count: bucket.length,
        avgForwardReturn: round(average(bucket.map((observation) => observation.forwardReturn)), 4),
        avgBenchmarkRelativeReturn: round(
          average(bucket.map((observation) => observation.benchmarkRelativeReturn)),
          4,
        ),
        hitRate: round(
          bucket.length === 0
            ? 0
            : bucket.filter((observation) => observation.forwardReturn > 0).length / bucket.length,
          4,
        ),
      };
    })
    .filter((bucket) => bucket.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 12);

  const topDecile = scoreDeciles.find((bucket) => bucket.decile === 10)?.avgForwardReturn ?? 0;
  const bottomDecile = scoreDeciles.find((bucket) => bucket.decile === 1)?.avgForwardReturn ?? 0;
  const avoidBucket = actions.find((bucket) => bucket.action === 'Avoid');
  const highConfidenceBucket = confidenceBands.find((bucket) => bucket.band === 'High confidence');

  return {
    generatedAt: new Date().toISOString(),
    snapshotCount: ordered.length,
    pairCount: Math.max(ordered.length - 1, 0),
    hitRate: round(hitRate, 4),
    averageForwardReturn: round(averageForwardReturn, 4),
    averageBenchmarkRelativeReturn: round(averageBenchmarkRelativeReturn, 4),
    averageTurnover: round(average(turnoverSeries), 4),
    brierScore: round(brierScore, 4),
    scoreDeciles,
    calibration,
    regimes,
    actions,
    confidenceBands,
    sectors,
    notes: [
      'Validation uses point-in-time snapshot pairs and measures forward price change into the next available snapshot.',
      'This is intentionally simple and leakage-aware, but it is only as strong as the snapshot history you have recorded.',
      `Top-vs-bottom decile spread is ${round(topDecile - bottomDecile, 4)}.`,
      highConfidenceBucket
        ? `High-confidence ideas realized ${round(highConfidenceBucket.realized * 100, 1)}% wins with predicted ${round(highConfidenceBucket.predicted * 100, 1)}% upside odds.`
        : 'No high-confidence calibration bucket is available yet.',
      avoidBucket
        ? `Avoid signals averaged ${round(avoidBucket.avgForwardReturn * 100, 1)}% forward return.`
        : 'No Avoid bucket observations are available yet.',
    ],
  };
}
