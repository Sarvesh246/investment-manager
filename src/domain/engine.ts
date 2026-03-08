import { average, clamp, percentileRank, round, sigmoid, sum, toScore } from './math';
import type {
  ActionLabel,
  AlertItem,
  AllocationSuggestion,
  CommandCenterModel,
  DeploymentPlan,
  ExpectedReturnScenario,
  Explainability,
  FitImpact,
  HoldingAnalysis,
  MockDataset,
  PlannerInputs,
  RegimeSnapshot,
  RiskBreakdown,
  RiskBucket,
  ScoreBreakdown,
  ScoreContribution,
  ScoreCard,
  SecuritySeed,
  StrategyWeights,
} from './types';

const opportunityWeights = {
  growth: 0.22,
  quality: 0.23,
  valuation: 0.18,
  momentum: 0.17,
  support: 0.1,
  balanceSheet: 0.1,
} satisfies Record<string, number>;

const fragilityWeights = {
  financialStress: 0.25,
  cashBurnDilution: 0.2,
  eventSensitivity: 0.15,
  marginFragility: 0.1,
  tailRisk: 0.2,
  valuationVulnerability: 0.1,
} satisfies Record<string, number>;

const timingWeights = {
  trend: 0.3,
  pullback: 0.2,
  persistence: 0.2,
  volatilityWindow: 0.15,
  eventWindow: 0.15,
} satisfies Record<string, number>;

const fitWeights = {
  diversification: 0.25,
  sectorBalance: 0.2,
  factorBalance: 0.2,
  riskBudget: 0.2,
  capitalFit: 0.15,
} satisfies Record<string, number>;

function safeDivide(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

function rankScore(
  universe: SecuritySeed[],
  seed: SecuritySeed,
  selector: (security: SecuritySeed) => number,
  higherBetter = true,
  sectorRelative = false,
) {
  const comparisonSet = sectorRelative
    ? universe.filter((security) => security.sector === seed.sector)
    : universe;
  const effectiveSet = comparisonSet.length > 1 ? comparisonSet : universe;
  const values = effectiveSet.map(selector);
  const percentile = percentileRank(values, selector(seed));

  return round((higherBetter ? percentile : 1 - percentile) * 100);
}

function percentileScore(percentile: number, higherBetter = true) {
  return round(higherBetter ? percentile : 100 - percentile);
}

function boundedScore(value: number, min: number, max: number, higherBetter = true) {
  if (max === min) {
    return 50;
  }

  const normalized = clamp((value - min) / (max - min), 0, 1);
  return round((higherBetter ? normalized : 1 - normalized) * 100);
}

function targetWindowScore(value: number, target: number, tolerance: number) {
  const normalizedDistance = Math.abs(value - target) / tolerance;
  return round(clamp(1 - normalizedDistance, 0, 1) * 100);
}

function weightedBreakdown(groups: Array<Omit<ScoreContribution, 'contribution'>>) {
  const contributions = groups.map((group) => ({
    ...group,
    contribution: round(group.value * group.weight),
  }));
  const score = round(
    contributions.reduce((total, group) => total + group.value * group.weight, 0),
  );

  return { score, groups: contributions } satisfies ScoreBreakdown;
}

function factorSimilarity(left: SecuritySeed, right: SecuritySeed) {
  const leftVector = Object.values(left.factors).map((value) => value / 100);
  const rightVector = Object.values(right.factors).map((value) => value / 100);

  const dot = leftVector.reduce((total, value, index) => total + value * rightVector[index], 0);
  const leftNorm = Math.sqrt(sum(leftVector.map((value) => value * value)));
  const rightNorm = Math.sqrt(sum(rightVector.map((value) => value * value)));

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return clamp(dot / (leftNorm * rightNorm), 0, 1);
}

function correlationProxy(left: SecuritySeed, right: SecuritySeed) {
  const similarity = factorSimilarity(left, right);
  const sectorBonus = left.sector === right.sector ? 0.12 : -0.06;

  return clamp(0.16 + similarity * 0.72 + sectorBonus, 0.05, 0.94);
}

function riskBucket(score: number): RiskBucket {
  if (score < 40) {
    return 'Defensive';
  }
  if (score < 55) {
    return 'Moderate';
  }
  if (score < 70) {
    return 'Elevated';
  }
  if (score < 82) {
    return 'Aggressive';
  }
  return 'Fragile';
}

function sizeCapMultiplier(bucket: RiskBucket) {
  switch (bucket) {
    case 'Defensive':
      return 1;
    case 'Moderate':
      return 0.9;
    case 'Elevated':
      return 0.7;
    case 'Aggressive':
      return 0.5;
    case 'Fragile':
      return 0.3;
    default:
      return 0.8;
  }
}

function describeStrategy(strategyWeights: StrategyWeights) {
  return Object.entries(strategyWeights)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([label]) => label)
    .join(', ');
}

function inferRegime(dataset: MockDataset): RegimeSnapshot {
  const benchmark = dataset.benchmark;
  const trendScore = Number(benchmark.aboveSma50) + Number(benchmark.aboveSma200);

  if (trendScore === 2 && benchmark.realizedVolPercentile < 0.45) {
    return {
      key: 'Bullish trend / low vol',
      confidence: 78,
      deploymentTilt: 0.7,
      narrative:
        'Trend is supportive and volatility is contained. Momentum and quality can carry more weight, but concentration still matters.',
      factorEmphasis: ['momentum', 'quality', 'cash deployment'],
    };
  }

  if (trendScore === 2 && benchmark.realizedVolPercentile >= 0.45) {
    return {
      key: 'Bullish trend / high vol',
      confidence: 72,
      deploymentTilt: 0.46,
      narrative:
        'Trend remains constructive, but volatility is elevated. The system keeps buying selective and reserve-aware rather than fully aggressive.',
      factorEmphasis: ['quality', 'timing', 'reserve discipline'],
    };
  }

  if (trendScore === 0 && benchmark.realizedVolPercentile >= 0.6) {
    return {
      key: 'Bearish trend / high vol',
      confidence: 76,
      deploymentTilt: -0.65,
      narrative:
        'Weak trend and high volatility favor cash preservation, lower fragility, and defense over incremental risk.',
      factorEmphasis: ['defense', 'cash', 'fragility control'],
    };
  }

  if (benchmark.riskAppetite < 0.45) {
    return {
      key: 'Risk-off defensiveness',
      confidence: 66,
      deploymentTilt: -0.42,
      narrative:
        'Leadership is narrow and investors are avoiding risk. The engine prefers defense, balance-sheet strength, and wider reserve cash.',
      factorEmphasis: ['defensive fit', 'balance sheet', 'cash'],
    };
  }

  if (benchmark.riskAppetite > 0.62 && benchmark.breadth > 0.55) {
    return {
      key: 'Risk-on rotation',
      confidence: 69,
      deploymentTilt: 0.32,
      narrative:
        'Breadth and risk appetite are favorable. The model allows more upside pursuit, but not at the cost of breaching portfolio constraints.',
      factorEmphasis: ['growth', 'momentum', 'diversified adds'],
    };
  }

  return {
    key: 'Sideways / low conviction',
    confidence: 61,
    deploymentTilt: 0,
    narrative:
      'The market signal is mixed. The engine emphasizes selective entries, staged buys, and stronger cash discipline.',
    factorEmphasis: ['timing', 'fit', 'staging'],
  };
}

