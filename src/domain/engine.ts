import { average, clamp, correlationCoefficient, percentileRank, round, sigmoid, sum, toScore } from './math';
import { replayTransactions } from './portfolioAccounting';
import type {
  ActionLabel,
  AlertItem,
  AllocationSuggestion,
  CommandCenterModel,
  ConfidenceBand,
  DecisionFrame,
  DeploymentPlan,
  ExpectedReturnScenario,
  Explainability,
  FitImpact,
  FreshnessBreakdown,
  FreshnessHierarchy,
  HoldingAnalysis,
  MockDataset,
  OpportunityRadarItem,
  PortfolioLedgerSummary,
  PortfolioFragilityAnalysis,
  PortfolioIQSummary,
  PlannerInputs,
  RecommendationRecord,
  RecommendationRunSnapshot,
  RegimeSnapshot,
  RecommendationChange,
  RiskBudgetSummary,
  RiskBreakdown,
  RiskBucket,
  ScoreBreakdown,
  ScoreContribution,
  ScoreCard,
  SecuritySeed,
  SellDiscipline,
  SignalAudit,
  StressScenarioResult,
  StrategyWeights,
  ThesisSummary,
  ThesisHealth,
  WatchlistSignal,
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

function daysBetween(earlier: string | undefined, later: string | undefined) {
  if (!earlier || !later) {
    return 0;
  }

  const earlierDate = new Date(earlier);
  const laterDate = new Date(later);

  if (Number.isNaN(earlierDate.getTime()) || Number.isNaN(laterDate.getTime())) {
    return 0;
  }

  return Math.max(0, Math.round((laterDate.getTime() - earlierDate.getTime()) / (24 * 60 * 60 * 1000)));
}

function meanAbsoluteDeviation(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const center = average(values);
  return average(values.map((value) => Math.abs(value - center)));
}

function freshnessStatus(days: number, freshCutoff: number, staleCutoff: number) {
  if (days <= freshCutoff) {
    return 'fresh' as const;
  }
  if (days <= staleCutoff) {
    return 'aging' as const;
  }
  return 'stale' as const;
}

function confidenceBand(confidence: number, dataQualityScore: number, overallRisk: number): ConfidenceBand {
  if (confidence >= 76 && dataQualityScore >= 72 && overallRisk <= 60) {
    return 'High confidence';
  }
  if (confidence >= 58 && dataQualityScore >= 54) {
    return 'Medium confidence';
  }
  return 'Low confidence';
}

function crowdingScore(values: number[]) {
  const level = average(values);
  const dispersion = meanAbsoluteDeviation(values);
  return round(clamp(level - dispersion * 2.2 - 44, 0, 100), 1);
}

type SignalAuditMember = {
  label: string;
  value: number;
  weight: number;
  series: number[];
};

function detectCorrelatedPairs(family: string, members: SignalAuditMember[]) {
  const pairs: SignalAudit['correlatedPairs'] = [];

  for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < members.length; rightIndex += 1) {
      const correlation = round(
        correlationCoefficient(members[leftIndex].series, members[rightIndex].series),
        2,
      );

      if (Math.abs(correlation) < 0.78) {
        continue;
      }

      pairs.push({
        family,
        pair: `${members[leftIndex].label} / ${members[rightIndex].label}`,
        correlation,
      });
    }
  }

  return pairs;
}

function summarizeSignalFamily(family: string, members: SignalAuditMember[]) {
  const correlatedPairs = detectCorrelatedPairs(family, members);
  const weightShare = round(sum(members.map((member) => member.weight)) * 100, 1);

  return {
    family,
    averageScore: round(average(members.map((member) => member.value)), 1),
    crowding: crowdingScore(members.map((member) => member.value)),
    weightShare,
    correlatedPairs: correlatedPairs.map((pair) => `${pair.pair} (${pair.correlation})`),
  };
}

function confidenceCalibrationAdjustment(
  dataset: MockDataset,
  band: ConfidenceBand,
) {
  const metric = dataset.validationReport?.confidenceBands?.find((item) => item.band === band);

  if (!metric || metric.count < 5) {
    return 0;
  }

  const calibrationGap = metric.realized - metric.predicted;
  return round(clamp(calibrationGap * 12, -6, 6), 1);
}

function suggestedRangeMidpoint(value: number, downsideBias: number, maxValue: number) {
  const width = clamp(0.18 + downsideBias, 0.12, 0.4);
  const lower = round(clamp(value * (1 - width), 0, maxValue), 3);
  const upper = round(clamp(value * (1 + width * 0.65), lower, maxValue), 3);

  return [lower, upper] as [number, number];
}

function actionRank(action: ActionLabel) {
  switch (action) {
    case 'Buy now':
      return 0;
    case 'Buy partial':
      return 1;
    case 'Accumulate slowly':
      return 2;
    case 'Watch only':
      return 3;
    case 'Reassess after earnings':
      return 4;
    case 'High-upside / high-risk only':
      return 5;
    case 'Hold':
      return 6;
    case 'Trim':
      return 7;
    case 'Take profit':
      return 8;
    case 'De-risk':
      return 9;
    case 'Rotate':
      return 10;
    case 'Sell':
      return 11;
    case 'Not suitable for current portfolio':
      return 12;
    case 'Avoid':
    default:
      return 13;
  }
}

function downgradeBuyAction(action: ActionLabel): ActionLabel {
  switch (action) {
    case 'Buy now':
      return 'Buy partial';
    case 'Buy partial':
      return 'Accumulate slowly';
    case 'Accumulate slowly':
      return 'Watch only';
    default:
      return action;
  }
}

type ActionInputs = {
  isHeld: boolean;
  excludedSector: boolean;
  avoidEarningsRisk: boolean;
  earningsDays: number;
  businessQuality: number;
  entryQuality: number;
  opportunityScore: number;
  portfolioFitScore: number;
  timingScore: number;
  overallRisk: number;
  confidence: number;
  composite: number;
  expected12m: number;
  excessiveSingle: boolean;
  excessiveSector: boolean;
  regimeTilt: number;
  dataQualityScore: number;
};

function classifyAction(inputs: ActionInputs): ActionLabel {
  const riskTightener = inputs.regimeTilt < 0 ? 3 : inputs.regimeTilt > 0.1 ? -1 : 0;
  const confidenceTightener = inputs.regimeTilt < 0 ? 3 : 0;

  if (inputs.excludedSector) {
    return 'Avoid';
  }

  if (inputs.isHeld && (inputs.excessiveSingle || inputs.excessiveSector) && inputs.overallRisk >= 56) {
    return 'Trim';
  }

  if (inputs.isHeld) {
    return inputs.composite >= 56 && inputs.businessQuality >= 52 ? 'Hold' : 'Trim';
  }

  if (inputs.avoidEarningsRisk && inputs.earningsDays < 14) {
    return 'Reassess after earnings';
  }

  if (inputs.portfolioFitScore < 42 && inputs.opportunityScore >= 65) {
    return 'Not suitable for current portfolio';
  }

  if (inputs.overallRisk >= 74 + riskTightener && inputs.expected12m > 0.16) {
    return 'High-upside / high-risk only';
  }

  if (inputs.businessQuality >= 72 && inputs.entryQuality < 54) {
    return 'Watch only';
  }

  if (
    inputs.composite >= 70 + riskTightener &&
    inputs.businessQuality >= 62 &&
    inputs.entryQuality >= 58 &&
    inputs.timingScore >= 60 + riskTightener &&
    inputs.overallRisk <= 58 - riskTightener &&
    inputs.confidence >= 64 + confidenceTightener &&
    inputs.dataQualityScore >= 62 &&
    inputs.expected12m >= 0.08
  ) {
    return 'Buy now';
  }

  if (
    inputs.composite >= 63 + Math.max(riskTightener, 0) &&
    inputs.businessQuality >= 58 &&
    inputs.entryQuality >= 54 &&
    inputs.timingScore >= 55 &&
    inputs.overallRisk <= 68 - Math.max(riskTightener, 0) &&
    inputs.dataQualityScore >= 56 &&
    inputs.expected12m >= 0.05
  ) {
    return 'Buy partial';
  }

  if (inputs.opportunityScore >= 64 && inputs.composite >= 55 && inputs.expected12m >= 0.03) {
    return 'Accumulate slowly';
  }

  if (inputs.opportunityScore >= 54 || inputs.portfolioFitScore >= 58) {
    return 'Watch only';
  }

  return 'Avoid';
}

function applyActionHysteresis({
  action,
  previousAction,
  compositeDelta,
  riskDelta,
  hardLocked,
}: {
  action: ActionLabel;
  previousAction: ActionLabel;
  compositeDelta: number;
  riskDelta: number;
  hardLocked: boolean;
}) {
  if (hardLocked) {
    return action;
  }

  if (Math.abs(compositeDelta) < 4 && Math.abs(riskDelta) < 5) {
    return previousAction;
  }

  return action;
}

function thesisHealth({
  action,
  businessQuality,
  compositeDelta,
  riskDelta,
  downsideDelta,
}: {
  action: ActionLabel;
  businessQuality: number;
  compositeDelta: number;
  riskDelta: number;
  downsideDelta: number;
}): ThesisHealth {
  if ((action === 'Sell' && businessQuality < 52) || (compositeDelta <= -8 && riskDelta >= 8)) {
    return 'Broken';
  }

  if (['Trim', 'De-risk', 'Rotate', 'Take profit'].includes(action) || compositeDelta <= -4 || riskDelta >= 5 || downsideDelta >= 0.025) {
    return 'Weakening';
  }

  if (compositeDelta >= 4 && riskDelta <= -4 && downsideDelta <= -0.015) {
    return 'Improving';
  }

  return 'Stable';
}

function buildFreshnessBreakdown(
  dataset: MockDataset,
  seed: SecuritySeed,
  dataQuality: ReturnType<typeof assessDataQuality>,
): FreshnessBreakdown {
  const quoteAsOf = seed.priceAsOf ?? dataset.asOf;
  const macroFreshnessDays = dataset.macroSnapshot ? daysBetween(dataset.macroSnapshot.asOf, dataset.asOf) : undefined;
  const validationFreshnessDays = dataset.validationReport
    ? daysBetween(dataset.validationReport.generatedAt, dataset.asOf)
    : undefined;
  const modelAsOf = dataset.snapshotGeneratedAt ?? dataset.asOf;

  return {
    quoteAsOf,
    quoteFreshnessDays: dataQuality.priceFreshnessDays,
    quoteStatus: freshnessStatus(dataQuality.priceFreshnessDays, 1, 4),
    fundamentalsAsOf: seed.fundamentalsLastUpdated,
    fundamentalsFreshnessDays: dataQuality.fundamentalsFreshnessDays,
    fundamentalsStatus: freshnessStatus(dataQuality.fundamentalsFreshnessDays, 45, 180),
    macroAsOf: dataset.macroSnapshot?.asOf,
    macroFreshnessDays,
    macroStatus: macroFreshnessDays != null ? freshnessStatus(macroFreshnessDays, 7, 35) : 'aging',
    validationAsOf: dataset.validationReport?.generatedAt,
    validationFreshnessDays,
    validationStatus:
      validationFreshnessDays != null ? freshnessStatus(validationFreshnessDays, 14, 45) : 'aging',
    modelAsOf,
    modelFreshnessDays: daysBetween(modelAsOf, dataset.asOf),
    modelStatus: freshnessStatus(daysBetween(modelAsOf, dataset.asOf), 1, 5),
  };
}

