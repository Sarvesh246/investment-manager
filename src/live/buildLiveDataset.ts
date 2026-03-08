import type { BenchmarkSeed, MockDataset, SecuritySeed } from '../domain/types';
import type {
  HistoricalBar,
  LiveFundamentalSnapshot,
  LivePriceSnapshot,
  LiveProviderRecord,
  LiveProviderResult,
  TimeseriesPoint,
} from './types';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lastValue(points: TimeseriesPoint[]) {
  return [...points].sort((left, right) => left.asOfDate.localeCompare(right.asOfDate)).at(-1)?.value;
}

function previousValue(points: TimeseriesPoint[]) {
  return [...points].sort((left, right) => left.asOfDate.localeCompare(right.asOfDate)).at(-2)?.value;
}

function cagr(points: TimeseriesPoint[]) {
  const ordered = [...points].sort((left, right) => left.asOfDate.localeCompare(right.asOfDate));

  if (ordered.length < 2) {
    return undefined;
  }

  const first = ordered[0].value;
  const last = ordered.at(-1)?.value ?? first;

  if (first <= 0 || last <= 0) {
    return undefined;
  }

  return (last / first) ** (1 / (ordered.length - 1)) - 1;
}

function yoy(points: TimeseriesPoint[]) {
  const latest = lastValue(points);
  const prior = previousValue(points);

  if (latest == null || prior == null || prior === 0) {
    return undefined;
  }

  return latest / prior - 1;
}

function sampleHistory(bars: HistoricalBar[], points = 8) {
  if (bars.length <= points) {
    return bars.map((bar) => bar.close);
  }

  const step = (bars.length - 1) / (points - 1);
  const sampled: number[] = [];

  for (let index = 0; index < points; index += 1) {
    const barIndex = Math.round(index * step);
    sampled.push(bars[barIndex].close);
  }

  return sampled;
}

function dailyReturns(bars: HistoricalBar[]) {
  const returns: number[] = [];

  for (let index = 1; index < bars.length; index += 1) {
    returns.push(bars[index].close / bars[index - 1].close - 1);
  }

  return returns;
}