function buildPortfolioContext(dataset: MockDataset) {
  const holdings = dataset.holdings.map((holding) => {
    const security = dataset.securities.find((item) => item.symbol === holding.symbol);

    if (!security) {
      throw new Error(`Missing security seed for holding ${holding.symbol}`);
    }

    const marketValue = security.price * holding.shares;

    return {
      holding,
      security,
      marketValue,
    };
  });

  const investedValue = sum(holdings.map((entry) => entry.marketValue));
  const portfolioValue = investedValue + dataset.user.investableCash;
  const largestHolding = [...holdings].sort(
    (left, right) => right.marketValue - left.marketValue,
  )[0];

  const sectorExposure = Array.from(
    holdings.reduce((map, entry) => {
      const next = map.get(entry.security.sector) ?? 0;
      map.set(entry.security.sector, next + safeDivide(entry.marketValue, portfolioValue));
      return map;
    }, new Map<string, number>()),
  )
    .map(([sector, weight]) => ({ sector, weight: round(weight * 100, 1) }))
    .sort((left, right) => right.weight - left.weight);

  const factorTotals = holdings.reduce(
    (totals, entry) => {
      const weight = safeDivide(entry.marketValue, investedValue);
      totals.growth += entry.security.factors.growth * weight;
      totals.quality += entry.security.factors.quality * weight;
      totals.value += entry.security.factors.value * weight;
      totals.momentum += entry.security.factors.momentum * weight;
      totals.defensive += entry.security.factors.defensive * weight;
      totals.cyclical += entry.security.factors.cyclical * weight;
      return totals;
    },
    {
      growth: 0,
      quality: 0,
      value: 0,
      momentum: 0,
      defensive: 0,
      cyclical: 0,
    },
  );

  return {
    holdings,
    investedValue,
    portfolioValue,
    largestHolding,
    sectorExposure,
    factorTotals,
  };
}

function getPortfolioOverlap(
  seed: SecuritySeed,
  portfolioContext: ReturnType<typeof buildPortfolioContext>,
) {
  const peerHoldings = portfolioContext.holdings.filter(
    (entry) => entry.security.symbol !== seed.symbol,
  );

  if (peerHoldings.length === 0) {
    return { corrToPortfolio: 0.4, corrToLargest: 0.4, factorSimilarityToPortfolio: 0.4 };
  }

  const peerValue = sum(peerHoldings.map((entry) => entry.marketValue));
  const corrToPortfolio = peerHoldings.reduce((total, entry) => {
    const weight = entry.marketValue / peerValue;
    return total + correlationProxy(seed, entry.security) * weight;
  }, 0);

  const corrToLargest = correlationProxy(seed, portfolioContext.largestHolding.security);
  const factorSimilarityToPortfolio = clamp(
    average(peerHoldings.map((entry) => factorSimilarity(seed, entry.security))),
    0,
    1,
  );

  return {
    corrToPortfolio,
    corrToLargest,
    factorSimilarityToPortfolio,
  };
}

