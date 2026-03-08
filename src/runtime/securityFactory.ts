import type { SecuritySeed } from '../domain/types';
import type {
  HistoricalBar,
  LiveFundamentalSnapshot,
  LivePriceSnapshot,
  LiveQuoteSnapshot,
} from '../live/types';

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dailyReturns(bars: HistoricalBar[]) {
  const returns: number[] = [];

  for (let index = 1; index < bars.length; index += 1) {
    returns.push(bars[index].close / bars[index - 1].close - 1);
  }

  return returns;
}

function stdev(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function annualizedVol(values: number[]) {
  return stdev(values) * Math.sqrt(252);
}

function percentChange(values: number[], lookback: number) {
  if (values.length <= lookback) {
    return 0;
  }

  const current = values[values.length - 1];
  const prior = values[values.length - 1 - lookback];
  return current / prior - 1;
}

function maxDrawdown(values: number[]) {
  let peak = values[0] ?? 0;
  let worst = 0;

  values.forEach((value) => {
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  });

  return worst;
}

function distanceFromAverage(values: number[], length: number) {
  const subset = values.slice(-length);
  const mean = average(subset);
  const current = values[values.length - 1] ?? mean;

  if (!mean) {
    return 0;
  }

  return ((current - mean) / mean) * 100;
}

function sampleSeries(values: number[], points = 8) {
  if (values.length <= points) {
    return values;
  }

  const step = (values.length - 1) / (points - 1);
  const sampled: number[] = [];

  for (let index = 0; index < points; index += 1) {
    sampled.push(values[Math.round(index * step)]);
  }

  return sampled;
}

export function createProvisionalSecurity(symbol: string, price: number): SecuritySeed {
  return {
    symbol,
    name: symbol,
    sector: 'Unclassified',
    industry: 'User-added holding',
    description: 'User-added holding awaiting fuller market and fundamental coverage.',
    marketCap: 25,
    marketCapBucket: 'mid',
    securityType: 'stock',
    price,
    fundamentalsLastUpdated: new Date().toISOString().slice(0, 10),
    factors: {
      growth: 50,
      quality: 50,
      value: 50,
      momentum: 50,
      defensive: 50,
      cyclical: 50,
    },
    metrics: {
      revenueGrowth: 0.08,
      revenueCagr: 0.08,
      epsGrowth: 0.08,
      grossMargin: 0.35,
      operatingMargin: 0.16,
      fcfMargin: 0.1,
      fcfConsistency: 50,
      debtToEquity: 0.8,
      cashToDebt: 0.7,
      currentRatio: 1.2,
      quickRatio: 1.1,
      roic: 0.1,
      dilutionRate3y: 0.01,
      marginStability: 55,
      ret1m: 0,
      ret3m: 0,
      ret6m: 0,
      ret12m: 0,
      vol20d: 0.28,
      vol60d: 0.3,
      vol252d: 0.34,
      downsideVol60d: 0.22,
      maxDd3m: -0.1,
      maxDd6m: -0.15,
      maxDd12m: -0.2,
      distanceSma20: 0,
      distanceSma50: 0,
      distanceSma200: 0,
      trendSlope63d: 0,
      momentumAcceleration: 0,
      abnormalVolume20d: 1,
      pullbackQuality: 50,
      relativeStrength: 50,
      beta: 1,
      crashFrequency: 24,
      tailLoss: 0.09,
      sectorValuationPercentile: 50,
      selfValuationPercentile: 50,
      growthAdjustedValuation: 1.7,
      fcfYield: 0.02,
      pe: 22,
      evSales: 4,
      evEbitda: 14,
      earningsDays: 30,
      postEarningsGap: 0.05,
      surpriseScore: 50,
      revisionScore: 50,
      insiderScore: 50,
      catalystScore: 50,
      cyclicality: 50,
      eventConcentration: 40,
      liquidityScore: 70,
    },
    priceHistory: Array.from({ length: 8 }, () => price),
    scoreHistory: [50, 50, 50, 50, 50, 50, 50, 50],
    previousRisk: 50,
    previousDownside: 0.15,
    thesisNotes: [],
    watchPoints: ['Coverage is provisional until live data finishes loading.'],
  };
}

export function buildSecurityFromLiveData(
  symbol: string,
  priceSnapshot: LivePriceSnapshot,
  sector?: string,
  fundamentals?: LiveFundamentalSnapshot,
) {
  const closes = priceSnapshot.bars.map((bar) => bar.close);
  const returns = dailyReturns(priceSnapshot.bars);
  const latestRevenue = fundamentals?.annualTotalRevenue.at(-1)?.value;
  const previousRevenue =
    fundamentals && fundamentals.annualTotalRevenue.length > 1
      ? fundamentals.annualTotalRevenue[fundamentals.annualTotalRevenue.length - 2].value
      : undefined;
  const revenueGrowth =
    latestRevenue && previousRevenue && previousRevenue !== 0
      ? latestRevenue / previousRevenue - 1
      : 0.08;
  const latestEps = fundamentals?.annualBasicEps.at(-1)?.value;
  const previousEps =
    fundamentals && fundamentals.annualBasicEps.length > 1
      ? fundamentals.annualBasicEps[fundamentals.annualBasicEps.length - 2].value
      : undefined;
  const epsGrowth =
    latestEps && previousEps && previousEps !== 0 ? latestEps / previousEps - 1 : 0.08;
  const grossProfit = fundamentals?.annualGrossProfit.at(-1)?.value;
  const operatingIncome = fundamentals?.annualOperatingIncome.at(-1)?.value;
  const freeCashFlow = fundamentals?.annualFreeCashFlow.at(-1)?.value;
  const currentAssets = fundamentals?.annualCurrentAssets.at(-1)?.value;
  const currentLiabilities = fundamentals?.annualCurrentLiabilities.at(-1)?.value;
  const totalDebt = fundamentals?.annualTotalDebt.at(-1)?.value;
  const cash = fundamentals?.annualCashAndCashEquivalents.at(-1)?.value;

  return {
    ...createProvisionalSecurity(symbol, priceSnapshot.price),
    name: priceSnapshot.longName ?? symbol,
    sector: sector ?? 'Unclassified',
    industry: priceSnapshot.exchangeName ?? 'User-added holding',
    description:
      'User-added holding with live market data. Factor coverage is partially inferred from price history and available public fundamentals.',
    marketCap:
      fundamentals?.annualDilutedAverageShares.at(-1)?.value != null
        ? (priceSnapshot.price *
            (fundamentals.annualDilutedAverageShares.at(-1)?.value ?? 0)) /
          1_000_000_000
        : 25,
    price: priceSnapshot.price,
    fundamentalsLastUpdated:
      fundamentals?.annualTotalRevenue.at(-1)?.asOfDate ??
      new Date().toISOString().slice(0, 10),
    metrics: {
      ...createProvisionalSecurity(symbol, priceSnapshot.price).metrics,
      revenueGrowth,
      revenueCagr: revenueGrowth,
      epsGrowth,
      grossMargin:
        grossProfit && latestRevenue ? grossProfit / latestRevenue : 0.35,
      operatingMargin:
        operatingIncome && latestRevenue ? operatingIncome / latestRevenue : 0.16,
      fcfMargin: freeCashFlow && latestRevenue ? freeCashFlow / latestRevenue : 0.1,
      fcfConsistency: freeCashFlow != null && freeCashFlow > 0 ? 70 : 45,
      debtToEquity: totalDebt && latestRevenue ? totalDebt / latestRevenue : 0.8,
      cashToDebt: cash && totalDebt ? cash / totalDebt : 0.7,
      currentRatio:
        currentAssets && currentLiabilities ? currentAssets / currentLiabilities : 1.2,
      quickRatio:
        currentAssets && currentLiabilities
          ? (currentAssets * 0.92) / currentLiabilities
          : 1.1,
      ret1m: percentChange(closes, 21),
      ret3m: percentChange(closes, 63),
      ret6m: percentChange(closes, 126),
      ret12m: percentChange(closes, 252),
      vol20d: annualizedVol(returns.slice(-20)),
      vol60d: annualizedVol(returns.slice(-60)),
      vol252d: annualizedVol(returns.slice(-252)),
      downsideVol60d: annualizedVol(returns.filter((value) => value < 0).slice(-60)),
      maxDd3m: maxDrawdown(closes.slice(-63)),
      maxDd6m: maxDrawdown(closes.slice(-126)),
      maxDd12m: maxDrawdown(closes.slice(-252)),
      distanceSma20: distanceFromAverage(closes, 20),
      distanceSma50: distanceFromAverage(closes, 50),
      distanceSma200: distanceFromAverage(closes, 200),
      trendSlope63d: percentChange(closes, 63) * 100,
      momentumAcceleration: percentChange(closes, 21) * 100 - percentChange(closes, 63) * 33,
      abnormalVolume20d:
        (priceSnapshot.volume || priceSnapshot.bars.at(-1)?.volume || 1) /
        Math.max(average(priceSnapshot.bars.slice(-20).map((bar) => bar.volume)), 1),
      pullbackQuality: 50,
      relativeStrength: 50 + percentChange(closes, 126) * 100,
      beta: 1,
      crashFrequency: returns.filter((value) => value < -0.025).length * 8,
      tailLoss: Math.abs(Math.min(...returns.slice(-30), -0.04)),
      pe:
        latestEps && latestEps > 0 ? priceSnapshot.price / latestEps : 22,
      sectorValuationPercentile: 50,
      selfValuationPercentile: 50,
      growthAdjustedValuation: 1.7,
      fcfYield:
        freeCashFlow != null
          ? freeCashFlow / Math.max(priceSnapshot.price * 1_000_000_000, 1)
          : 0.02,
      earningsDays: 30,
      surpriseScore: 55,
      revisionScore: 55,
      insiderScore: 50,
      catalystScore: 52,
      liquidityScore: 72,
    },
    priceHistory: sampleSeries(closes),
  } satisfies SecuritySeed;
}

export function mergeSecurityWithLiveData(
  seed: SecuritySeed,
  priceSnapshot: LivePriceSnapshot,
  sector?: string,
  fundamentals?: LiveFundamentalSnapshot,
) {
  const derived = buildSecurityFromLiveData(seed.symbol, priceSnapshot, sector, fundamentals);

  return {
    ...seed,
    name: priceSnapshot.longName ?? seed.name,
    sector: sector ?? seed.sector,
    industry: priceSnapshot.exchangeName ?? seed.industry,
    marketCap: derived.marketCap || seed.marketCap,
    price: priceSnapshot.price,
    fundamentalsLastUpdated: derived.fundamentalsLastUpdated ?? seed.fundamentalsLastUpdated,
    metrics: {
      ...seed.metrics,
      ...derived.metrics,
    },
    priceHistory: derived.priceHistory.length > 0 ? derived.priceHistory : seed.priceHistory,
  } satisfies SecuritySeed;
}

export function applyQuoteToSecurity(seed: SecuritySeed, quote: LiveQuoteSnapshot) {
  const nextHistory =
    seed.priceHistory.length > 0 ? [...seed.priceHistory] : Array.from({ length: 8 }, () => quote.price);
  nextHistory[nextHistory.length - 1] = quote.price;

  const priceMultiplier = seed.price > 0 ? quote.price / seed.price : 1;

  return {
    ...seed,
    name: quote.longName ?? seed.name,
    industry: quote.exchangeName ?? seed.industry,
    price: quote.price,
    marketCap:
      Number.isFinite(priceMultiplier) && priceMultiplier > 0
        ? seed.marketCap * priceMultiplier
        : seed.marketCap,
    priceHistory: nextHistory,
  } satisfies SecuritySeed;
}