function buildFreshnessHierarchy(dataset: MockDataset, scorecards: ScoreCard[]): FreshnessHierarchy {
  const quoteFreshnessDays = scorecards.length > 0
    ? round(average(scorecards.map((card) => card.freshness.quoteFreshnessDays)), 1)
    : daysBetween(dataset.asOf, dataset.asOf);
  const fundamentalsFreshnessDays = scorecards.length > 0
    ? round(average(scorecards.map((card) => card.freshness.fundamentalsFreshnessDays)), 1)
    : daysBetween(dataset.asOf, dataset.asOf);
  const macroFreshnessDays = dataset.macroSnapshot ? daysBetween(dataset.macroSnapshot.asOf, dataset.asOf) : undefined;
  const validationFreshnessDays = dataset.validationReport
    ? daysBetween(dataset.validationReport.generatedAt, dataset.asOf)
    : undefined;
  const modelAsOf = dataset.snapshotGeneratedAt ?? dataset.asOf;
  const modelFreshnessDays = daysBetween(modelAsOf, dataset.asOf);

  return {
    quotes: {
      label: 'Quotes',
      asOf: dataset.asOf,
      ageDays: quoteFreshnessDays,
      status: freshnessStatus(quoteFreshnessDays, 1, 4),
      note: 'Quote freshness reflects the market-price layer, not the full engine.',
    },
    fundamentals: {
      label: 'Fundamentals',
      asOf: scorecards[0]?.freshness.fundamentalsAsOf ?? dataset.asOf,
      ageDays: fundamentalsFreshnessDays,
      status: freshnessStatus(fundamentalsFreshnessDays, 45, 180),
      note: 'Fundamental freshness is averaged across the covered universe.',
    },
    macro: {
      label: 'Macro',
      asOf: dataset.macroSnapshot?.asOf,
      ageDays: macroFreshnessDays,
      status: macroFreshnessDays != null ? freshnessStatus(macroFreshnessDays, 7, 35) : 'aging',
      note: dataset.macroSnapshot
        ? dataset.macroSnapshot.narrative
        : 'Macro overlay is not currently loaded.',
    },
    validation: {
      label: 'Validation',
      asOf: dataset.validationReport?.generatedAt,
      ageDays: validationFreshnessDays,
      status:
        validationFreshnessDays != null ? freshnessStatus(validationFreshnessDays, 14, 45) : 'aging',
      note: dataset.validationReport
        ? `${dataset.validationReport.pairCount} validation pair${
            dataset.validationReport.pairCount === 1 ? '' : 's'
          } are in the latest walk-forward report.`
        : 'Validation report is not currently available.',
    },
    model: {
      label: 'Model',
      asOf: modelAsOf,
      ageDays: modelFreshnessDays,
      status: freshnessStatus(modelFreshnessDays, 1, 5),
      note: 'Model freshness tracks when the research snapshot behind the engine was last rebuilt.',
    },
  };
}

function decileReturnLookup(score: number) {
  const decile = clamp(Math.ceil(score / 10), 1, 10);
  const table = [-0.12, -0.08, -0.05, -0.02, 0.01, 0.04, 0.07, 0.1, 0.14, 0.19];

  return table[decile - 1];
}

function buildLedgerSummary(dataset: MockDataset): PortfolioLedgerSummary {
  if (!dataset.transactions || dataset.transactions.length === 0) {
    return {
      transactionCount: 0,
      realizedPnl: 0,
      dividendsReceived: 0,
      feesPaid: 0,
      deposits: 0,
      withdrawals: 0,
      netCashFlow: 0,
      notes: [],
    };
  }

  const baseline =
    dataset.ledgerBaseline ?? {
      asOf: dataset.asOf,
      holdings: [],
      investableCash: 0,
    };

  return replayTransactions(baseline, dataset.transactions).summary;
}