function standardDeviation(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function annualizedVolatility(returns: number[]) {
  return standardDeviation(returns) * Math.sqrt(252);
}

function downsideDeviation(returns: number[]) {
  const downside = returns.filter((value) => value < 0);
  return annualizedVolatility(downside);
}

function sma(values: number[], length: number) {
  const subset = values.slice(-length);
  return average(subset);
}

function percentChange(values: number[], lookback: number) {
  if (values.length <= lookback) {
    return 0;
  }

  const current = values.at(-1) ?? values[values.length - 1];
  const prior = values.at(-(lookback + 1)) ?? values[0];

  if (!current || !prior) {
    return 0;
  }

  return current / prior - 1;
}

function maxDrawdown(values: number[]) {
  let peak = values[0];
  let worst = 0;

  values.forEach((value) => {
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  });

  return worst;
}

function windowedDrawdown(values: number[], length: number) {
  return maxDrawdown(values.slice(-length));
}

function slopePercent(values: number[]) {
  if (values.length < 2) {
    return 0;
  }

  const xMean = (values.length - 1) / 2;
  const yMean = average(values);
  const numerator = values.reduce((sum, value, index) => sum + (index - xMean) * (value - yMean), 0);
  const denominator = values.reduce((sum, _, index) => sum + (index - xMean) ** 2, 0);

  if (denominator === 0 || yMean === 0) {
    return 0;
  }

  return (numerator / denominator / yMean) * 1000;
}

function beta(stockReturns: number[], benchmarkReturns: number[]) {
  const size = Math.min(stockReturns.length, benchmarkReturns.length);

  if (size === 0) {
    return 1;
  }

  const left = stockReturns.slice(-size);
  const right = benchmarkReturns.slice(-size);
  const leftMean = average(left);
  const rightMean = average(right);
  const covariance = average(
    left.map((value, index) => (value - leftMean) * (right[index] - rightMean)),
  );
  const variance = average(right.map((value) => (value - rightMean) ** 2));

  if (variance === 0) {
    return 1;
  }

  return covariance / variance;
}

function tailLoss(returns: number[]) {
  const sorted = [...returns].sort((left, right) => left - right);
  const cutoff = Math.max(1, Math.floor(sorted.length * 0.05));
  return Math.abs(average(sorted.slice(0, cutoff)));
}

function positiveSeriesScore(points: TimeseriesPoint[]) {
  if (points.length === 0) {
    return undefined;
  }

  const positiveRatio = points.filter((point) => point.value > 0).length / points.length;
  const latest = lastValue(points);
  const median = average(points.map((point) => point.value));

  if (latest == null || median === 0) {
    return positiveRatio * 100;
  }

  return clamp(positiveRatio * 70 + clamp((latest / median) * 30, 0, 30), 0, 100);
}

function updateFromFundamentals(seed: SecuritySeed, fundamentals?: LiveFundamentalSnapshot) {
  if (!fundamentals) {
    return seed;
  }

  const latestRevenue = lastValue(fundamentals.annualTotalRevenue);
  const latestGrossProfit = lastValue(fundamentals.annualGrossProfit);
  const latestOperatingIncome = lastValue(fundamentals.annualOperatingIncome);
  const latestFcf = lastValue(fundamentals.annualFreeCashFlow);
  const latestCash = lastValue(fundamentals.annualCashAndCashEquivalents);
  const latestDebt = lastValue(fundamentals.annualTotalDebt);
  const latestAssets = lastValue(fundamentals.annualCurrentAssets);
  const latestLiabilities = lastValue(fundamentals.annualCurrentLiabilities);
  const latestShares = lastValue(fundamentals.annualDilutedAverageShares);

  const revenueGrowth = yoy(fundamentals.annualTotalRevenue);
  const revenueCagr = cagr(fundamentals.annualTotalRevenue);
  const epsGrowth = yoy(fundamentals.annualBasicEps);
  const grossMargin =
    latestGrossProfit != null && latestRevenue ? latestGrossProfit / latestRevenue : undefined;
  const operatingMargin =
    latestOperatingIncome != null && latestRevenue ? latestOperatingIncome / latestRevenue : undefined;
  const fcfMargin = latestFcf != null && latestRevenue ? latestFcf / latestRevenue : undefined;
  const currentRatio =
    latestAssets != null && latestLiabilities ? latestAssets / latestLiabilities : undefined;
  const cashToDebt = latestCash != null && latestDebt ? latestCash / latestDebt : undefined;
  const dilutionRate3y = cagr(fundamentals.annualDilutedAverageShares);

  return {
    ...seed,
    fundamentalsLastUpdated:
      fundamentals.annualTotalRevenue.at(-1)?.asOfDate ?? seed.fundamentalsLastUpdated,
    metrics: {
      ...seed.metrics,
      revenueGrowth: revenueGrowth ?? seed.metrics.revenueGrowth,
      revenueCagr: revenueCagr ?? seed.metrics.revenueCagr,
      epsGrowth: epsGrowth ?? seed.metrics.epsGrowth,
      grossMargin: grossMargin ?? seed.metrics.grossMargin,
      operatingMargin: operatingMargin ?? seed.metrics.operatingMargin,
      fcfMargin: fcfMargin ?? seed.metrics.fcfMargin,
      fcfConsistency:
        positiveSeriesScore(fundamentals.annualFreeCashFlow) ?? seed.metrics.fcfConsistency,
      cashToDebt: cashToDebt ?? seed.metrics.cashToDebt,
      currentRatio: currentRatio ?? seed.metrics.currentRatio,
      quickRatio: currentRatio != null ? currentRatio * 0.92 : seed.metrics.quickRatio,
      dilutionRate3y: dilutionRate3y ?? seed.metrics.dilutionRate3y,
    },
    marketCap:
      latestShares != null ? (seed.price * latestShares) / 1_000_000_000 : seed.marketCap,
  };
}

function updateFromPrice(
  seed: SecuritySeed,
  priceSnapshot: LivePriceSnapshot | undefined,
  benchmarkBars: HistoricalBar[],
) {
  if (!priceSnapshot || priceSnapshot.bars.length < 220) {
    return seed;
  }

  const closes = priceSnapshot.bars.map((bar) => bar.close);
  const volumes = priceSnapshot.bars.map((bar) => bar.volume);
  const returns = dailyReturns(priceSnapshot.bars);
  const benchmarkReturns = dailyReturns(benchmarkBars);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const vol20 = annualizedVolatility(returns.slice(-20));
  const vol60 = annualizedVolatility(returns.slice(-60));
  const vol252 = annualizedVolatility(returns.slice(-252));
  const downside60 = downsideDeviation(returns.slice(-60));
  const ret6m = percentChange(closes, 126);
  const bench6m = percentChange(benchmarkBars.map((bar) => bar.close), 126);
  const priceScale = priceSnapshot.price / seed.price;

  return {
    ...seed,
    name: priceSnapshot.longName ?? seed.name,
    price: priceSnapshot.price,
    marketCap: seed.marketCap * priceScale,
    priceHistory: sampleHistory(priceSnapshot.bars),
    metrics: {
      ...seed.metrics,
      ret1m: percentChange(closes, 21),
      ret3m: percentChange(closes, 63),
      ret6m,
      ret12m: percentChange(closes, 252),
      vol20d: vol20 || seed.metrics.vol20d,
      vol60d: vol60 || seed.metrics.vol60d,
      vol252d: vol252 || seed.metrics.vol252d,
      downsideVol60d: downside60 || seed.metrics.downsideVol60d,
      maxDd3m: windowedDrawdown(closes, 63),
      maxDd6m: windowedDrawdown(closes, 126),
      maxDd12m: windowedDrawdown(closes, 252),
      distanceSma20: sma20 ? ((priceSnapshot.price - sma20) / sma20) * 100 : seed.metrics.distanceSma20,
      distanceSma50: sma50 ? ((priceSnapshot.price - sma50) / sma50) * 100 : seed.metrics.distanceSma50,
      distanceSma200: sma200 ? ((priceSnapshot.price - sma200) / sma200) * 100 : seed.metrics.distanceSma200,
      trendSlope63d: slopePercent(closes.slice(-63)),
      momentumAcceleration: percentChange(closes, 21) * 100 - (percentChange(closes, 63) * 100) / 3,
      abnormalVolume20d: volumes.at(-1) && average(volumes.slice(-20)) ? (volumes.at(-1) ?? 0) / average(volumes.slice(-20)) : seed.metrics.abnormalVolume20d,
      pullbackQuality: clamp(
        100 - Math.abs((((priceSnapshot.price - sma20) / sma20) * 100) - 3) * 8 - Math.max(0, (vol20 - vol60) * 130),
        0,
        100,
      ),
      relativeStrength: clamp(50 + (ret6m - bench6m) * 220, 0, 100),
      beta: clamp(beta(returns.slice(-252), benchmarkReturns.slice(-252)), 0.3, 2.2),
      crashFrequency: clamp((returns.filter((value) => value < -0.025).length / Math.max(returns.length, 1)) * 1200, 0, 100),
      tailLoss: tailLoss(returns.slice(-252)) || seed.metrics.tailLoss,
      pe: seed.metrics.pe * priceScale,
      evSales: seed.metrics.evSales * priceScale,
      evEbitda: seed.metrics.evEbitda * priceScale,
      growthAdjustedValuation: seed.metrics.growthAdjustedValuation * priceScale,
    },
  };
}

function updateValuationContext(
  securities: SecuritySeed[],
  baseLookup: Map<string, SecuritySeed>,
) {
  return securities.map((security) => {
    const sameSector = securities.filter((candidate) => candidate.sector === security.sector);
    const cheaperThanSector = sameSector.filter((candidate) => candidate.metrics.pe <= security.metrics.pe).length;
    const sectorPercentile =
      sameSector.length <= 1
        ? security.metrics.sectorValuationPercentile
        : ((cheaperThanSector - 1) / (sameSector.length - 1)) * 100;
    const baseSeed = baseLookup.get(security.symbol);
    const priceScale = baseSeed ? security.price / baseSeed.price : 1;

    return {
      ...security,
      metrics: {
        ...security.metrics,
        sectorValuationPercentile: clamp(sectorPercentile, 0, 100),
        selfValuationPercentile: clamp(
          (baseSeed?.metrics.selfValuationPercentile ?? security.metrics.selfValuationPercentile) +
            (priceScale - 1) * 80,
          0,
          100,
        ),
        growthAdjustedValuation:
          security.metrics.epsGrowth > 0.02
            ? security.metrics.pe / Math.max(security.metrics.epsGrowth * 100, 1)
            : security.metrics.growthAdjustedValuation,
      },
    };
  });
}

function updateBenchmark(baseBenchmark: BenchmarkSeed, benchmarkSnapshot: LivePriceSnapshot, breadth: number) {
  const closes = benchmarkSnapshot.bars.map((bar) => bar.close);
  const returns = dailyReturns(benchmarkSnapshot.bars);
  const vol = annualizedVolatility(returns.slice(-252));

  return {
    ...baseBenchmark,
    price: benchmarkSnapshot.price,
    ret1m: percentChange(closes, 21),
    ret3m: percentChange(closes, 63),
    ret6m: percentChange(closes, 126),
    aboveSma50: benchmarkSnapshot.price >= sma(closes, 50),
    aboveSma200: benchmarkSnapshot.price >= sma(closes, 200),
    realizedVolPercentile: clamp((vol - 0.14) / 0.18, 0, 1),
    breadth,
    riskAppetite: clamp(0.35 + breadth * 0.35 + percentChange(closes, 63) * 0.9, 0, 1),
    drawdown: maxDrawdown(closes.slice(-252)),
  };
}

export function buildLiveDataset(
  baseDataset: MockDataset,
  benchmarkSnapshot: LivePriceSnapshot,
  providerRecords: LiveProviderRecord[],
  notes: string[],
) {
  const benchmarkBars = benchmarkSnapshot.bars;
  const baseLookup = new Map(baseDataset.securities.map((security) => [security.symbol, security]));
  const blended = providerRecords.map((record) => {
    let security = updateFromFundamentals(record.seed, record.fundamentalsSnapshot);
    security = updateFromPrice(security, record.priceSnapshot, benchmarkBars);

    return {
      ...security,
      sector: record.sector ?? security.sector,
    };
  });

  const pricedSecurities = updateValuationContext(blended, baseLookup);
  const breadth =
    pricedSecurities.filter((security) => security.metrics.ret3m > 0).length /
    Math.max(pricedSecurities.length, 1);

  return {
    dataset: {
      ...baseDataset,
      asOf: benchmarkSnapshot.bars.at(-1)?.date ?? baseDataset.asOf,
      dataMode: 'blended',
      providerSummary:
        'Yahoo public chart, insights, and fundamentals-timeseries endpoints blended with local point-in-time fallback data.',
      snapshotGeneratedAt: new Date().toISOString(),
      syncNotes: notes,
      securities: pricedSecurities.map((security) => ({
        ...security,
      })),
      benchmark: updateBenchmark(baseDataset.benchmark, benchmarkSnapshot, breadth),
    },
    notes,
  } satisfies LiveProviderResult;
}