function scoreSecurity(
  dataset: MockDataset,
  regime: RegimeSnapshot,
  portfolioContext: ReturnType<typeof buildPortfolioContext>,
  seed: SecuritySeed,
) {
  const universe = dataset.securities;
  const isHeld = dataset.holdings.some((holding) => holding.symbol === seed.symbol);
  const currentHolding = portfolioContext.holdings.find(
    (entry) => entry.security.symbol === seed.symbol,
  );
  const currentWeight = currentHolding
    ? safeDivide(currentHolding.marketValue, portfolioContext.portfolioValue)
    : 0;
  const currentSectorWeight =
    portfolioContext.sectorExposure.find((entry) => entry.sector === seed.sector)?.weight ?? 0;
  const overlap = getPortfolioOverlap(seed, portfolioContext);
  const testWeight = isHeld ? currentWeight : Math.min(dataset.user.maxSinglePositionWeight, 0.06);
  const sectorWeightAfter = currentSectorWeight / 100 + (isHeld ? 0 : testWeight);

  const growth = average([
    rankScore(universe, seed, (security) => security.metrics.revenueGrowth),
    rankScore(universe, seed, (security) => security.metrics.revenueCagr),
    rankScore(universe, seed, (security) => security.metrics.epsGrowth),
  ]);

  const quality = average([
    rankScore(universe, seed, (security) => security.metrics.grossMargin),
    rankScore(universe, seed, (security) => security.metrics.operatingMargin),
    rankScore(universe, seed, (security) => security.metrics.fcfMargin),
    rankScore(universe, seed, (security) => security.metrics.fcfConsistency),
    rankScore(universe, seed, (security) => security.metrics.roic),
    rankScore(universe, seed, (security) => security.metrics.marginStability),
  ]);

  const valuation = average([
    percentileScore(seed.metrics.sectorValuationPercentile, false),
    percentileScore(seed.metrics.selfValuationPercentile, false),
    rankScore(universe, seed, (security) => security.metrics.fcfYield),
    rankScore(universe, seed, (security) => security.metrics.growthAdjustedValuation, false),
  ]);

  const momentum = average([
    rankScore(universe, seed, (security) => security.metrics.ret3m),
    rankScore(universe, seed, (security) => security.metrics.ret6m),
    rankScore(universe, seed, (security) => security.metrics.ret12m),
    rankScore(universe, seed, (security) => security.metrics.trendSlope63d),
    rankScore(universe, seed, (security) => security.metrics.relativeStrength),
  ]);

  const support = average([
    seed.metrics.surpriseScore,
    seed.metrics.revisionScore,
    seed.metrics.insiderScore,
    seed.metrics.catalystScore,
  ]);

  const balanceSheet = average([
    rankScore(universe, seed, (security) => security.metrics.debtToEquity, false),
    rankScore(universe, seed, (security) => security.metrics.cashToDebt),
    rankScore(universe, seed, (security) => security.metrics.currentRatio),
    rankScore(universe, seed, (security) => security.metrics.quickRatio),
  ]);

  const opportunity = weightedBreakdown([
    {
      label: 'Growth engine',
      value: growth,
      weight: opportunityWeights.growth,
      narrative: 'Growth blends revenue, EPS, and multi-period expansion.',
      tone: 'positive',
    },
    {
      label: 'Profitability and quality',
      value: quality,
      weight: opportunityWeights.quality,
      narrative: 'Quality rewards margins, cash conversion, and return on capital.',
      tone: 'positive',
    },
    {
      label: 'Valuation context',
      value: valuation,
      weight: opportunityWeights.valuation,
      narrative: 'Valuation compares the stock to its sector and its own history.',
      tone: 'positive',
    },
    {
      label: 'Momentum quality',
      value: momentum,
      weight: opportunityWeights.momentum,
      narrative: 'Momentum favors persistent trends rather than random spikes.',
      tone: 'positive',
    },
    {
      label: 'Revision and catalyst support',
      value: support,
      weight: opportunityWeights.support,
      narrative: 'Support measures estimate revisions, surprise quality, and catalysts.',
      tone: 'positive',
    },
    {
      label: 'Balance-sheet support',
      value: balanceSheet,
      weight: opportunityWeights.balanceSheet,
      narrative: 'Balance-sheet support rewards liquidity and debt resilience.',
      tone: 'positive',
    },
  ]);

  const financialStress = average([
    rankScore(universe, seed, (security) => security.metrics.debtToEquity),
    rankScore(universe, seed, (security) => security.metrics.cashToDebt, false),
    rankScore(universe, seed, (security) => security.metrics.currentRatio, false),
    rankScore(universe, seed, (security) => security.metrics.quickRatio, false),
  ]);

  const cashBurnDilution = average([
    rankScore(universe, seed, (security) => security.metrics.fcfMargin, false),
    rankScore(universe, seed, (security) => security.metrics.fcfConsistency, false),
    rankScore(universe, seed, (security) => security.metrics.dilutionRate3y),
  ]);

  const eventSensitivity = average([
    rankScore(universe, seed, (security) => security.metrics.postEarningsGap),
    seed.metrics.eventConcentration,
    boundedScore(seed.metrics.earningsDays, 7, 45, false),
  ]);

  const marginFragility = average([
    rankScore(universe, seed, (security) => security.metrics.marginStability, false),
    rankScore(universe, seed, (security) => security.metrics.operatingMargin, false),
  ]);

  const tailRisk = average([
    rankScore(universe, seed, (security) => security.metrics.vol60d),
    rankScore(universe, seed, (security) => security.metrics.downsideVol60d),
    rankScore(universe, seed, (security) => Math.abs(security.metrics.maxDd12m)),
    rankScore(universe, seed, (security) => security.metrics.crashFrequency),
    rankScore(universe, seed, (security) => security.metrics.tailLoss),
    rankScore(universe, seed, (security) => security.metrics.beta),
  ]);

  const valuationVulnerability = average([
    seed.metrics.sectorValuationPercentile,
    seed.metrics.selfValuationPercentile,
    rankScore(universe, seed, (security) => security.metrics.growthAdjustedValuation),
  ]);

  const fragility = weightedBreakdown([
    {
      label: 'Financial stress',
      value: financialStress,
      weight: fragilityWeights.financialStress,
      narrative: 'Debt load and liquidity matter most when market conditions tighten.',
      tone: 'negative',
    },
    {
      label: 'Cash-burn and dilution risk',
      value: cashBurnDilution,
      weight: fragilityWeights.cashBurnDilution,
      narrative: 'Weak cash conversion and repeated dilution raise breakage risk.',
      tone: 'negative',
    },
    {
      label: 'Event sensitivity',
      value: eventSensitivity,
      weight: fragilityWeights.eventSensitivity,
      narrative: 'Large post-earnings gaps and concentrated catalysts lower robustness.',
      tone: 'negative',
    },
    {
      label: 'Margin fragility',
      value: marginFragility,
      weight: fragilityWeights.marginFragility,
      narrative: 'Unstable or low margins weaken the thesis under stress.',
      tone: 'negative',
    },
    {
      label: 'Tail and drawdown risk',
      value: tailRisk,
      weight: fragilityWeights.tailRisk,
      narrative: 'Crash frequency and left-tail behavior matter more than average volatility alone.',
      tone: 'negative',
    },
    {
      label: 'Valuation vulnerability',
      value: valuationVulnerability,
      weight: fragilityWeights.valuationVulnerability,
      narrative: 'Crowded valuation creates multiple-compression risk.',
      tone: 'negative',
    },
  ]);

  const trend = average([
    rankScore(universe, seed, (security) => security.metrics.ret1m),
    rankScore(universe, seed, (security) => security.metrics.ret3m),
    targetWindowScore(seed.metrics.distanceSma50, 4.5, 10),
  ]);

  const pullback = average([
    seed.metrics.pullbackQuality,
    targetWindowScore(seed.metrics.distanceSma20, 2.5, 8),
  ]);

  const persistence = average([
    rankScore(universe, seed, (security) => security.metrics.trendSlope63d),
    rankScore(universe, seed, (security) => security.metrics.momentumAcceleration),
    rankScore(universe, seed, (security) => security.metrics.relativeStrength),
  ]);

  const volatilityWindow = average([
    rankScore(universe, seed, (security) => security.metrics.vol20d, false),
    rankScore(universe, seed, (security) => security.metrics.downsideVol60d, false),
    targetWindowScore(seed.metrics.abnormalVolume20d, 1.02, 0.28),
  ]);

  const eventWindow = average([
    boundedScore(seed.metrics.earningsDays, 7, 45),
    dataset.user.avoidEarningsRisk && seed.metrics.earningsDays < 14 ? 12 : 88,
  ]);

  const timing = weightedBreakdown([
    {
      label: 'Trend alignment',
      value: trend,
      weight: timingWeights.trend,
      narrative: 'Entry timing improves when medium-term trend is supportive.',
      tone: 'positive',
    },
    {
      label: 'Pullback quality',
      value: pullback,
      weight: timingWeights.pullback,
      narrative: 'Controlled pullbacks are better than parabolic extensions.',
      tone: 'positive',
    },
    {
      label: 'Momentum persistence',
      value: persistence,
      weight: timingWeights.persistence,
      narrative: 'Persistent trend strength matters more than a single sharp move.',
      tone: 'positive',
    },
    {
      label: 'Volatility window',
      value: volatilityWindow,
      weight: timingWeights.volatilityWindow,
      narrative: 'The model prefers orderly volatility to unstable expansion.',
      tone: 'positive',
    },
    {
      label: 'Event timing',
      value: eventWindow,
      weight: timingWeights.eventWindow,
      narrative: 'Near-term events can make an otherwise attractive idea a poor entry.',
      tone: 'positive',
    },
  ]);

  const diversification = round(
    average([
      (1 - overlap.corrToPortfolio) * 100,
      seed.sector === portfolioContext.largestHolding.security.sector ? 28 : 82,
      (1 - overlap.factorSimilarityToPortfolio) * 100,
    ]),
  );

  const sectorBalance = round(
    clamp(100 - Math.max(0, sectorWeightAfter - dataset.user.maxSectorWeight) * 360, 0, 100),
  );

  const factorBalance = round((1 - overlap.factorSimilarityToPortfolio) * 100);
  const preliminaryRisk = average([tailRisk, eventSensitivity, financialStress, valuationVulnerability]);
  const riskBudget = round(
    clamp(100 - average([preliminaryRisk, overlap.corrToPortfolio * 100]), 0, 100),
  );

  const constraintCompatibility = average([
    dataset.user.excludedSectors.includes(seed.sector) ? 0 : 100,
    dataset.user.allowedSecurityTypes.includes(seed.securityType) ? 100 : 0,
    dataset.user.avoidDilutionProne && seed.metrics.dilutionRate3y > 0.015 ? 20 : 90,
    dataset.user.avoidCashBurners && seed.metrics.fcfMargin < 0 ? 10 : 90,
  ]);

  const capitalFit = round(
    average([
      clamp(safeDivide(dataset.user.investableCash, seed.price * 10) * 18, 30, 100),
      clamp((dataset.user.maxSinglePositionWeight - currentWeight) * 520, 0, 100),
      constraintCompatibility,
    ]),
  );

  const portfolioFit = weightedBreakdown([
    {
      label: 'Diversification benefit',
      value: diversification,
      weight: fitWeights.diversification,
      narrative: 'Lower overlap and new exposure improve fit.',
      tone: 'positive',
    },
    {
      label: 'Sector balance',
      value: sectorBalance,
      weight: fitWeights.sectorBalance,
      narrative: 'The model penalizes adds that push sector exposure beyond limits.',
      tone: 'positive',
    },
    {
      label: 'Factor balance',
      value: factorBalance,
      weight: fitWeights.factorBalance,
      narrative: 'Portfolio fit improves when a new position changes factor balance constructively.',
      tone: 'positive',
    },
    {
      label: 'Risk-budget compatibility',
      value: riskBudget,
      weight: fitWeights.riskBudget,
      narrative: 'Additions should not worsen portfolio risk more than they improve opportunity.',
      tone: 'positive',
    },
    {
      label: 'Capital and rule fit',
      value: capitalFit,
      weight: fitWeights.capitalFit,
      narrative: 'The position must be feasible with available cash and user limits.',
      tone: 'positive',
    },
  ]);

  let confidence = 70;
  confidence -= seed.metrics.liquidityScore < 85 ? (85 - seed.metrics.liquidityScore) * 0.8 : 0;
  confidence -= seed.metrics.earningsDays < 14 ? 8 : 0;
  confidence -= seed.metrics.postEarningsGap > 0.08 ? 6 : 0;
  confidence -= Math.abs(opportunity.score - timing.score) > 18 ? 5 : 0;
  confidence -= Math.abs(opportunity.score - portfolioFit.score) > 20 ? 4 : 0;
  confidence += seed.marketCapBucket === 'mega' ? 4 : 0;
  confidence += seed.metrics.fcfConsistency > 80 ? 3 : 0;
  confidence = round(clamp(confidence, 22, 95));

  const marketRisk = round(
    average([
      rankScore(universe, seed, (security) => security.metrics.vol252d),
      rankScore(universe, seed, (security) => security.metrics.downsideVol60d),
      rankScore(universe, seed, (security) => Math.abs(security.metrics.maxDd12m)),
      rankScore(universe, seed, (security) => security.metrics.beta),
      rankScore(universe, seed, (security) => security.metrics.tailLoss),
    ]),
  );

  const eventRisk = round(
    average([
      rankScore(universe, seed, (security) => security.metrics.postEarningsGap),
      seed.metrics.eventConcentration,
      boundedScore(seed.metrics.earningsDays, 7, 45, false),
    ]),
  );

  const businessRisk = round(
    average([
      financialStress,
      cashBurnDilution,
      marginFragility,
      seed.metrics.cyclicality,
    ]),
  );

  const valuationRisk = round(
    average([
      seed.metrics.sectorValuationPercentile,
      seed.metrics.selfValuationPercentile,
      rankScore(universe, seed, (security) => security.metrics.growthAdjustedValuation),
    ]),
  );

  const portfolioContribution = round(
    average([
      overlap.corrToPortfolio * 100,
      overlap.corrToLargest * 100,
      100 - sectorBalance,
      100 - factorBalance,
    ]),
  );

  const overallRisk = round(
    marketRisk * 0.25 +
      eventRisk * 0.15 +
      businessRisk * 0.25 +
      valuationRisk * 0.1 +
      portfolioContribution * 0.25,
  );

  const bucket = riskBucket(overallRisk);
  const risk: RiskBreakdown = {
    market: marketRisk,
    event: eventRisk,
    business: businessRisk,
    valuation: valuationRisk,
    portfolioContribution,
    overall: overallRisk,
    bucket,
    expectedDownside: round(
      clamp(
        0.06 +
          marketRisk / 1000 +
          eventRisk / 1400 +
          businessRisk / 1400 +
          portfolioContribution / 1600,
        0.08,
        0.3,
      ),
      3,
    ),
    sizeCapMultiplier: sizeCapMultiplier(bucket),
  };

  const opp = (opportunity.score - 50) / 50;
  const frag = (fragility.score - 50) / 50;
  const time = (timing.score - 50) / 50;
  const fit = (portfolioFit.score - 50) / 50;
  const conf = (confidence - 50) / 50;
  const regimeBonus =
    regime.deploymentTilt * ((seed.factors.momentum + seed.factors.quality) / 200 - 0.5);

  let composite = toScore(
    clamp(
      0.36 * opp -
        0.24 * frag +
        0.14 * time +
        0.18 * fit +
        0.08 * conf +
        regimeBonus * 0.18,
      -1,
      1,
    ),
  );

  if (dataset.user.excludedSectors.includes(seed.sector)) {
    composite = Math.min(composite, 38);
  }
  if (dataset.user.avoidCashBurners && seed.metrics.fcfMargin < 0) {
    composite = Math.min(composite, 49);
  }

  const base12 = clamp(
    0.06 +
      0.14 * opp -
      0.12 * frag +
      0.06 * time +
      0.05 * fit +
      0.03 * conf +
      regime.deploymentTilt * 0.03,
    -0.15,
    0.34,
  );

  const probabilityPositive12 = sigmoid(
    -0.08 + 1.35 * opp - 1.05 * frag + 0.36 * time + 0.24 * fit + 0.18 * conf,
  );
  const probabilityOutperform12 = sigmoid(
    -0.12 + 1.2 * opp - 0.88 * frag + 0.28 * fit + regime.deploymentTilt * 0.12,
  );
  const probabilityDrawdown12 = sigmoid(
    -0.5 + ((overallRisk - 50) / 50) * 1.2 + frag * 0.45 - time * 0.35,
  );

  const expectedReturns: ExpectedReturnScenario[] = ([
    { horizon: '3M', multiple: 0.34 },
    { horizon: '6M', multiple: 0.61 },
    { horizon: '12M', multiple: 1 },
  ] as const).map(({ horizon, multiple }) => {
    const expected = round(clamp(base12 * multiple, -0.12, 0.34), 3);
    const bear = round(
      -clamp(risk.expectedDownside * (0.55 + multiple * 0.65), 0.06, 0.34),
      3,
    );
    const bull = round(clamp(expected + 0.09 * multiple + 0.06 * opp, 0.02, 0.52), 3);

    return {
      horizon,
      expected,
      probabilityPositive: round(
        clamp(probabilityPositive12 - (1 - multiple) * 0.06, 0.08, 0.92),
        3,
      ),
      probabilityOutperform: round(
        clamp(probabilityOutperform12 - (1 - multiple) * 0.05, 0.07, 0.91),
        3,
      ),
      probabilityDrawdown: round(
        clamp(probabilityDrawdown12 - (1 - multiple) * 0.04, 0.06, 0.88),
        3,
      ),
      bear,
      base: expected,
      bull,
    };
  });

  const excessiveSector = sectorWeightAfter > dataset.user.maxSectorWeight;
  const excessiveSingle =
    currentWeight > dataset.user.maxSinglePositionWeight ||
    (currentWeight === 0 && testWeight > dataset.user.maxSinglePositionWeight);

  let action: ActionLabel = 'Watch only';

  if (dataset.user.excludedSectors.includes(seed.sector)) {
    action = 'Avoid';
  } else if (isHeld && (excessiveSingle || excessiveSector) && overallRisk >= 58) {
    action = 'Trim';
  } else if (isHeld) {
    action = composite >= 57 ? 'Hold' : 'Trim';
  } else if (dataset.user.avoidEarningsRisk && seed.metrics.earningsDays < 14) {
    action = 'Reassess after earnings';
  } else if (portfolioFit.score < 42 && opportunity.score >= 65) {
    action = 'Not suitable for current portfolio';
  } else if (overallRisk >= 74 && expectedReturns[2].expected > 0.16) {
    action = 'High-upside / high-risk only';
  } else if (composite >= 70 && timing.score >= 60 && overallRisk <= 58 && confidence >= 64) {
    action = 'Buy now';
  } else if (composite >= 63 && timing.score >= 55 && overallRisk <= 68) {
    action = 'Buy partial';
  } else if (opportunity.score >= 64 && composite >= 55) {
    action = 'Accumulate slowly';
  } else if (opportunity.score >= 54 || portfolioFit.score >= 58) {
    action = 'Watch only';
  } else {
    action = 'Avoid';
  }

  const maxWeight = round(
    Math.min(
      dataset.user.maxSinglePositionWeight,
      dataset.user.maxSinglePositionWeight * risk.sizeCapMultiplier,
      Math.max(dataset.user.maxSectorWeight - currentSectorWeight / 100, 0.01),
    ),
    3,
  );

  const actionBaseWeight =
    action === 'Buy now'
      ? 0.07
      : action === 'Buy partial'
        ? 0.045
        : action === 'Accumulate slowly'
          ? 0.032
          : action === 'High-upside / high-risk only'
            ? 0.018
            : action === 'Trim'
              ? Math.max(dataset.user.maxSinglePositionWeight * risk.sizeCapMultiplier, 0.06)
              : 0;

  const suggestedWeight = round(
    clamp(
      Math.min(actionBaseWeight * (0.8 + confidence / 200), maxWeight),
      0,
      isHeld ? currentWeight : maxWeight,
    ),
    3,
  );

  const suggestedDollars = round(
    isHeld && action === 'Trim'
      ? Math.max((currentWeight - suggestedWeight) * portfolioContext.portfolioValue, 0)
      : suggestedWeight * portfolioContext.portfolioValue,
    0,
  );

  const entryStyle =
    action === 'Buy now' && overallRisk < 52
      ? 'Single entry'
      : action === 'Buy partial' || action === 'Accumulate slowly'
        ? 'Two tranches'
        : action === 'High-upside / high-risk only'
          ? 'Three tranches'
          : action === 'Reassess after earnings'
            ? 'Wait for event'
            : isHeld && action === 'Trim'
              ? 'Reduce over 2 sessions'
              : 'No trade';

  const allocation: AllocationSuggestion = {
    suggestedWeight,
    suggestedDollars,
    maxWeight,
    entryStyle,
    reserveAfterTrade: round(
      Math.max(
        dataset.user.targetCashReserve,
        dataset.user.investableCash - (isHeld && action === 'Trim' ? 0 : suggestedDollars),
      ),
      0,
    ),
    reasoning:
      action === 'Trim'
        ? 'Position exceeds the current concentration or risk budget and should be reduced toward a compliant size.'
        : action === 'Buy now' || action === 'Buy partial' || action === 'Accumulate slowly'
          ? 'Sizing is capped by portfolio constraints, sector room, and the stock’s risk bucket rather than by upside alone.'
          : 'No capital is allocated because either fit, timing, or risk discipline is not strong enough.',
  };

  const fitImpact: FitImpact = {
    overlapScore: round(overlap.corrToPortfolio * 100),
    concentrationDelta: round((sectorWeightAfter - currentSectorWeight / 100) * 100, 1),
    sectorWeightAfter: round(sectorWeightAfter * 100, 1),
    diversificationDelta: round((diversification - 50) / 10, 1),
    portfolioVolDelta: round((overallRisk - 50) / 5, 1),
  };

  const driverPool = [...opportunity.groups, ...timing.groups, ...portfolioFit.groups]
    .filter((item) => item.value >= 58)
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, 4);

  const penaltyPool = [
    ...fragility.groups,
    {
      label: 'Portfolio overlap',
      value: round(overlap.corrToPortfolio * 100),
      weight: 0.18,
      contribution: round(overlap.corrToPortfolio * 18),
      narrative: 'High overlap reduces incremental diversification.',
      tone: 'negative' as const,
    },
    {
      label: 'Sector pressure',
      value: round(100 - sectorBalance),
      weight: 0.14,
      contribution: round((100 - sectorBalance) * 0.14),
      narrative: 'Sector concentration limits position eligibility.',
      tone: 'negative' as const,
    },
  ]
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, 4);

  const explanation: Explainability = {
    summary: `${seed.symbol} lands at ${round(composite)} composite with ${action}. Opportunity is ${round(
      opportunity.score,
    )}, fragility is ${round(fragility.score)}, portfolio fit is ${round(
      portfolioFit.score,
    )}, and confidence is ${confidence}.`,
    topDrivers: driverPool,
    topPenalties: penaltyPool,
    riskNotes: [
      `Market risk ${marketRisk}/100, event risk ${eventRisk}/100, business risk ${businessRisk}/100.`,
      `Expected downside is roughly ${round(risk.expectedDownside * 100, 1)}% in a stressed scenario.`,
    ],
    fitNotes: [
      `Estimated portfolio overlap is ${fitImpact.overlapScore}/100.`,
      `Sector weight would be ${fitImpact.sectorWeightAfter}% after a fresh add.`,
    ],
    regimeNotes: [
      `${regime.key}: ${regime.narrative}`,
      `Current factor emphasis is ${regime.factorEmphasis.join(', ')}.`,
    ],
    allocationNotes: [
      allocation.reasoning,
      `Suggested sizing cap is ${round(allocation.maxWeight * 100, 1)}% of portfolio value.`,
    ],
    watchPoints: seed.watchPoints,
    dataQualityNotes: [
      `Fundamentals last updated ${seed.fundamentalsLastUpdated}.`,
      seed.metrics.liquidityScore >= 85
        ? 'Liquidity is strong; confidence is not being penalized materially for execution risk.'
        : 'Liquidity is lower than ideal, so confidence and sizing are capped.',
    ],
    changeTriggers: [
      'A lower fragility score or wider sector room would improve the recommendation.',
      'Deteriorating revisions, weaker cash conversion, or a worse regime would lower the action.',
    ],
  };

  return {
    symbol: seed.symbol,
    opportunity,
    fragility,
    timing,
    portfolioFit,
    confidence,
    composite: round(composite),
    risk,
    expectedReturns,
    action,
    fitImpact,
    allocation,
    explanation,
  } satisfies ScoreCard;
}

