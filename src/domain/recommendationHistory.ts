import { round } from './math';
import type {
  ActionLabel,
  DecisionAuditRecord,
  OutcomeHorizon,
  RecommendationOutcome,
  RecommendationRecord,
  RecommendationRunSnapshot,
} from './types';

export const recommendationOutcomeHorizonDays: Record<OutcomeHorizon, number> = {
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '12M': 365,
};

function daysBetween(earlier: string, later: string) {
  const earlierDate = new Date(earlier);
  const laterDate = new Date(later);

  if (Number.isNaN(earlierDate.getTime()) || Number.isNaN(laterDate.getTime())) {
    return 0;
  }

  return Math.max(0, Math.round((laterDate.getTime() - earlierDate.getTime()) / (24 * 60 * 60 * 1000)));
}

function recordMateriallyChanged(previous: RecommendationRecord, current: RecommendationRecord) {
  return (
    previous.action !== current.action ||
    Math.round(previous.composite) !== Math.round(current.composite) ||
    previous.confidenceBand !== current.confidenceBand ||
    Math.round(previous.riskOverall) !== Math.round(current.riskOverall)
  );
}

function runMateriallyChanged(previous: RecommendationRunSnapshot, current: RecommendationRunSnapshot) {
  if (previous.datasetAsOf !== current.datasetAsOf || previous.regimeKey !== current.regimeKey) {
    return true;
  }

  if (previous.records.length !== current.records.length) {
    return true;
  }

  const currentLookup = new Map(current.records.map((record) => [record.symbol, record]));

  return previous.records.some((record) => {
    const candidate = currentLookup.get(record.symbol);
    return !candidate || recordMateriallyChanged(record, candidate);
  });
}

function buildOutcome(
  previousRun: RecommendationRunSnapshot,
  previousRecord: RecommendationRecord,
  laterRun: RecommendationRunSnapshot,
  laterRecord: RecommendationRecord,
  horizon: OutcomeHorizon,
): RecommendationOutcome | null {
  if (
    previousRecord.priceAtRun == null ||
    laterRecord.priceAtRun == null ||
    previousRecord.priceAtRun <= 0 ||
    laterRecord.priceAtRun <= 0 ||
    previousRun.benchmarkPrice == null ||
    laterRun.benchmarkPrice == null ||
    previousRun.benchmarkPrice <= 0 ||
    laterRun.benchmarkPrice <= 0
  ) {
    return null;
  }

  const forwardReturn = laterRecord.priceAtRun / previousRecord.priceAtRun - 1;
  const benchmarkReturn = laterRun.benchmarkPrice / previousRun.benchmarkPrice - 1;
  const benchmarkRelativeReturn = forwardReturn - benchmarkReturn;

  return {
    horizon,
    measuredAt: laterRun.runAt,
    forwardReturn: round(forwardReturn, 4),
    benchmarkRelativeReturn: round(benchmarkRelativeReturn, 4),
    hit: forwardReturn > 0,
    outperformed: benchmarkRelativeReturn > 0,
  };
}

function backfillRecommendationOutcomes(
  history: RecommendationRunSnapshot[],
  newestRun: RecommendationRunSnapshot,
) {
  const latestRecordLookup = new Map(newestRun.records.map((record) => [record.symbol, record]));

  return history.map((run) => {
    if (run.runAt === newestRun.runAt) {
      return newestRun;
    }

    const elapsedDays = daysBetween(run.runAt, newestRun.runAt);

    const nextRecords = run.records.map((record) => {
      const latestRecord = latestRecordLookup.get(record.symbol);

      if (!latestRecord) {
        return record;
      }

      let outcomes = record.outcomes;

      (Object.entries(recommendationOutcomeHorizonDays) as Array<[OutcomeHorizon, number]>).forEach(
        ([horizon, requiredDays]) => {
          if (elapsedDays < requiredDays || outcomes?.[horizon]) {
            return;
          }

          const outcome = buildOutcome(run, record, newestRun, latestRecord, horizon);

          if (!outcome) {
            return;
          }

          outcomes = {
            ...(outcomes ?? {}),
            [horizon]: outcome,
          };
        },
      );

      return outcomes ? { ...record, outcomes } : record;
    });

    const outcomesChanged = nextRecords.some((record, index) => record !== run.records[index]);
    return outcomesChanged ? { ...run, records: nextRecords } : run;
  });
}