function assessDataQuality(dataset: MockDataset, seed: SecuritySeed) {
  const priceFreshnessDays = daysBetween(seed.priceAsOf ?? dataset.asOf, dataset.asOf);
  const fundamentalsFreshnessDays = daysBetween(seed.fundamentalsLastUpdated, dataset.asOf);
  const sourceMode = seed.dataQuality?.sourceMode ?? (dataset.dataMode === 'live' ? 'live' : 'seeded');
  const inferredSignals =
    seed.dataQuality?.inferredSignals ??
    (seed.sector === 'Unclassified' || seed.description.includes('provisional') ? 3 : 0);
  const missingCoreFields = seed.dataQuality?.missingCoreFields?.length ?? 0;
  const coverage = seed.dataQuality?.coverage ?? (sourceMode === 'live' ? 88 : sourceMode === 'blended' ? 80 : 72);
  let staleFundamentalPenalty = Math.max(0, fundamentalsFreshnessDays - 180) * 0.08;
  if (priceFreshnessDays <= 3 && fundamentalsFreshnessDays > 45) {
    staleFundamentalPenalty = Math.min(staleFundamentalPenalty, 10);
  }
  const pricePenalty = priceFreshnessDays * 2.5;
  const inferredPenalty = inferredSignals * 7;
  const missingPenalty = missingCoreFields * 5;
  const sourceBonus = sourceMode === 'live' ? 5 : sourceMode === 'blended' ? 2 : 0;
  const score = round(clamp(coverage + sourceBonus - staleFundamentalPenalty - pricePenalty - inferredPenalty - missingPenalty, 18, 98));

  const notes = [
    `${sourceMode[0].toUpperCase()}${sourceMode.slice(1)} source mode with ${coverage}% reported coverage.`,
    `Price freshness ${priceFreshnessDays} day(s); fundamentals freshness ${fundamentalsFreshnessDays} day(s).`,
    ...(inferredSignals > 0 ? [`${inferredSignals} inferred signal block${inferredSignals === 1 ? '' : 's'} are still being used.`] : []),
    ...(missingCoreFields > 0 ? [`${missingCoreFields} core field${missingCoreFields === 1 ? '' : 's'} are missing or incomplete.`] : []),
  ];

  return {
    score,
    priceFreshnessDays,
    fundamentalsFreshnessDays,
    inferredSignals,
    missingCoreFields,
    notes,
  };
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

function thesisHealthScore(health: ThesisHealth, businessQuality: number, downsideDelta: number) {
  const base =
    health === 'Improving' ? 82 : health === 'Stable' ? 66 : health === 'Weakening' ? 42 : 18;

  return round(clamp(base + (businessQuality - 60) * 0.35 - Math.max(downsideDelta, 0) * 180, 6, 96));
}

function driverText(label: string) {
  switch (label) {
    case 'Growth engine':
      return 'Sales and earnings are growing well.';
    case 'Profitability and quality':
      return 'Margins and cash flow look healthy.';
    case 'Valuation context':
      return 'Price looks reasonable for the quality on offer.';
    case 'Market support':
      return 'Revisions, insiders, or catalysts are helping the setup.';
    case 'Balance-sheet strength':
      return 'Debt and liquidity look manageable.';
    case 'Trend quality':
      return 'Price trend is still moving the right way.';
    case 'Pullback quality':
      return 'The recent dip looks controlled rather than broken.';
    case 'Persistence':
      return 'The recent move has been sticking, not fading quickly.';
    case 'Volatility window':
      return 'Volatility is not overwhelming the setup right now.';
    case 'Diversification benefit':
      return 'It adds something new to the portfolio.';
    case 'Sector balance':
      return 'It does not overload an already crowded area.';
    case 'Factor balance':
      return 'It helps balance the style mix you already own.';
    case 'Risk-budget compatibility':
      return 'The position fits the amount of risk the portfolio can carry.';
    case 'Capital and rule fit':
      return 'It fits your cash and portfolio rules.';
    default:
      return `${label} is helping the case.`;
  }
}

function riskText(label: string) {
  switch (label) {
    case 'Financial stress':
      return 'Debt or liquidity could become a problem.';
    case 'Cash burn and dilution':
      return 'The company may need outside cash or could issue more shares.';
    case 'Event sensitivity':
      return 'Too much depends on one earnings report or catalyst.';
    case 'Margin fragility':
      return 'Margins could weaken more than expected.';
    case 'Tail-risk behavior':
      return 'The stock has a history of sharp downside moves.';
    case 'Valuation vulnerability':
      return 'Price may already be too high compared with earnings or cash flow.';
    case 'Portfolio overlap':
      return 'It moves too much like names you already own.';
    case 'Sector pressure':
      return 'It would push too much money into the same area.';
    default:
      return `${label} is the main thing to watch.`;
  }
}

function thesisSummaryForScorecard(
  symbol: string,
  drivers: ScoreContribution[],
  risks: ScoreContribution[],
  healthScore: number,
): ThesisSummary {
  const driverList = drivers.slice(0, 3).map((driver) => driverText(driver.label));
  const riskList = risks.slice(0, 3).map((risk) => riskText(risk.label));
  const driverLead = driverList[0] ?? 'The setup has some support.';
  const riskLead = riskList[0] ?? 'There is no single dominant problem, but risk still matters.';

  return {
    thesisSummary: `${symbol} looks interesting because ${driverLead.toLowerCase()} Main watch-out: ${riskLead.toLowerCase()}`,
    drivers: driverList,
    risks: riskList,
    thesisHealthScore: healthScore,
  };
}

function themeExposureLabels(seed: SecuritySeed) {
  const themes = new Set<string>();

  if (
    /semiconductor|data center|infrastructure software|networking/i.test(seed.industry) ||
    /ai|infrastructure/i.test(seed.description)
  ) {
    themes.add('AI infrastructure');
  }

  if (seed.sector === 'Technology' && seed.factors.growth >= 70) {
    themes.add('High-growth tech');
  }

  if (seed.sector === 'Energy') {
    themes.add('Energy prices');
  }

  if (seed.sector === 'Financials' || seed.sector === 'Real Estate') {
    themes.add('Interest-rate sensitive');
  }

  if (seed.sector === 'Consumer Discretionary') {
    themes.add('Consumer spending');
  }

  if (seed.sector === 'Industrials' || seed.metrics.cyclicality >= 60) {
    themes.add('Economic cycle risk');
  }

  if (seed.factors.defensive >= 70) {
    themes.add('Defensive shelter');
  }

  return [...themes];
}

function strategyAlignmentScore(args: {
  strategyWeights: StrategyWeights;
  seed: SecuritySeed;
  growth: number;
  quality: number;
  valuation: number;
  momentum: number;
  support: number;
  balanceSheet: number;
  businessQuality: number;
  timingScore: number;
  portfolioFitScore: number;
  overallRisk: number;
  marketRisk: number;
  valuationRisk: number;
}) {
  const {
    strategyWeights,
    seed,
    growth,
    quality,
    valuation,
    momentum,
    support,
    balanceSheet,
    businessQuality,
    timingScore,
    portfolioFitScore,
    overallRisk,
    marketRisk,
    valuationRisk,
  } = args;

  const score =
    strategyWeights.growth * average([growth, quality, momentum]) +
    strategyWeights.balanced * average([businessQuality, portfolioFitScore, 100 - overallRisk]) +
    strategyWeights.value * average([valuation, balanceSheet, 100 - valuationRisk]) +
    strategyWeights.momentum * average([momentum, timingScore, support]) +
    strategyWeights.quality * average([quality, balanceSheet, businessQuality]) +
    strategyWeights.speculative * average([support, momentum, growth]) +
    strategyWeights.defensive * average([seed.factors.defensive, balanceSheet, 100 - marketRisk]) +
    strategyWeights.dividend * average([quality, balanceSheet, valuation]);

  return round(clamp(score, 0, 100), 1);
}

function macroAlignmentScore(args: {
  regime: RegimeSnapshot;
  seed: SecuritySeed;
  quality: number;
  balanceSheet: number;
  growth: number;
  momentum: number;
  marketRisk: number;
  businessRisk: number;
}) {
  const { regime, seed, quality, balanceSheet, growth, momentum, marketRisk, businessRisk } = args;

  if (regime.key === 'Risk-off defensiveness' || regime.key === 'Bearish trend / high vol') {
    return round(
      average([seed.factors.defensive, quality, balanceSheet, 100 - marketRisk, 100 - seed.metrics.cyclicality]),
      1,
    );
  }

  if (regime.key === 'Risk-on rotation' || regime.key === 'Bullish trend / low vol') {
    return round(average([growth, momentum, quality, 100 - businessRisk * 0.5]), 1);
  }

  if (regime.key === 'Bullish trend / high vol') {
    return round(average([quality, momentum, balanceSheet, 100 - marketRisk]), 1);
  }

  return round(average([quality, balanceSheet, 100 - marketRisk, 100 - businessRisk]), 1);
}

function inferRegime(dataset: MockDataset): RegimeSnapshot {
  const benchmark = dataset.benchmark;
  const macro = dataset.macroSnapshot;
  const trendScore = Number(benchmark.aboveSma50) + Number(benchmark.aboveSma200);
  const macroRiskTone = macro?.riskTone ?? 0.55;
  const macroTightening =
    macroRiskTone < 0.42 ||
    (macro?.highYieldSpread ?? 0) >= 5 ||
    (macro?.curve2s10s ?? 0) < -0.2;
  const macroTail = macro ? ` ${macro.narrative}` : '';
  const environment = new Set<string>();

  if (benchmark.riskAppetite >= 0.62 && benchmark.breadth >= 0.55) {
    environment.add('Risk-on');
  }
  if (benchmark.riskAppetite < 0.45 || macroTightening) {
    environment.add('Risk-off');
  }
  if ((macro?.inflationYoY ?? 0) >= 3.2) {
    environment.add('High inflation');
  }
  if ((macro?.curve2s10s ?? 0) < -0.1 || (macro?.unemploymentRate ?? 0) >= 4.5) {
    environment.add('Slowing growth');
  }
  if (benchmark.ret3m >= 0.06 && benchmark.breadth >= 0.52) {
    environment.add('Strong growth');
  }

  if (trendScore === 2 && benchmark.realizedVolPercentile < 0.45 && !macroTightening) {
    return {
      key: 'Bullish trend / low vol',
      confidence: 78,
      deploymentTilt: 0.7,
      narrative:
        `Trend is supportive and volatility is contained. Momentum and quality can carry more weight, but concentration still matters.${macroTail}`,
      factorEmphasis: ['momentum', 'quality', 'cash deployment'],
      environment: [...environment, 'Risk-on', 'Strong growth'],
    };
  }

  if (trendScore === 2 && benchmark.realizedVolPercentile >= 0.45) {
    return {
      key: 'Bullish trend / high vol',
      confidence: 72,
      deploymentTilt: 0.46,
      narrative:
        `Trend remains constructive, but volatility is elevated. The system keeps buying selective and reserve-aware rather than fully aggressive.${macroTail}`,
      factorEmphasis: ['quality', 'timing', 'reserve discipline'],
      environment: [...environment, 'Risk-on'],
    };
  }

  if (trendScore === 0 && benchmark.realizedVolPercentile >= 0.6) {
    return {
      key: 'Bearish trend / high vol',
      confidence: 76,
      deploymentTilt: -0.65,
      narrative:
        `Weak trend and high volatility favor cash preservation, lower fragility, and defense over incremental risk.${macroTail}`,
      factorEmphasis: ['defense', 'cash', 'fragility control'],
      environment: [...environment, 'Risk-off'],
    };
  }

  if (benchmark.riskAppetite < 0.45 || macroTightening) {
    return {
      key: 'Risk-off defensiveness',
      confidence: macroTightening ? 72 : 66,
      deploymentTilt: macroTightening ? -0.5 : -0.42,
      narrative:
        `Leadership is narrow and investors are avoiding risk. The engine prefers defense, balance-sheet strength, and wider reserve cash.${macroTail}`,
      factorEmphasis: ['defensive fit', 'balance sheet', 'cash'],
      environment: [...environment, 'Risk-off'],
    };
  }

  if (benchmark.riskAppetite > 0.62 && benchmark.breadth > 0.55 && macroRiskTone > 0.55) {
    return {
      key: 'Risk-on rotation',
      confidence: 69,
      deploymentTilt: 0.32,
      narrative:
        `Breadth and risk appetite are favorable. The model allows more upside pursuit, but not at the cost of breaching portfolio constraints.${macroTail}`,
      factorEmphasis: ['growth', 'momentum', 'diversified adds'],
      environment: [...environment, 'Risk-on'],
    };
  }

  return {
    key: 'Sideways / low conviction',
    confidence: 61,
    deploymentTilt: 0,
    narrative:
      `The market signal is mixed. The engine emphasizes selective entries, staged buys, and stronger cash discipline.${macroTail}`,
    factorEmphasis: ['timing', 'fit', 'staging'],
    environment: environment.size > 0 ? [...environment] : ['Mixed market'],
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
  )[0] ?? null;

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

  const corrToLargest = portfolioContext.largestHolding
    ? correlationProxy(seed, portfolioContext.largestHolding.security)
    : corrToPortfolio;
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
    rankScore(universe, seed, (security) => security.metrics.grossMargin, true, true),
    rankScore(universe, seed, (security) => security.metrics.operatingMargin, true, true),
    rankScore(universe, seed, (security) => security.metrics.fcfMargin, true, true),
    rankScore(universe, seed, (security) => security.metrics.fcfConsistency),
    rankScore(universe, seed, (security) => security.metrics.roic, true, true),
    rankScore(universe, seed, (security) => security.metrics.marginStability),
  ]);

  const valuation = average([
    percentileScore(seed.metrics.sectorValuationPercentile, false),
    percentileScore(seed.metrics.selfValuationPercentile, false),
    rankScore(universe, seed, (security) => security.metrics.fcfYield, true, true),
    rankScore(universe, seed, (security) => security.metrics.growthAdjustedValuation, false, true),
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

  const baseSignalFamilies = [
    summarizeSignalFamily('Trend / momentum', [
      {
        label: 'Momentum quality',
        value: momentum,
        weight: opportunityWeights.momentum * 0.36,
        series: universe.map((security) =>
          average([
            security.metrics.ret3m * 100,
            security.metrics.ret6m * 100,
            security.metrics.relativeStrength,
          ]),
        ),
      },
      {
        label: 'Trend alignment',
        value: trend,
        weight: timingWeights.trend * 0.14,
        series: universe.map((security) =>
          average([
            security.metrics.ret1m * 100,
            security.metrics.ret3m * 100,
            security.metrics.trendSlope63d,
          ]),
        ),
      },
      {
        label: 'Pullback quality',
        value: pullback,
        weight: timingWeights.pullback * 0.14,
        series: universe.map((security) => security.metrics.pullbackQuality),
      },
      {
        label: 'Momentum persistence',
        value: persistence,
        weight: timingWeights.persistence * 0.14,
        series: universe.map((security) =>
          average([
            security.metrics.trendSlope63d,
            security.metrics.momentumAcceleration,
            security.metrics.relativeStrength,
          ]),
        ),
      },
    ]),
    summarizeSignalFamily('Valuation', [
      {
        label: 'Valuation context',
        value: valuation,
        weight: opportunityWeights.valuation * 0.36,
        series: universe.map((security) =>
          average([
            security.metrics.sectorValuationPercentile,
            security.metrics.selfValuationPercentile,
            -security.metrics.growthAdjustedValuation * 10,
          ]),
        ),
      },
      {
        label: 'Valuation vulnerability',
        value: valuationVulnerability,
        weight: fragilityWeights.valuationVulnerability * 0.24,
        series: universe.map((security) =>
          average([
            security.metrics.sectorValuationPercentile,
            security.metrics.selfValuationPercentile,
            security.metrics.growthAdjustedValuation * 10,
          ]),
        ),
      },
    ]),
    summarizeSignalFamily('Quality / balance sheet', [
      {
        label: 'Profitability and quality',
        value: quality,
        weight: opportunityWeights.quality * 0.36,
        series: universe.map((security) =>
          average([
            security.metrics.operatingMargin,
            security.metrics.fcfMargin,
            security.metrics.roic,
          ]),
        ),
      },
      {
        label: 'Balance-sheet support',
        value: balanceSheet,
        weight: opportunityWeights.balanceSheet * 0.36,
        series: universe.map((security) =>
          average([
            security.metrics.cashToDebt * 100,
            security.metrics.currentRatio * 30,
            security.metrics.quickRatio * 30,
          ]),
        ),
      },
      {
        label: 'Financial stress',
        value: financialStress,
        weight: fragilityWeights.financialStress * 0.24,
        series: universe.map((security) =>
          average([
            security.metrics.debtToEquity * 10,
            (1 / Math.max(security.metrics.cashToDebt, 0.05)) * 10,
            (1 / Math.max(security.metrics.currentRatio, 0.1)) * 10,
          ]),
        ),
      },
      {
        label: 'Cash-burn and dilution risk',
        value: cashBurnDilution,
        weight: fragilityWeights.cashBurnDilution * 0.24,
        series: universe.map((security) =>
          average([
            -security.metrics.fcfMargin * 100,
            100 - security.metrics.fcfConsistency,
            security.metrics.dilutionRate3y * 5000,
          ]),
        ),
      },
    ]),
    summarizeSignalFamily('Tail / event risk', [
      {
        label: 'Event sensitivity',
        value: eventSensitivity,
        weight: fragilityWeights.eventSensitivity * 0.24,
        series: universe.map((security) =>
          average([
            security.metrics.postEarningsGap * 100,
            security.metrics.eventConcentration,
            100 - security.metrics.earningsDays,
          ]),
        ),
      },
      {
        label: 'Tail and drawdown risk',
        value: tailRisk,
        weight: fragilityWeights.tailRisk * 0.24,
        series: universe.map((security) =>
          average([
            security.metrics.vol60d * 100,
            security.metrics.downsideVol60d * 100,
            Math.abs(security.metrics.maxDd12m) * 100,
            security.metrics.crashFrequency * 100,
            security.metrics.tailLoss * 100,
          ]),
        ),
      },
      {
        label: 'Event timing',
        value: eventWindow,
        weight: timingWeights.eventWindow * 0.14,
        series: universe.map((security) =>
          average([
            security.metrics.earningsDays,
            100 - security.metrics.postEarningsGap * 100,
          ]),
        ),
      },
    ]),
  ];

  const diversification = round(
    average([
      (1 - overlap.corrToPortfolio) * 100,
      portfolioContext.largestHolding && seed.sector === portfolioContext.largestHolding.security.sector ? 28 : 82,
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

  const signalFamilies = [
    ...baseSignalFamilies,
    summarizeSignalFamily('Portfolio context', [
      {
        label: 'Portfolio fit',
        value: portfolioFit.score,
        weight: 0.18,
        series: universe.map((security) =>
          average([
            security.metrics.beta * 20,
            security.factors.defensive * 100,
            security.factors.cyclical * 100,
          ]),
        ),
      },
    ]),
  ];

  const correlatedPairs = signalFamilies.flatMap((family) =>
    family.correlatedPairs.map((pair) => {
      const correlation = Number(pair.match(/\(([-\d.]+)\)$/)?.[1] ?? 0);
      return {
        family: family.family,
        pair: pair.replace(/\s*\([^)]+\)$/, ''),
        correlation,
      };
    }),
  );
  const priceSignalCrowding = crowdingScore([momentum, trend, pullback, persistence, volatilityWindow]);
  const fragilityCrowding = crowdingScore([
    financialStress,
    cashBurnDilution,
    eventSensitivity,
    marginFragility,
    tailRisk,
    valuationVulnerability,
  ]);
  const averageCorrelationPenalty =
    correlatedPairs.length > 0
      ? average(correlatedPairs.map((pair) => Math.max(Math.abs(pair.correlation) - 0.78, 0)))
      : 0;
  const signalAudit: SignalAudit = {
    redundancyPenalty: round(
      clamp(
        Math.max(priceSignalCrowding - 24, 0) * 0.12 +
          Math.max(fragilityCrowding - 30, 0) * 0.08 +
          averageCorrelationPenalty * 12,
        0,
        8.5,
      ),
      1,
    ),
    priceSignalCrowding,
    fragilityCrowding,
    families: signalFamilies,
    correlatedPairs,
    notes: [
      ...(priceSignalCrowding >= 30
        ? ['Several timing and momentum inputs are telling the same price-behavior story, so confidence is trimmed to avoid double counting.']
        : []),
      ...(fragilityCrowding >= 36
        ? ['Multiple fragility inputs are moving together, so risk is treated as a cluster rather than independent warnings.']
        : []),
      ...(correlatedPairs.length > 0
        ? [`Highly correlated signal pairs detected: ${correlatedPairs
            .slice(0, 3)
            .map((pair) => `${pair.pair} in ${pair.family}`)
            .join('; ')}.`]
        : []),
    ],
  };

  const dataQuality = assessDataQuality(dataset, seed);
  const businessQuality = round(average([growth, quality, balanceSheet, support]));
  const entryQuality = round(average([valuation, momentum, timing.score]));
  const dataReliabilityScore = round(
    clamp(
      average([
        dataQuality.score,
        seed.metrics.liquidityScore,
        100 - Math.min(dataQuality.fundamentalsFreshnessDays, 120) * 0.6,
      ]),
      0,
      100,
    ),
  );

  const priceFreshForConfidence = dataQuality.priceFreshnessDays <= 3;
  const fundamentalsStaleForConfidence = dataQuality.fundamentalsFreshnessDays > 45;
  const leanOnMarketData = priceFreshForConfidence && fundamentalsStaleForConfidence;

  let confidence = 70;
  confidence -= seed.metrics.liquidityScore < 85 ? (85 - seed.metrics.liquidityScore) * 0.8 : 0;
  confidence -= seed.metrics.earningsDays < 14 ? 8 : 0;
  confidence -= seed.metrics.postEarningsGap > 0.08 ? 6 : 0;
  confidence -= Math.abs(opportunity.score - timing.score) > 18 ? 5 : 0;
  confidence -= Math.abs(opportunity.score - portfolioFit.score) > 20 ? 4 : 0;
  confidence -= (100 - dataQuality.score) * (leanOnMarketData ? 0.09 : 0.18);
  confidence -= (100 - dataReliabilityScore) * 0.06;
  confidence -= signalAudit.redundancyPenalty * 1.4;
  confidence += seed.marketCapBucket === 'mega' ? 4 : 0;
  confidence += seed.metrics.fcfConsistency > 80 ? 3 : 0;
  if (leanOnMarketData) {
    confidence += Math.min(timing.score / 12, 5);
  }
  const sectorContextEntry = dataset.sectorContext?.find((e) => e.sector === seed.sector);
  if (sectorContextEntry) {
    const headwind = sectorContextEntry.headwind ?? 0;
    const tailwind = sectorContextEntry.tailwind ?? 0;
    confidence += round((tailwind - headwind) * 0.03);
  }

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

  let overallRisk = round(
    marketRisk * 0.25 +
      eventRisk * 0.15 +
      businessRisk * 0.25 +
      valuationRisk * 0.1 +
      portfolioContribution * 0.25,
  );
  if (sectorContextEntry) {
    const headwind = sectorContextEntry.headwind ?? 0;
    const tailwind = sectorContextEntry.tailwind ?? 0;
    overallRisk = round(clamp(overallRisk + (headwind - tailwind) * 0.04, 0, 100));
  }

  const macroAlignment = macroAlignmentScore({
    regime,
    seed,
    quality,
    balanceSheet,
    growth,
    momentum,
    marketRisk,
    businessRisk,
  });
  const strategyAlignment = strategyAlignmentScore({
    strategyWeights: dataset.user.strategyWeights,
    seed,
    growth,
    quality,
    valuation,
    momentum,
    support,
    balanceSheet,
    businessQuality,
    timingScore: timing.score,
    portfolioFitScore: portfolioFit.score,
    overallRisk,
    marketRisk,
    valuationRisk,
  });

  confidence += round((macroAlignment - 50) * 0.08);
  confidence += round((strategyAlignment - 50) * 0.04);
  const provisionalConfidenceBand = confidenceBand(
    clamp(confidence, 22, 95),
    dataQuality.score,
    preliminaryRisk,
  );
  confidence += confidenceCalibrationAdjustment(dataset, provisionalConfidenceBand);
  confidence = round(clamp(confidence, 22, 95));

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
      regimeBonus * 0.18 +
      ((strategyAlignment - 50) / 50) * 0.08 +
      ((macroAlignment - 50) / 50) * 0.06,
      -1,
      1,
    ),
  );

  composite = Math.max(0, composite - signalAudit.redundancyPenalty * 0.35);

  if (dataset.user.excludedSectors.includes(seed.sector)) {
    composite = Math.min(composite, 38);
  }
  if (dataset.user.avoidCashBurners && seed.metrics.fcfMargin < 0) {
    composite = Math.min(composite, 49);
  }

  const decileBase12 = average([
    decileReturnLookup(opportunity.score),
    decileReturnLookup(composite),
    decileReturnLookup(businessQuality),
  ]);
  const base12 = clamp(
    decileBase12 * 0.45 +
      (0.06 +
        0.14 * opp -
        0.12 * frag +
        0.06 * time +
        0.05 * fit +
        0.03 * conf +
        regime.deploymentTilt * 0.03) *
        0.55,
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

  const freshness = buildFreshnessBreakdown(dataset, seed, dataQuality);
  const recommendationPreviousComposite =
    seed.scoreHistory[seed.scoreHistory.length - 1] ?? round(composite);
  const recommendationPreviousRisk = seed.previousRisk ?? overallRisk;
  const recommendationPreviousDownside = seed.previousDownside ?? risk.expectedDownside;
  const excessiveSector = sectorWeightAfter > dataset.user.maxSectorWeight;
  const excessiveSingle =
    currentWeight > dataset.user.maxSinglePositionWeight ||
    (currentWeight === 0 && testWeight > dataset.user.maxSinglePositionWeight);
  const previousAction = classifyAction({
    isHeld,
    excludedSector: dataset.user.excludedSectors.includes(seed.sector),
    avoidEarningsRisk: dataset.user.avoidEarningsRisk,
    earningsDays: seed.metrics.earningsDays,
    businessQuality,
    entryQuality,
    opportunityScore: opportunity.score,
    portfolioFitScore: portfolioFit.score,
    timingScore: timing.score,
    overallRisk: recommendationPreviousRisk,
    confidence: Math.max(confidence - 2, 0),
    composite: recommendationPreviousComposite,
    expected12m: expectedReturns[2].expected,
    excessiveSingle,
    excessiveSector,
    regimeTilt: regime.deploymentTilt,
    dataQualityScore: dataQuality.score,
  });
  const compositeDelta = round(composite - recommendationPreviousComposite, 1);
  const riskDelta = round(overallRisk - recommendationPreviousRisk, 1);
  const downsideDelta = round(risk.expectedDownside - recommendationPreviousDownside, 3);

  let action = classifyAction({
    isHeld,
    excludedSector: dataset.user.excludedSectors.includes(seed.sector),
    avoidEarningsRisk: dataset.user.avoidEarningsRisk,
    earningsDays: seed.metrics.earningsDays,
    businessQuality,
    entryQuality,
    opportunityScore: opportunity.score,
    portfolioFitScore: portfolioFit.score,
    timingScore: timing.score,
    overallRisk,
    confidence,
    composite,
    expected12m: expectedReturns[2].expected,
    excessiveSingle,
    excessiveSector,
    regimeTilt: regime.deploymentTilt,
    dataQualityScore: dataQuality.score,
  });

  if (
    !isHeld &&
    seed.metrics.earningsDays > 0 &&
    seed.metrics.earningsDays <= 7 &&
    ['Buy now', 'Buy partial', 'Accumulate slowly'].includes(action)
  ) {
    action = 'Reassess after earnings';
  }

  action = applyActionHysteresis({
    action,
    previousAction,
    compositeDelta,
    riskDelta,
    hardLocked:
      dataset.user.excludedSectors.includes(seed.sector) ||
      (dataset.user.avoidEarningsRisk && seed.metrics.earningsDays < 14) ||
      (isHeld && (excessiveSingle || excessiveSector)),
  });

  const currentConfidenceBand = confidenceBand(confidence, dataQuality.score, overallRisk);

  if (!isHeld && currentConfidenceBand === 'Low confidence') {
    action = downgradeBuyAction(downgradeBuyAction(action));
  } else if (!isHeld && currentConfidenceBand === 'Medium confidence') {
    action = downgradeBuyAction(action);
  }

  const maxWeight = round(
    Math.min(
      dataset.user.maxSinglePositionWeight,
      dataset.user.maxSinglePositionWeight * risk.sizeCapMultiplier,
      Math.max(dataset.user.maxSectorWeight - currentSectorWeight / 100, 0.01),
    ),
    3,
  );

  const isExitAction = ['Trim', 'Sell', 'Rotate', 'De-risk', 'Take profit'].includes(action);

  const actionBaseWeight =
    action === 'Buy now'
      ? 0.07
      : action === 'Buy partial'
        ? 0.045
        : action === 'Accumulate slowly'
          ? 0.032
          : action === 'High-upside / high-risk only'
            ? 0.018
            : action === 'Take profit'
              ? Math.max(currentWeight * 0.45, 0.03)
              : action === 'Trim' || action === 'Rotate' || action === 'De-risk'
                ? Math.max(dataset.user.maxSinglePositionWeight * risk.sizeCapMultiplier, 0.04)
              : 0;

  const suggestedWeight = round(
    action === 'Sell'
      ? 0
      : clamp(
          Math.min(actionBaseWeight * (0.8 + confidence / 200), maxWeight),
          0,
          isHeld ? currentWeight : maxWeight,
        ),
    3,
  );

  const suggestedDollars = round(
    isHeld && isExitAction
      ? Math.max((currentWeight - suggestedWeight) * portfolioContext.portfolioValue, 0)
      : suggestedWeight * portfolioContext.portfolioValue,
    0,
  );
  const suggestedWeightRange =
    action === 'Sell'
      ? ([0, 0] as [number, number])
      : suggestedRangeMidpoint(
          suggestedWeight,
          risk.expectedDownside,
          isHeld ? currentWeight : maxWeight,
        );
  const suggestedDollarRange = [
    round(suggestedWeightRange[0] * portfolioContext.portfolioValue, 0),
    round(suggestedWeightRange[1] * portfolioContext.portfolioValue, 0),
  ] as [number, number];

  const entryStyle =
    action === 'Buy now' && overallRisk < 52
      ? 'Single entry'
      : action === 'Buy partial' || action === 'Accumulate slowly'
        ? 'Two tranches'
        : action === 'High-upside / high-risk only'
          ? 'Three tranches'
          : action === 'Reassess after earnings'
            ? 'Wait for event'
            : isHeld && (action === 'Trim' || action === 'De-risk')
              ? 'Reduce over 2 sessions'
              : isHeld && action === 'Take profit'
                ? 'Scale out in tranches'
                : isHeld && action === 'Rotate'
                  ? 'Swap over 2 sessions'
                  : isHeld && action === 'Sell'
                    ? 'Exit over 1-2 sessions'
              : 'No trade';

  const allocation: AllocationSuggestion = {
    suggestedWeight,
    suggestedDollars,
    suggestedWeightRange,
    suggestedDollarRange,
    maxWeight,
    entryStyle,
    reserveAfterTrade: round(
      Math.max(
        dataset.user.targetCashReserve,
        dataset.user.investableCash - (isHeld && isExitAction ? 0 : suggestedDollars),
      ),
      0,
    ),
    reasoning:
      action === 'Trim'
        ? 'Position exceeds the current concentration or risk budget and should be reduced toward a compliant size.'
        : action === 'Buy now' || action === 'Buy partial' || action === 'Accumulate slowly'
          ? 'Sizing is capped by portfolio constraints, sector room, and the stock\'s risk bucket rather than by upside alone.'
          : 'No capital is allocated because either fit, timing, or risk discipline is not strong enough.',
  };

  const fitImpact: FitImpact = {
    overlapScore: round(overlap.corrToPortfolio * 100),
    clusterOverlap: round(Math.max(overlap.corrToLargest, overlap.corrToPortfolio) * 100),
    concentrationDelta: round((sectorWeightAfter - currentSectorWeight / 100) * 100, 1),
    sectorWeightAfter: round(sectorWeightAfter * 100, 1),
    diversificationDelta: round((diversification - 50) / 10, 1),
    portfolioVolDelta: round((overallRisk - 50) / 5, 1),
    marginalRiskContribution: round(testWeight * overallRisk, 1),
    marginalDrawdownImpact: round(testWeight * risk.expectedDownside * 100, 2),
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

  const currentThesisHealth = thesisHealth({
    action,
    businessQuality,
    compositeDelta,
    riskDelta,
    downsideDelta,
  });
  const thesis = thesisSummaryForScorecard(
    seed.symbol,
    driverPool,
    penaltyPool,
    thesisHealthScore(currentThesisHealth, businessQuality, downsideDelta),
  );

  let sellDiscipline: SellDiscipline | undefined;
  if (isHeld && action === 'Trim') {
    if (composite <= 48 && businessQuality < 52) {
      sellDiscipline = 'Thesis broken';
    } else if (excessiveSingle || excessiveSector) {
      sellDiscipline = 'Portfolio concentration issue';
    } else if (valuationRisk >= 78 && expectedReturns[2].base <= 0.06) {
      sellDiscipline = 'Valuation too stretched';
    } else if (riskDelta >= 6 || overallRisk >= 68) {
      sellDiscipline = 'Risk increased too much';
    } else if (dataset.user.avoidEarningsRisk && seed.metrics.earningsDays < 10 && overallRisk >= 58) {
      sellDiscipline = 'Event risk no longer worth it';
    } else {
      sellDiscipline = 'Upside mostly realized';
    }
  }

  const roleLabel =
    isExitAction
      ? 'Reduce exposure'
      : action === 'Hold'
        ? currentWeight >= dataset.user.maxSinglePositionWeight * 0.75
          ? 'Core position'
          : 'Supporting position'
        : action === 'High-upside / high-risk only'
          ? 'Tactical satellite'
          : portfolioFit.score >= 70
            ? 'Diversifier'
            : businessQuality >= 72
              ? 'Core compounder'
              : 'Selective growth sleeve';

  const decision: DecisionFrame = {
    why:
      isExitAction
        ? `The position no longer fits cleanly because ${sellDiscipline?.toLowerCase() ?? 'risk and concentration have worsened'}.`
        : `${driverPool[0]?.label ?? 'Composite quality'} is the main reason the system lands on ${action.toLowerCase()}.`,
    mainRisk:
      isExitAction
        ? penaltyPool[0]?.narrative ?? 'Risk or concentration has increased enough to justify reducing exposure.'
        : penaltyPool[0]?.narrative ?? 'No single penalty dominates, but risk control still matters.',
    suggestedRole:
      action === 'Avoid' || action === 'Not suitable for current portfolio'
        ? 'No portfolio role right now'
        : `${roleLabel}${!isHeld && suggestedWeight > 0 ? ` at up to ${round(suggestedWeight * 100, 1)}%` : ''}`,
    sizingDiscipline:
      action === 'Avoid' || action === 'Watch only' || action === 'Reassess after earnings'
        ? `${currentConfidenceBand}. Keep capital uncommitted until fit, timing, and confidence improve.`
        : action === 'Sell'
          ? `${currentConfidenceBand}. Exit the position; the model no longer sees a compensated reason to hold it.`
          : action === 'Rotate'
            ? `${currentConfidenceBand}. Rotate gradually into a stronger candidate or hold cash if the replacement does not clear execution checks.`
            : action === 'De-risk' || action === 'Trim'
              ? `${currentConfidenceBand}. Reduce toward ${round(suggestedWeightRange[0] * 100, 1)}-${round(
                  suggestedWeightRange[1] * 100,
                  1,
                )}% or hold cash if no cleaner replacement is available.`
              : action === 'Take profit'
                ? `${currentConfidenceBand}. Harvest gains in stages; the model sees less reward cushion than before.`
          : `${currentConfidenceBand}. Suggested size range is ${round(
              suggestedWeightRange[0] * 100,
              1,
            )}-${round(suggestedWeightRange[1] * 100, 1)}% ($${Math.round(
              suggestedDollarRange[0],
            ).toLocaleString('en-US')}-$${Math.round(suggestedDollarRange[1]).toLocaleString(
              'en-US',
            )}) via ${entryStyle.toLowerCase()}.`,
  };

  const recommendationChange: RecommendationChange = {
    previousComposite: round(recommendationPreviousComposite),
    compositeDelta,
    previousRisk: round(recommendationPreviousRisk),
    riskDelta,
    previousDownside: round(recommendationPreviousDownside * 100, 1),
    downsideDelta: round(downsideDelta * 100, 1),
    previousAction,
    actionChanged: previousAction !== action,
    summary:
      previousAction !== action
        ? `Action moved from ${previousAction} to ${action} since the prior snapshot.`
        : `Action stays at ${action}; the latest change was not large enough to justify a new label.`,
    factorMoves: [
      `Composite ${compositeDelta >= 0 ? 'improved' : 'fell'} by ${Math.abs(compositeDelta)} point${
        Math.abs(compositeDelta) === 1 ? '' : 's'
      } versus the prior snapshot.`,
      `Risk ${riskDelta >= 0 ? 'rose' : 'fell'} by ${Math.abs(riskDelta)} point${
        Math.abs(riskDelta) === 1 ? '' : 's'
      }; expected downside is now ${round(risk.expectedDownside * 100, 1)}%.`,
      `Current key driver is ${driverPool[0]?.label?.toLowerCase() ?? 'score balance'} while the main blocker is ${
        penaltyPool[0]?.label?.toLowerCase() ?? 'risk discipline'
      }.`,
    ],
  };

  const explanation: Explainability = {
    summary: `${seed.symbol} lands at ${round(composite)} composite with ${action}. ${decision.why} Opportunity is ${round(
      opportunity.score,
    )}, fragility is ${round(fragility.score)}, portfolio fit is ${round(
      portfolioFit.score,
    )}, business quality is ${businessQuality}, entry quality is ${entryQuality}, data quality is ${dataQuality.score}, reliability is ${dataReliabilityScore}, macro fit is ${macroAlignment}, and confidence is ${confidence}.`,
    topDrivers: driverPool,
    topPenalties: penaltyPool,
    riskNotes: [
      `Market risk ${marketRisk}/100, event risk ${eventRisk}/100, business risk ${businessRisk}/100.`,
      `Expected downside is roughly ${round(risk.expectedDownside * 100, 1)}% in a stressed scenario.`,
    ],
    fitNotes: [
      `Estimated portfolio overlap is ${fitImpact.overlapScore}/100.`,
      `Sector weight would be ${fitImpact.sectorWeightAfter}% after a fresh add.`,
      `Cluster overlap is ${fitImpact.clusterOverlap}/100 with marginal risk contribution around ${fitImpact.marginalRiskContribution}.`,
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
      `Data quality score is ${dataQuality.score}/100.`,
      `Fundamentals last updated ${seed.fundamentalsLastUpdated}.`,
      seed.metrics.liquidityScore >= 85
        ? 'Liquidity is strong; confidence is not being penalized materially for execution risk.'
        : 'Liquidity is lower than ideal, so confidence and sizing are capped.',
      ...dataQuality.notes,
      ...signalAudit.notes,
    ],
    changeTriggers: [
      'A lower fragility score or wider sector room would improve the recommendation.',
      'Deteriorating revisions, weaker cash conversion, or a worse regime would lower the action.',
    ],
  };

  return {
    symbol: seed.symbol,
    businessQuality,
    entryQuality,
    opportunity,
    fragility,
    timing,
    portfolioFit,
    confidence,
    confidenceBand: currentConfidenceBand,
    dataQualityScore: dataQuality.score,
    dataReliabilityScore,
    macroAlignmentScore: macroAlignment,
    composite: round(composite),
    risk,
    expectedReturns,
    action,
    thesisHealth: currentThesisHealth,
    thesis,
    sellDiscipline,
    replacementIdea: undefined,
    decision,
    freshness,
    recommendationChange,
    signalAudit,
    fitImpact,
    allocation,
    explanation,
  } satisfies ScoreCard;
}

function replacementCandidateForHolding(
  dataset: MockDataset,
  current: ScoreCard,
  scorecards: ScoreCard[],
) {
  const heldSymbols = new Set(dataset.holdings.map((holding) => holding.symbol));

  const candidates = scorecards
    .filter(
      (candidate) =>
        candidate.symbol !== current.symbol &&
        !heldSymbols.has(candidate.symbol) &&
        ['Buy now', 'Buy partial', 'Accumulate slowly'].includes(candidate.action) &&
        candidate.confidenceBand !== 'Low confidence' &&
        candidate.dataQualityScore >= 58,
    )
    .sort((left, right) => {
      const leftEdge =
        left.composite + left.portfolioFit.score * 0.32 + left.expectedReturns[2].base * 100 - left.risk.overall * 0.22;
      const rightEdge =
        right.composite + right.portfolioFit.score * 0.32 + right.expectedReturns[2].base * 100 - right.risk.overall * 0.22;
      return rightEdge - leftEdge;
    });

  const winner = candidates[0];

  if (!winner) {
    return null;
  }

  const improvement =
    winner.composite -
    current.composite +
    (winner.portfolioFit.score - current.portfolioFit.score) * 0.4 +
    (winner.expectedReturns[2].base - current.expectedReturns[2].base) * 100 * 0.6;

  if (improvement < 8) {
    return null;
  }

  return winner;
}

function finalizeHeldRecommendationActions(
  dataset: MockDataset,
  scorecards: ScoreCard[],
) {
  const heldSymbols = new Set(dataset.holdings.map((holding) => holding.symbol));

  return scorecards.map((scorecard) => {
    if (!heldSymbols.has(scorecard.symbol) || scorecard.action !== 'Trim') {
      return scorecard;
    }

    const replacementCandidate = replacementCandidateForHolding(dataset, scorecard, scorecards);
    const replacementIdea = replacementCandidate
      ? `Rotate toward ${replacementCandidate.symbol}; it offers better fit and expected return for the current portfolio.`
      : undefined;

    let nextAction: ActionLabel = scorecard.action;
    if (replacementCandidate) {
      nextAction = 'Rotate';
    } else if (scorecard.sellDiscipline === 'Thesis broken') {
      nextAction = 'Sell';
    } else if (scorecard.sellDiscipline === 'Risk increased too much') {
      nextAction = 'De-risk';
    } else if (
      scorecard.sellDiscipline === 'Valuation too stretched' ||
      scorecard.sellDiscipline === 'Upside mostly realized'
    ) {
      nextAction = 'Take profit';
    } else if (scorecard.sellDiscipline === 'Event risk no longer worth it') {
      nextAction = 'Reassess after earnings';
    }

    const nextDecision: DecisionFrame = {
      ...scorecard.decision,
      why:
        nextAction === 'Rotate'
          ? replacementIdea ?? scorecard.decision.why
          : scorecard.sellDiscipline
            ? `${scorecard.sellDiscipline} is the dominant reason the system no longer wants full exposure.`
            : scorecard.decision.why,
      suggestedRole:
        nextAction === 'Sell'
          ? 'Exit the position'
          : nextAction === 'Rotate'
            ? 'Replace with a stronger candidate'
            : nextAction === 'De-risk'
              ? 'Reduce to a lower-risk weight'
              : nextAction === 'Take profit'
                ? 'Harvest gains and free cash'
                : scorecard.decision.suggestedRole,
      sizingDiscipline:
        nextAction === 'Sell'
          ? 'Low confidence. Exit rather than carrying thesis risk forward.'
          : nextAction === 'Rotate'
            ? 'Shift capital gradually into the replacement name unless cash is the cleaner choice.'
            : nextAction === 'De-risk'
              ? 'Cut size toward the lower end of the suggested range until portfolio risk normalizes.'
              : nextAction === 'Take profit'
                ? 'Lock in part of the gain; future upside no longer justifies full size.'
                : scorecard.decision.sizingDiscipline,
    };

    const nextChange = {
      ...scorecard.recommendationChange,
      actionChanged: scorecard.recommendationChange.previousAction !== nextAction,
      summary:
        scorecard.recommendationChange.previousAction !== nextAction
          ? `Action moved from ${scorecard.recommendationChange.previousAction} to ${nextAction} since the prior snapshot.`
          : scorecard.recommendationChange.summary,
    };

    return {
      ...scorecard,
      action: nextAction,
      replacementIdea,
      decision: nextDecision,
      recommendationChange: nextChange,
      explanation: {
        ...scorecard.explanation,
        summary: `${scorecard.symbol} lands at ${round(scorecard.composite)} composite with ${nextAction}. ${nextDecision.why}`,
      },
    };
  });
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

    const replacementCandidate = replacementCandidateForHolding(dataset, scorecard, scorecards);
    const replacementIdea =
      ['Trim', 'Rotate', 'Sell', 'De-risk', 'Take profit'].includes(scorecard.action)
        ? replacementCandidate
          ? `${scorecard.action} and consider ${replacementCandidate.symbol} instead; it offers better fit and expected return for the current portfolio.`
          : `${scorecard.action} and let cash absorb the reduction until a cleaner replacement is available.`
        : undefined;

    return {
      symbol: entry.security.symbol,
      shares: entry.holding.shares,
      costBasis: round(entry.holding.costBasis, 2),
      marketValue: round(entry.marketValue, 0),
      unrealizedPnl: round((entry.security.price - entry.holding.costBasis) * entry.holding.shares, 0),
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
      thesisHealth: scorecard.thesisHealth,
      confidenceBand: scorecard.confidenceBand,
      sellDiscipline:
        scorecard.sellDiscipline ??
        (replacementIdea && scorecard.action === 'Rotate' ? 'Better replacement available' : undefined),
      replacementIdea: scorecard.replacementIdea ?? replacementIdea,
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

    if (scorecard.recommendationChange.actionChanged) {
      alerts.push({
        id: `${scorecard.symbol}-action`,
        symbol: scorecard.symbol,
        severity:
          actionRank(scorecard.action) < actionRank(scorecard.recommendationChange.previousAction)
            ? 'medium'
            : 'high',
        kind: 'Action change',
        message: scorecard.recommendationChange.summary,
        route: `/stocks/${scorecard.symbol}`,
      });
    } else if (Math.abs(compositeDelta) >= 5) {
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
    if (!scorecard.recommendationChange.actionChanged && Math.abs(riskDelta) >= 6) {
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
      (scorecard.dataQualityScore < 55 || scorecard.freshness.fundamentalsStatus === 'stale') &&
      (dataset.holdings.some((holding) => holding.symbol === scorecard.symbol) || actionRank(scorecard.action) <= 3)
    ) {
      alerts.push({
        id: `${scorecard.symbol}-freshness`,
        symbol: scorecard.symbol,
        severity: 'medium',
        kind: 'Data freshness',
        message: `${scorecard.symbol} relies on ${scorecard.freshness.fundamentalsStatus} fundamentals or thin coverage, so conviction is capped.`,
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

    if (scorecard.risk.market >= 72 || security.metrics.crashFrequency >= 0.14 || security.metrics.tailLoss >= 0.12) {
      alerts.push({
        id: `${scorecard.symbol}-tail`,
        symbol: scorecard.symbol,
        severity: 'high',
        kind: 'Tail risk',
        message: `${scorecard.symbol} has elevated left-tail behavior or volatility clustering that can overwhelm a normal position size.`,
        route: `/stocks/${scorecard.symbol}`,
      });
    }

    if (scorecard.risk.business >= 70) {
      alerts.push({
        id: `${scorecard.symbol}-balance-sheet`,
        symbol: scorecard.symbol,
        severity: 'high',
        kind: 'Balance-sheet stress',
        message: `${scorecard.symbol} is carrying enough business or financing fragility that a small thesis break could turn into a larger drawdown.`,
        route: `/stocks/${scorecard.symbol}`,
      });
    }

    if (scorecard.risk.event >= 70) {
      alerts.push({
        id: `${scorecard.symbol}-binary`,
        symbol: scorecard.symbol,
        severity: 'medium',
        kind: 'Binary event risk',
        message: `${scorecard.symbol} is unusually exposed to event-driven moves right now.`,
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

  const severityRank = { high: 0, medium: 1, low: 2 } satisfies Record<AlertItem['severity'], number>;

  return alerts
    .sort((left, right) => {
      const severityGap = severityRank[left.severity] - severityRank[right.severity];
      if (severityGap !== 0) {
        return severityGap;
      }

      return left.kind.localeCompare(right.kind);
    })
    .slice(0, 12);
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

function buildWatchlistSignals(dataset: MockDataset, scorecards: ScoreCard[]) {
  const scorecardBySymbol = new Map(scorecards.map((card) => [card.symbol, card]));
  const securityBySymbol = new Map(dataset.securities.map((security) => [security.symbol, security]));
  const heldSymbols = new Set(dataset.holdings.map((holding) => holding.symbol));
  const signals: WatchlistSignal[] = [];

  dataset.watchlists.forEach((watchlist) => {
    watchlist.symbols.forEach((symbol) => {
      const scorecard = scorecardBySymbol.get(symbol);
      const security = securityBySymbol.get(symbol);

      if (!scorecard || !security) {
        return;
      }

      if (
        !heldSymbols.has(symbol) &&
        ['Buy now', 'Buy partial', 'Accumulate slowly'].includes(scorecard.action) &&
        scorecard.composite >= 60
      ) {
        signals.push({
          id: `${watchlist.id}-${symbol}-opportunity`,
          watchlist: watchlist.name,
          symbol,
          kind: 'Opportunity appearing',
          message: `${symbol} is starting to look more attractive for this portfolio.`,
          severity: scorecard.action === 'Buy now' ? 'high' : 'medium',
          route: `/stocks/${symbol}`,
        });
      }

      if (
        ['Avoid', 'Sell', 'Rotate', 'De-risk', 'Take profit'].includes(scorecard.action) ||
        scorecard.risk.overall >= 68 ||
        scorecard.thesisHealth === 'Broken'
      ) {
        signals.push({
          id: `${watchlist.id}-${symbol}-risk`,
          watchlist: watchlist.name,
          symbol,
          kind: 'Risk increasing',
          message: `${symbol} is carrying more risk or a weaker case than before.`,
          severity: scorecard.risk.overall >= 74 || scorecard.thesisHealth === 'Broken' ? 'high' : 'medium',
          route: `/stocks/${symbol}`,
        });
      }

      if (security.metrics.earningsDays > 0 && security.metrics.earningsDays <= 14) {
        signals.push({
          id: `${watchlist.id}-${symbol}-earnings`,
          watchlist: watchlist.name,
          symbol,
          kind: 'Earnings approaching',
          message: `${symbol} reports earnings in about ${security.metrics.earningsDays} day${
            security.metrics.earningsDays === 1 ? '' : 's'
          }.`,
          severity: security.metrics.earningsDays <= 7 ? 'high' : 'medium',
          route: `/stocks/${symbol}`,
        });
      }
    });
  });

  const severityRank = { high: 0, medium: 1, low: 2 } satisfies Record<WatchlistSignal['severity'], number>;
  return signals
    .sort((left, right) => {
      const severityGap = severityRank[left.severity] - severityRank[right.severity];
      if (severityGap !== 0) {
        return severityGap;
      }

      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, 16);
}

function buildPortfolioFragility(
  dataset: MockDataset,
  holdings: HoldingAnalysis[],
  scorecards: ScoreCard[],
  portfolioContext: ReturnType<typeof buildPortfolioContext>,
  concentrationIssues: string[],
): PortfolioFragilityAnalysis {
  const scorecardBySymbol = new Map(scorecards.map((card) => [card.symbol, card]));
  const securityBySymbol = new Map(dataset.securities.map((security) => [security.symbol, security]));
  const themeWeights = new Map<string, number>();

  holdings.forEach((holding) => {
    const security = securityBySymbol.get(holding.symbol);

    if (!security) {
      return;
    }

    const themes = themeExposureLabels(security);
    if (themes.length === 0) {
      return;
    }

    const perThemeWeight = holding.weight / themes.length;
    themes.forEach((theme) => {
      themeWeights.set(theme, round((themeWeights.get(theme) ?? 0) + perThemeWeight, 1));
    });
  });

  const hiddenExposureThemes = [...themeWeights.entries()]
    .filter(([, weight]) => weight >= 18)
    .sort((left, right) => right[1] - left[1])
    .map(([theme, weight]) => `${theme} (${round(weight, 1)}%)`);

  const largestHoldingWeight = Math.max(0, ...holdings.map((holding) => holding.weight));
  const largestSectorWeight = Math.max(0, ...portfolioContext.sectorExposure.map((entry) => entry.weight));
  const averageClusterOverlap =
    holdings.length > 0
      ? average(
          holdings.map((holding) => scorecardBySymbol.get(holding.symbol)?.fitImpact.clusterOverlap ?? 0),
        )
      : 0;
  const averageHoldingRisk =
    holdings.length > 0
      ? average(holdings.map((holding) => scorecardBySymbol.get(holding.symbol)?.risk.overall ?? 0))
      : 0;

  const concentrationFlags = [...concentrationIssues];
  if (largestHoldingWeight >= 18) {
    const name = holdings.find((holding) => holding.weight === largestHoldingWeight)?.symbol;
    if (name) {
      concentrationFlags.push(`${name} is taking up a large share of the portfolio.`);
    }
  }
  if (largestSectorWeight >= 28) {
    const sector = portfolioContext.sectorExposure.find((entry) => entry.weight === largestSectorWeight)?.sector;
    if (sector) {
      concentrationFlags.push(`${sector} is doing too much of the work in this portfolio.`);
    }
  }
  hiddenExposureThemes.slice(0, 2).forEach((theme) => {
    concentrationFlags.push(`Hidden theme overlap is building around ${theme.toLowerCase()}.`);
  });

  return {
    fragilityScore: round(
      clamp(
        average([
          largestHoldingWeight * 3.2,
          largestSectorWeight * 2,
          averageClusterOverlap,
          averageHoldingRisk,
        ]),
        0,
        100,
      ),
    ),
    concentrationFlags: concentrationFlags.slice(0, 6),
    hiddenExposureThemes,
  };
}

type StressScenarioDefinition = {
  scenario: string;
  description: string;
  shocks: Record<string, number>;
};

const stressScenarioDefinitions: StressScenarioDefinition[] = [
  {
    scenario: 'AI spending slowdown',
    description: 'A slowdown in AI infrastructure spending hits semis, networking, and related software harder than the rest of the market.',
    shocks: {
      'AI infrastructure': -0.18,
      'High-growth tech': -0.12,
      Technology: -0.09,
      'Economic cycle risk': -0.06,
    },
  },
  {
    scenario: 'Interest rates rising',
    description: 'Higher rates pressure long-duration growth and rate-sensitive groups.',
    shocks: {
      'Interest-rate sensitive': -0.14,
      'High-growth tech': -0.1,
      Technology: -0.08,
      'Defensive shelter': -0.03,
    },
  },
  {
    scenario: 'Oil shock',
    description: 'Energy prices spike, hurting transport, consumers, and rate-sensitive areas while helping energy exposure.',
    shocks: {
      'Energy prices': 0.08,
      'Consumer spending': -0.1,
      Industrials: -0.08,
      Energy: 0.08,
    },
  },
  {
    scenario: 'Tech correction',
    description: 'Large-cap tech and crowded growth unwind quickly across related names.',
    shocks: {
      'High-growth tech': -0.16,
      'AI infrastructure': -0.2,
      Technology: -0.14,
      'Defensive shelter': -0.04,
    },
  },
];

function securityScenarioShock(security: SecuritySeed, shocks: Record<string, number>) {
  let shock = shocks[security.sector] ?? 0;
  themeExposureLabels(security).forEach((theme) => {
    shock += shocks[theme] ?? 0;
  });

  return clamp(shock, -0.28, 0.12);
}

function buildStressTests(
  dataset: MockDataset,
  holdings: HoldingAnalysis[],
): StressScenarioResult[] {
  const securityBySymbol = new Map(dataset.securities.map((security) => [security.symbol, security]));
  const portfolioValue = Math.max(sum(holdings.map((holding) => holding.marketValue)), 1);

  return stressScenarioDefinitions.map((definition) => {
    const impacts = holdings
      .map((holding) => {
        const security = securityBySymbol.get(holding.symbol);
        if (!security) {
          return { symbol: holding.symbol, impact: 0 };
        }

        const shock = securityScenarioShock(security, definition.shocks);
        return {
          symbol: holding.symbol,
          impact: round(safeDivide(holding.marketValue * shock, portfolioValue) * 100, 1),
        };
      })
      .sort((left, right) => left.impact - right.impact);

    const drawdown = round(
      impacts.reduce((total, item) => total + Math.min(item.impact, 0), 0),
      1,
    );

    return {
      scenario: definition.scenario,
      description: definition.description,
      portfolioDrawdown: drawdown,
      topRiskContributors: impacts.filter((item) => item.impact < 0).slice(0, 3),
    };
  });
}

function buildOpportunityRadar(dataset: MockDataset, scorecards: ScoreCard[], regime: RegimeSnapshot) {
  const heldSymbols = new Set(dataset.holdings.map((holding) => holding.symbol));
  const securityBySymbol = new Map(dataset.securities.map((security) => [security.symbol, security]));
  const candidates: OpportunityRadarItem[] = [];

  scorecards.forEach((scorecard) => {
    if (heldSymbols.has(scorecard.symbol)) {
      return;
    }

    const security = securityBySymbol.get(scorecard.symbol);
    if (!security) {
      return;
    }

    const setups: Array<{ setup: string; score: number; explanation: string }> = [];

    if (scorecard.businessQuality >= 70 && security.metrics.ret1m < 0 && scorecard.timing.score >= 55) {
      setups.push({
        setup: 'Strong business, recent pullback',
        score: round(average([scorecard.businessQuality, scorecard.timing.score, scorecard.portfolioFit.score])),
        explanation: 'The company still looks solid, but the price has pulled back enough to be worth another look.',
      });
    }

    if (security.metrics.momentumAcceleration >= 4 && scorecard.timing.score >= 60) {
      setups.push({
        setup: 'Momentum picking up',
        score: round(average([scorecard.timing.score, scorecard.opportunity.score, scorecard.confidence])),
        explanation: 'Price strength is building without a major breakdown in quality or fit.',
      });
    }

    if (scorecard.opportunity.score >= 65 && scorecard.entryQuality >= 60 && scorecard.risk.overall <= 58) {
      setups.push({
        setup: 'Price looks more attractive than usual',
        score: round(average([scorecard.opportunity.score, scorecard.entryQuality, 100 - scorecard.risk.overall])),
        explanation: 'The reward looks better than the current risk for this stock.',
      });
    }

    if (regime.environment.includes('Risk-on') && scorecard.macroAlignmentScore >= 60 && scorecard.portfolioFit.score >= 58) {
      setups.push({
        setup: 'Fits the current market mood',
        score: round(average([scorecard.macroAlignmentScore, scorecard.portfolioFit.score, scorecard.confidence])),
        explanation: 'The current market environment is lining up well with this kind of setup.',
      });
    }

    const bestSetup = setups.sort((left, right) => right.score - left.score)[0];

    if (bestSetup) {
      candidates.push({
        symbol: scorecard.symbol,
        setup: bestSetup.setup,
        score: bestSetup.score,
        explanation: bestSetup.explanation,
      });
    }
  });

  return candidates.sort((left, right) => right.score - left.score).slice(0, 8);
}

function buildRiskBudget(
  dataset: MockDataset,
  holdings: HoldingAnalysis[],
  scorecards: ScoreCard[],
): RiskBudgetSummary {
  const scorecardBySymbol = new Map(scorecards.map((card) => [card.symbol, card]));
  const riskByHolding = holdings
    .map((holding) => ({
      symbol: holding.symbol,
      risk: round(scorecardBySymbol.get(holding.symbol)?.risk.overall ?? 0, 1),
    }))
    .sort((left, right) => right.risk - left.risk);
  const riskBudgetTotal = round(clamp(dataset.user.maxPortfolioDrawdownTolerance * 350, 35, 100), 1);
  const riskUsed = round(sum(holdings.map((holding) => holding.riskContribution)), 1);

  return {
    riskBudgetTotal,
    riskUsed,
    riskByHolding,
    warning:
      riskUsed > riskBudgetTotal
        ? 'Portfolio risk is above your current budget.'
        : riskUsed > riskBudgetTotal * 0.85
          ? 'Portfolio risk is getting close to the limit.'
          : undefined,
  };
}

function buildPortfolioIQ(
  holdings: HoldingAnalysis[],
  scorecards: ScoreCard[],
  diversificationScore: number,
  averageRisk: number,
): PortfolioIQSummary {
  const scorecardBySymbol = new Map(scorecards.map((card) => [card.symbol, card]));
  const averageBusinessQuality =
    holdings.length > 0
      ? average(holdings.map((holding) => scorecardBySymbol.get(holding.symbol)?.businessQuality ?? 0))
      : 0;
  const averageValuationRoom =
    holdings.length > 0
      ? average(holdings.map((holding) => 100 - (scorecardBySymbol.get(holding.symbol)?.risk.valuation ?? 0)))
      : 0;
  const score = round(
    clamp(
      average([diversificationScore, 100 - averageRisk, averageBusinessQuality, averageValuationRoom]),
      0,
      100,
    ),
  );

  return {
    score,
    summary:
      score >= 75
        ? 'Your portfolio looks balanced and fairly disciplined.'
        : score >= 60
          ? 'Your portfolio is in decent shape, but a few areas need work.'
          : 'Your portfolio is carrying more concentration or risk than ideal.',
    drivers: [
      `Spread out score: ${diversificationScore}/100.`,
      `Average risk load: ${round(averageRisk, 1)}/100.`,
      `Business quality across holdings: ${round(averageBusinessQuality, 1)}/100.`,
      `Price discipline across holdings: ${round(averageValuationRoom, 1)}/100.`,
    ],
  };
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
        scorecard.dataQualityScore >= 52 &&
        scorecard.confidenceBand !== 'Low confidence' &&
        scorecard.portfolioFit.score >= priority.fitFloor &&
        scorecard.risk.overall <= priority.riskCap,
    )
    .sort((left, right) => right.composite - left.composite);

  const topSetQuality = average(candidatePool.slice(0, 3).map((item) => item.composite));
  const topSetDataQuality = average(candidatePool.slice(0, 3).map((item) => item.dataQualityScore));
  const topSetConfidence = average(candidatePool.slice(0, 3).map((item) => item.confidence));
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
      regime.deploymentTilt * 0.24 +
      (topSetQuality - 60) / 120 +
      (topSetDataQuality - 60) / 200 +
      (topSetConfidence - 62) / 260 +
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

  if (inputs.deploymentStyle === 'safe-starter') {
    deployFraction -= 0.16;
  }

  if (inputs.horizonMonths < 12) {
    deployFraction -= 0.08;
  }

  if (topSetDataQuality < 58) {
    deployFraction -= 0.07;
  }

  if (topSetConfidence < 62) {
    deployFraction -= 0.08;
  }

  if (regime.deploymentTilt < 0) {
    deployFraction -= 0.06;
  }

  deployFraction = clamp(
    deployFraction,
    inputs.deploymentStyle === 'safe-starter' ? 0.05 : 0.1,
    inputs.deploymentStyle === 'safe-starter' ? 0.45 : 0.78,
  );

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
        dollarRange: candidate.allocation.suggestedDollarRange,
        weightRange: candidate.allocation.suggestedWeightRange
          ? [
              round(candidate.allocation.suggestedWeightRange[0] * 100, 1),
              round(candidate.allocation.suggestedWeightRange[1] * 100, 1),
            ] as [number, number]
          : undefined,
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
    cashReserveSuggestion: holdBack,
    posture:
      candidatePool.length === 0
        ? 'Wait for better setups'
        : deployFraction >= 0.55
        ? 'Selective deployment'
        : deployFraction >= 0.35
          ? 'Measured deployment'
          : 'Capital preservation',
    expectedReturnEstimate:
      allocations.length > 0
        ? round(
            average(
              allocations.map((allocation) => {
                const candidate = candidatePool.find((item) => item.symbol === allocation.symbol);
                return candidate?.expectedReturns[2].base ?? 0;
              }),
            ),
            3,
          )
        : 0,
    riskEstimate:
      allocations.length > 0
        ? round(
            average(
              allocations.map((allocation) => {
                const candidate = candidatePool.find((item) => item.symbol === allocation.symbol);
                return candidate?.risk.overall ?? 0;
              }),
            ),
            1,
          )
        : 0,
    rationale: [
      ...(candidatePool.length === 0 ? ['No stocks currently meet the plan filters for fit, risk, and timing.'] : []),
      `Regime is ${regime.key.toLowerCase()}, so cash deployment is ${regime.deploymentTilt > 0 ? 'allowed' : 'restrained'}.`,
      `Priority mode is ${inputs.priority}; the engine filters for fit floor ${priority.fitFloor} and risk cap ${priority.riskCap}.`,
      `Top opportunity-set quality is ${round(topSetQuality)} composite.`,
      `Top candidate data quality is ${round(topSetDataQuality)} / 100.`,
      `Top candidate confidence is ${round(topSetConfidence)} / 100.`,
    ],
    allocations,
    avoids,
  } satisfies DeploymentPlan;
}

export function buildCommandCenterModel(dataset: MockDataset): CommandCenterModel {
  const regime = inferRegime(dataset);
  const portfolioContext = buildPortfolioContext(dataset);
  const ledgerSummary = buildLedgerSummary(dataset);
  const baseScorecards = dataset.securities.map((security) =>
    scoreSecurity(dataset, regime, portfolioContext, security),
  );
  const scorecards = finalizeHeldRecommendationActions(dataset, baseScorecards).sort(
    (left, right) => right.composite - left.composite,
  );
  const holdings = buildHoldingAnalysis(dataset, scorecards, portfolioContext);
  const alerts = buildAlerts(dataset, regime, scorecards, portfolioContext);
  const freshnessHierarchy = buildFreshnessHierarchy(dataset, scorecards);
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
  const averageRisk = round(average(holdings.map((holding) => holding.riskContribution)), 1);
  const watchlistSignals = buildWatchlistSignals(dataset, scorecards);
  const portfolioFragility = buildPortfolioFragility(
    dataset,
    holdings,
    scorecards,
    portfolioContext,
    concentrationIssues,
  );
  const stressTests = buildStressTests(dataset, holdings);
  const opportunityRadar = buildOpportunityRadar(dataset, scorecards, regime);
  const riskBudget = buildRiskBudget(dataset, holdings, scorecards);
  const portfolioIQ = buildPortfolioIQ(
    holdings,
    scorecards,
    diversificationScore,
    averageRisk,
  );

  return {
    dataset,
    regime,
    scorecards,
    holdings,
    ledgerSummary,
    alerts,
    watchlistMovers: buildWatchlistMovers(dataset),
    watchlistSignals,
    deploymentPlan,
    sectorExposure: portfolioContext.sectorExposure,
    factorExposure: Object.entries(portfolioContext.factorTotals).map(([factor, value]) => ({
      factor,
      value: round(value, 1),
    })),
    riskExposure,
    portfolioFragility,
    stressTests,
    opportunityRadar,
    riskBudget,
    portfolioIQ,
    concentrationIssues,
    notableChanges: alerts.slice(0, 5).map((alert) => alert.message),
    portfolioValue: round(portfolioContext.portfolioValue, 0),
    diversificationScore,
    averageRisk,
    freshnessHierarchy,
  };
}

/**
 * Builds a run snapshot for Recommendation History / Model Memory.
 * Store and later compare with forward outcomes to measure calibration, action accuracy, and regime/fit impact.
 */
export function buildRecommendationRunSnapshot(model: CommandCenterModel): RecommendationRunSnapshot {
  const runAt = new Date().toISOString();
  return {
    runAt,
    datasetAsOf: model.dataset.asOf,
    regimeKey: model.regime.key,
    deploymentTilt: model.regime.deploymentTilt,
    portfolioValue: model.portfolioValue,
    benchmarkPrice: model.dataset.benchmark.price,
    records: model.scorecards.map((card) => {
      const security = model.dataset.securities.find((item) => item.symbol === card.symbol);
      const reasonTags = [
        ...card.explanation.topDrivers.slice(0, 3).map((d) => d.label),
        ...card.explanation.topPenalties.slice(0, 2).map((p) => p.label),
      ];
      const rec: RecommendationRecord = {
        symbol: card.symbol,
        sector: security?.sector,
        action: card.action,
        composite: card.composite,
        opportunityScore: card.opportunity.score,
        timingScore: card.timing.score,
        portfolioFitScore: card.portfolioFit.score,
        confidence: card.confidence,
        dataQualityScore: card.dataQualityScore,
        riskOverall: card.risk.overall,
        riskBucket: card.risk.bucket,
        expected12m: card.expectedReturns[2].expected,
        confidenceBand: card.confidenceBand,
        priceAtRun: security?.price,
        expectedReturns: card.expectedReturns,
        suggestedWeightRange: card.allocation.suggestedWeightRange,
        suggestedDollarRange: card.allocation.suggestedDollarRange,
        reasonTags,
        unknowns: [
          ...(security?.dataQuality?.missingCoreFields ?? []),
          ...card.explanation.dataQualityNotes.filter((note) =>
            /stale|missing|inferred|coverage/i.test(note),
          ),
        ].slice(0, 5),
      };
      return rec;
    }),
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