function buildHoldingAnalysis(
  dataset: MockDataset,
  scorecards: ScoreCard[],
  portfolioContext: ReturnType<typeof buildPortfolioContext>,
) {
  return portfolioContext.holdings.map((entry) => {
    const scorecard = scorecards.find((score) => score.symbol === entry.security.symbol);

    if (!scorecard) {
      throw new Error(`Missing scorecard for holding ${entry.security.symbol}`);
    }

    return {
      symbol: entry.security.symbol,
      shares: entry.holding.shares,
      marketValue: round(entry.marketValue, 0),
      weight: round(safeDivide(entry.marketValue, portfolioContext.portfolioValue) * 100, 1),
      gainLossPct: round(
        safeDivide(entry.security.price - entry.holding.costBasis, entry.holding.costBasis) * 100,
        1,
      ),
      action: scorecard.action,
      riskContribution: round(
        safeDivide(entry.marketValue, portfolioContext.portfolioValue) * scorecard.risk.overall,
        1,
      ),
      overlapToPortfolio: scorecard.fitImpact.overlapScore,
      concentrationFlag:
        safeDivide(entry.marketValue, portfolioContext.portfolioValue) >
        dataset.user.maxSinglePositionWeight,
    } satisfies HoldingAnalysis;
  });
}

function buildAlerts(
  dataset: MockDataset,
  regime: RegimeSnapshot,
  scorecards: ScoreCard[],
  portfolioContext: ReturnType<typeof buildPortfolioContext>,
) {
  const alerts: AlertItem[] = [
    {
      id: 'regime',
      severity: regime.deploymentTilt < 0 ? 'high' : 'medium',
      kind: 'Regime',
      message: `${regime.key}. ${regime.narrative}`,
      route: '/',
    },
  ];

  scorecards.forEach((scorecard) => {
    const security = dataset.securities.find((item) => item.symbol === scorecard.symbol);

    if (!security) {
      return;
    }

    const previousComposite =
      security.scoreHistory[security.scoreHistory.length - 1] ?? scorecard.composite;
    const compositeDelta = round(scorecard.composite - previousComposite, 1);

    if (Math.abs(compositeDelta) >= 5) {
      alerts.push({
        id: `${scorecard.symbol}-score`,
        symbol: scorecard.symbol,
        severity: compositeDelta > 0 ? 'medium' : 'high',
        kind: 'Score change',
        message: `${scorecard.symbol} composite moved ${compositeDelta > 0 ? 'up' : 'down'} by ${Math.abs(
          compositeDelta,
        )} points.`,
        route: `/stocks/${scorecard.symbol}`,
      });
    }

    const riskDelta = round(scorecard.risk.overall - security.previousRisk, 1);
    if (Math.abs(riskDelta) >= 6) {
      alerts.push({
        id: `${scorecard.symbol}-risk`,
        symbol: scorecard.symbol,
        severity: riskDelta > 0 ? 'high' : 'low',
        kind: 'Risk change',
        message: `${scorecard.symbol} risk changed by ${riskDelta} points.`,
        route: `/stocks/${scorecard.symbol}`,
      });
    }

    if (
      dataset.user.avoidEarningsRisk &&
      security.metrics.earningsDays < 14 &&
      !dataset.holdings.some((holding) => holding.symbol === security.symbol)
    ) {
      alerts.push({
        id: `${scorecard.symbol}-earnings`,
        symbol: scorecard.symbol,
        severity: 'medium',
        kind: 'Earnings proximity',
        message: `${scorecard.symbol} is inside the earnings risk window.`,
        route: `/stocks/${scorecard.symbol}`,
      });
    }
  });

  portfolioContext.sectorExposure.forEach((entry) => {
    if (entry.weight / 100 > dataset.user.maxSectorWeight) {
      alerts.push({
        id: `${entry.sector}-sector-cap`,
        severity: 'high',
        kind: 'Concentration',
        message: `${entry.sector} exposure is ${round(entry.weight, 1)}% versus a ${round(dataset.user.maxSectorWeight * 100, 0)}% cap.`,
        route: '/portfolio',
      });
    }
  });

  return alerts.slice(0, 12);
}