export function mergeRecommendationHistory(
  history: RecommendationRunSnapshot[],
  snapshot: RecommendationRunSnapshot,
  maxRuns = 50,
) {
  const ordered = [...history].sort((left, right) => left.runAt.localeCompare(right.runAt));
  const latest = ordered.at(-1);

  if (latest && !runMateriallyChanged(latest, snapshot)) {
    return ordered;
  }

  const next = [...ordered, snapshot].slice(-maxRuns);
  return backfillRecommendationOutcomes(next, snapshot);
}

export function summarizeRecommendationHistory(history: RecommendationRunSnapshot[]) {
  const actionBuckets = new Map<ActionLabel, { count: number; hits: number; forwardReturnSum: number }>();
  const horizonCoverage = (Object.keys(recommendationOutcomeHorizonDays) as OutcomeHorizon[]).map((horizon) => ({
    horizon,
    resolved: 0,
    pending: 0,
  }));

  history.forEach((run) => {
    run.records.forEach((record) => {
      const firstResolvedOutcome =
        record.outcomes?.['1W'] ??
        record.outcomes?.['1M'] ??
        record.outcomes?.['3M'] ??
        record.outcomes?.['6M'] ??
        record.outcomes?.['12M'];

      const bucket = actionBuckets.get(record.action) ?? {
        count: 0,
        hits: 0,
        forwardReturnSum: 0,
      };

      if (firstResolvedOutcome) {
        bucket.count += 1;
        bucket.hits += firstResolvedOutcome.hit ? 1 : 0;
        bucket.forwardReturnSum += firstResolvedOutcome.forwardReturn;
      }

      actionBuckets.set(record.action, bucket);

      horizonCoverage.forEach((coverage) => {
        if (record.outcomes?.[coverage.horizon]) {
          coverage.resolved += 1;
        } else {
          coverage.pending += 1;
        }
      });
    });
  });

  return {
    runs: history.length,
    actionAccuracy: [...actionBuckets.entries()]
      .filter(([, bucket]) => bucket.count > 0)
      .map(([action, bucket]) => ({
        action,
        count: bucket.count,
        hitRate: round(bucket.hits / bucket.count, 4),
        averageForwardReturn: round(bucket.forwardReturnSum / bucket.count, 4),
      }))
      .sort((left, right) => right.count - left.count),
    horizonCoverage,
  };
}

export function buildDecisionAuditEntries(
  previousRun: RecommendationRunSnapshot | undefined,
  currentRun: RecommendationRunSnapshot,
) {
  if (!previousRun) {
    return [] as DecisionAuditRecord[];
  }

  const previousBySymbol = new Map(previousRun.records.map((record) => [record.symbol, record]));

  return currentRun.records
    .flatMap((record) => {
      const previous = previousBySymbol.get(record.symbol);

      if (!previous || previous.action === record.action) {
        return [];
      }

      return [{
        id: `${currentRun.runAt}-${record.symbol}`,
        date: currentRun.runAt,
        symbol: record.symbol,
        oldAction: previous.action,
        newAction: record.action,
        reason: record.reasonTags[0]
          ? `${record.reasonTags[0]} changed enough to move the call.`
          : 'The underlying score mix changed enough to move the call.',
      }] satisfies DecisionAuditRecord[];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function mergeDecisionAuditLog(
  history: DecisionAuditRecord[],
  entries: DecisionAuditRecord[],
  maxEntries = 250,
) {
  if (entries.length === 0) {
    return history;
  }

  const seen = new Set<string>();
  const merged = [...history, ...entries].filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }

    seen.add(entry.id);
    return true;
  });

  return merged
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-maxEntries);
}