function buildWatchlistMovers(dataset: MockDataset) {
  return dataset.watchlists.flatMap((watchlist) => {
    return watchlist.symbols
      .map((symbol) => {
        const security = dataset.securities.find((item) => item.symbol === symbol);

        if (!security) {
          return null;
        }

        return {
          watchlist: watchlist.name,
          symbol,
          move: round(security.metrics.ret1m * 100, 1),
          note:
            security.metrics.ret1m >= 0
              ? `${symbol} is up ${round(security.metrics.ret1m * 100, 1)}% over 1M.`
              : `${symbol} is down ${round(Math.abs(security.metrics.ret1m) * 100, 1)}% over 1M.`,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  });
}

function currentPriorityBoost(priority: PlannerInputs['priority']) {
  if (priority === 'growth') {
    return { fitFloor: 45, riskCap: 72, deployAdjustment: 0.08 };
  }
  if (priority === 'diversification') {
    return { fitFloor: 58, riskCap: 66, deployAdjustment: 0.03 };
  }
  if (priority === 'conviction') {
    return { fitFloor: 48, riskCap: 70, deployAdjustment: 0.05 };
  }
  return { fitFloor: 60, riskCap: 58, deployAdjustment: -0.04 };
}

export function buildDeploymentPlan(
  dataset: MockDataset,
  regime: RegimeSnapshot,
  scorecards: ScoreCard[],
  portfolioValue: number,
  inputs: PlannerInputs,
) {
  const priority = currentPriorityBoost(inputs.priority);
  const candidatePool = scorecards
    .filter(
      (scorecard) =>
        !dataset.holdings.some((holding) => holding.symbol === scorecard.symbol) &&
        ['Buy now', 'Buy partial', 'Accumulate slowly', 'High-upside / high-risk only'].includes(
          scorecard.action,
        ) &&
        scorecard.portfolioFit.score >= priority.fitFloor &&
        scorecard.risk.overall <= priority.riskCap,
    )
    .sort((left, right) => right.composite - left.composite);

  const topSetQuality = average(candidatePool.slice(0, 3).map((item) => item.composite));
  const riskStanceAdjustment =
    inputs.riskTolerance === 'aggressive'
      ? 0.12
      : inputs.riskTolerance === 'moderate-aggressive'
        ? 0.06
        : inputs.riskTolerance === 'moderate'
          ? -0.02
          : -0.1;

  let deployFraction = clamp(
    0.34 +
      regime.deploymentTilt * 0.18 +
      (topSetQuality - 60) / 120 +
      riskStanceAdjustment +
      priority.deployAdjustment,
    0.12,
    0.78,
  );

  if (candidatePool.length === 0) {
    deployFraction = 0;
  }

  if (inputs.deploymentStyle === 'stage-entries') {
    deployFraction -= 0.1;
  }

  if (inputs.deploymentStyle === 'hold-flexibility') {
    deployFraction -= 0.06;
  }

  if (inputs.horizonMonths < 12) {
    deployFraction -= 0.08;
  }

  deployFraction = clamp(deployFraction, 0.1, 0.78);

  if (candidatePool.length === 0) {
    deployFraction = 0;
  }

  const reserveTarget = clamp(
    Math.max(dataset.user.targetCashReserve, inputs.availableCash * (1 - deployFraction)),
    0,
    inputs.availableCash,
  );
  const deployNow = Math.round(clamp(inputs.availableCash - reserveTarget, 0, inputs.availableCash));
  const holdBack = Math.max(inputs.availableCash - deployNow, 0);

  const weights = candidatePool.slice(0, 4).map((candidate) => {
    const scoreEdge =
      candidate.composite +
      candidate.expectedReturns[2].expected * 100 -
      candidate.risk.overall * 0.35;
    return {
      candidate,
      rawWeight: Math.max(scoreEdge, 0.1),
    };
  });

  const totalWeight = sum(weights.map((entry) => entry.rawWeight));

  const allocations = weights
    .map(({ candidate, rawWeight }) => {
      const normalizedWeight = totalWeight === 0 ? 0 : rawWeight / totalWeight;
      const dollars = Math.round(
        clamp(
          deployNow * normalizedWeight,
          0,
        candidate.allocation.maxWeight * portfolioValue,
      ),
    );

    const role =
      candidate.portfolioFit.score >= 70
        ? 'Diversifier'
        : candidate.opportunity.score >= 75
          ? 'High-quality growth'
          : 'Selective upside';

      return {
        symbol: candidate.symbol,
        dollars,
        weight: round(safeDivide(dollars, portfolioValue) * 100, 1),
        role,
        entryStyle: candidate.allocation.entryStyle,
        rationale: `${candidate.action}. ${candidate.explanation.summary}`,
      };
    })
    .filter((allocation) => allocation.dollars > 0);

  const avoids = scorecards
    .filter(
      (candidate) =>
        !dataset.holdings.some((holding) => holding.symbol === candidate.symbol) &&
        ['Avoid', 'Not suitable for current portfolio', 'Reassess after earnings'].includes(
          candidate.action,
        ),
    )
    .slice(0, 4)
    .map((candidate) => ({
      symbol: candidate.symbol,
      reason: candidate.explanation.topPenalties[0]?.narrative ?? candidate.explanation.summary,
    }));

  return {
    availableCash: inputs.availableCash,
    deployNow,
    holdBack,
    reserveTarget,
    posture:
      candidatePool.length === 0
        ? 'Wait for better setups'
        : deployFraction >= 0.55
        ? 'Selective deployment'
        : deployFraction >= 0.35
          ? 'Measured deployment'
          : 'Capital preservation',
    rationale: [
      ...(candidatePool.length === 0 ? ['No stocks currently meet the plan filters for fit, risk, and timing.'] : []),
      `Regime is ${regime.key.toLowerCase()}, so cash deployment is ${regime.deploymentTilt > 0 ? 'allowed' : 'restrained'}.`,
      `Priority mode is ${inputs.priority}; the engine filters for fit floor ${priority.fitFloor} and risk cap ${priority.riskCap}.`,
      `Top opportunity-set quality is ${round(topSetQuality)} composite.`,
    ],
    allocations,
    avoids,
  } satisfies DeploymentPlan;
}

export function buildCommandCenterModel(dataset: MockDataset): CommandCenterModel {
  const regime = inferRegime(dataset);
  const portfolioContext = buildPortfolioContext(dataset);
  const scorecards = dataset.securities
    .map((security) => scoreSecurity(dataset, regime, portfolioContext, security))
    .sort((left, right) => right.composite - left.composite);
  const holdings = buildHoldingAnalysis(dataset, scorecards, portfolioContext);
  const alerts = buildAlerts(dataset, regime, scorecards, portfolioContext);
  const deploymentPlan = buildDeploymentPlan(
    dataset,
    regime,
    scorecards,
    portfolioContext.portfolioValue,
    {
      availableCash: dataset.user.investableCash,
      riskTolerance: dataset.user.riskTolerance,
      horizonMonths: dataset.user.timeHorizonMonths,
      priority: 'diversification',
      deploymentStyle: 'stage-entries',
    },
  );

  const riskExposure = ['Defensive', 'Moderate', 'Elevated', 'Aggressive', 'Fragile'].map(
    (bucket) => ({
      bucket: bucket as RiskBucket,
      value: round(
        sum(
          holdings
            .filter((holding) => {
              const scorecard = scorecards.find((card) => card.symbol === holding.symbol);
              return scorecard?.risk.bucket === bucket;
            })
            .map((holding) => holding.weight),
        ),
        1,
      ),
    }),
  );

  const concentrationIssues = holdings
    .filter((holding) => holding.concentrationFlag)
    .map(
      (holding) =>
        `${holding.symbol} is ${round(holding.weight, 1)}% of portfolio value versus a ${round(dataset.user.maxSinglePositionWeight * 100, 0)}% single-name cap.`,
    );

  portfolioContext.sectorExposure.forEach((entry) => {
    if (entry.weight / 100 > dataset.user.maxSectorWeight) {
      concentrationIssues.push(
        `${entry.sector} is ${round(entry.weight, 1)}% of portfolio value versus a ${round(dataset.user.maxSectorWeight * 100, 0)}% sector cap.`,
      );
    }
  });

  const concentrationBase = sum(
    holdings.map((holding) => {
      const weight = holding.weight / 100;
      return weight * weight;
    }),
  );
  const diversificationBase = clamp((1 - concentrationBase) * 140, 0, 100);
  const diversificationScore = round(
    clamp(diversificationBase - concentrationIssues.length * 18, 0, 100),
  );

  return {
    dataset,
    regime,
    scorecards,
    holdings,
    alerts,
    watchlistMovers: buildWatchlistMovers(dataset),
    deploymentPlan,
    sectorExposure: portfolioContext.sectorExposure,
    factorExposure: Object.entries(portfolioContext.factorTotals).map(([factor, value]) => ({
      factor,
      value: round(value, 1),
    })),
    riskExposure,
    concentrationIssues,
    notableChanges: alerts.slice(0, 5).map((alert) => alert.message),
    portfolioValue: round(portfolioContext.portfolioValue, 0),
    diversificationScore,
    averageRisk: round(average(holdings.map((holding) => holding.riskContribution)), 1),
  };
}

export function getScorecard(model: CommandCenterModel, symbol: string) {
  return model.scorecards.find((scorecard) => scorecard.symbol === symbol);
}

export function getSecurity(model: CommandCenterModel, symbol: string) {
  return model.dataset.securities.find((security) => security.symbol === symbol);
}

export function getHolding(model: CommandCenterModel, symbol: string) {
  return model.holdings.find((holding) => holding.symbol === symbol);
}

export function profileSummary(dataset: MockDataset) {
  const reserve = Math.round(dataset.user.targetCashReserve).toLocaleString('en-US');
  const sectorCap = round(dataset.user.maxSectorWeight * 100, 0);

  return `${dataset.user.name} targets ${describeStrategy(
    dataset.user.strategyWeights,
  )} with $${reserve} cash reserved and a ${sectorCap}% sector cap.`;
}
