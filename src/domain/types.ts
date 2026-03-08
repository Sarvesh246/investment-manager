export type RiskTolerance =
  | 'low'
  | 'moderate'
  | 'moderate-aggressive'
  | 'aggressive';

export type StrategyStyle =
  | 'growth'
  | 'balanced'
  | 'value'
  | 'momentum'
  | 'quality'
  | 'speculative catalyst'
  | 'defensive'
  | 'dividend';

export type MarketCapBucket = 'micro' | 'small' | 'mid' | 'large' | 'mega';

export type SecurityType = 'stock' | 'adr' | 'reit';

export type RiskBucket =
  | 'Defensive'
  | 'Moderate'
  | 'Elevated'
  | 'Aggressive'
  | 'Fragile';

export type ActionLabel =
  | 'Buy now'
  | 'Buy partial'
  | 'Accumulate slowly'
  | 'Watch only'
  | 'Avoid'
  | 'Hold'
  | 'Trim'
  | 'Reassess after earnings'
  | 'High-upside / high-risk only'
  | 'Not suitable for current portfolio';

export type RegimeKey =
  | 'Bullish trend / low vol'
  | 'Bullish trend / high vol'
  | 'Sideways / low conviction'
  | 'Bearish trend / high vol'
  | 'Risk-on rotation'
  | 'Risk-off defensiveness';

export type PlannerPriority =
  | 'safety'
  | 'growth'
  | 'diversification'
  | 'conviction';

export type DeploymentStyle = 'deploy-all' | 'stage-entries' | 'hold-flexibility';

export interface StrategyWeights {
  growth: number;
  balanced: number;
  value: number;
  momentum: number;
  quality: number;
  speculative: number;
  defensive: number;
  dividend: number;
}

export interface UserProfile {
  id: string;
  name: string;
  baseCurrency: string;
  investableCash: number;
  monthlyContribution: number;
  timeHorizonMonths: number;
  riskTolerance: RiskTolerance;
  targetStrategy: StrategyStyle[];
  strategyWeights: StrategyWeights;
  allowedMarketCaps: MarketCapBucket[];
  preferredSectors: string[];
  excludedSectors: string[];
  allowedSecurityTypes: SecurityType[];
  maxSinglePositionWeight: number;
  maxSectorWeight: number;
  maxPortfolioDrawdownTolerance: number;
  avoidEarningsRisk: boolean;
  avoidDilutionProne: boolean;
  avoidCashBurners: boolean;
  targetCashReserve: number;
  preferredHoldingPeriodDays: number;
  benchmarkSymbol: string;
  watchlistNames: string[];
  manualTags: string[];
}

export interface Holding {
  symbol: string;
  shares: number;
  costBasis: number;
  styleTags: string[];
  thesisTags: string[];
  entryDate: string;
}

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
  notes: string;
}

export interface FactorExposure {
  growth: number;
  quality: number;
  value: number;
  momentum: number;
  defensive: number;
  cyclical: number;
}

export interface RawMetrics {
  revenueGrowth: number;
  revenueCagr: number;
  epsGrowth: number;
  grossMargin: number;
  operatingMargin: number;
  fcfMargin: number;
  fcfConsistency: number;
  debtToEquity: number;
  cashToDebt: number;
  currentRatio: number;
  quickRatio: number;
  roic: number;
  dilutionRate3y: number;
  marginStability: number;
  ret1m: number;
  ret3m: number;
  ret6m: number;
  ret12m: number;
  vol20d: number;
  vol60d: number;
  vol252d: number;
  downsideVol60d: number;
  maxDd3m: number;
  maxDd6m: number;
  maxDd12m: number;
  distanceSma20: number;
  distanceSma50: number;
  distanceSma200: number;
  trendSlope63d: number;
  momentumAcceleration: number;
  abnormalVolume20d: number;
  pullbackQuality: number;
  relativeStrength: number;
  beta: number;
  crashFrequency: number;
  tailLoss: number;
  sectorValuationPercentile: number;
  selfValuationPercentile: number;
  growthAdjustedValuation: number;
  fcfYield: number;
  pe: number;
  evSales: number;
  evEbitda: number;
  earningsDays: number;
  postEarningsGap: number;
  surpriseScore: number;
  revisionScore: number;
  insiderScore: number;
  catalystScore: number;
  cyclicality: number;
  eventConcentration: number;
  liquidityScore: number;
}

export interface SecuritySeed {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  description: string;
  marketCap: number;
  marketCapBucket: MarketCapBucket;
  securityType: SecurityType;
  price: number;
  fundamentalsLastUpdated: string;
  factors: FactorExposure;
  metrics: RawMetrics;
  priceHistory: number[];
  scoreHistory: number[];
  previousRisk: number;
  previousDownside: number;
  thesisNotes: string[];
  watchPoints: string[];
}

export interface BenchmarkSeed {
  symbol: string;
  price: number;
  ret1m: number;
  ret3m: number;
  ret6m: number;
  aboveSma50: boolean;
  aboveSma200: boolean;
  realizedVolPercentile: number;
  breadth: number;
  riskAppetite: number;
  drawdown: number;
}

export interface JournalEntry {
  id: string;
  symbol: string;
  decisionDate: string;
  decisionType: string;
  userThesis: string;
  invalidationRule: string;
  systemSummary: string;
  outcome: string;
}

export interface SymbolDirectoryEntry {
  symbol: string;
  displaySymbol: string;
  name: string;
  exchange: string;
  universes: string[];
}

export type PortfolioHistoryGranularity = 'intraday' | 'daily';

export interface PortfolioHistorySnapshot {
  timestamp: string;
  granularity: PortfolioHistoryGranularity;
  portfolioValue: number;
  holdingsValue: number;
  cashValue: number;
  costBasisValue: number;
  holdingCount: number;
}

export interface PortfolioHistoryStore {
  intraday: PortfolioHistorySnapshot[];
  daily: PortfolioHistorySnapshot[];
}

export interface MockDataset {
  asOf: string;
  dataMode?: 'seeded' | 'live' | 'blended';
  providerSummary?: string;
  snapshotId?: string;
  snapshotGeneratedAt?: string;
  syncNotes?: string[];
  user: UserProfile;
  holdings: Holding[];
  watchlists: Watchlist[];
  securities: SecuritySeed[];
  benchmark: BenchmarkSeed;
  journal: JournalEntry[];
}

export interface ScoreContribution {
  label: string;
  value: number;
  weight: number;
  contribution: number;
  narrative: string;
  tone: 'positive' | 'negative';
}

export interface ScoreBreakdown {
  score: number;
  groups: ScoreContribution[];
}

export interface ExpectedReturnScenario {
  horizon: '3M' | '6M' | '12M';
  expected: number;
  probabilityPositive: number;
  probabilityOutperform: number;
  probabilityDrawdown: number;
  bear: number;
  base: number;
  bull: number;
}

export interface RiskBreakdown {
  market: number;
  event: number;
  business: number;
  valuation: number;
  portfolioContribution: number;
  overall: number;
  bucket: RiskBucket;
  expectedDownside: number;
  sizeCapMultiplier: number;
}

export interface FitImpact {
  overlapScore: number;
  concentrationDelta: number;
  sectorWeightAfter: number;
  diversificationDelta: number;
  portfolioVolDelta: number;
}

export interface AllocationSuggestion {
  suggestedWeight: number;
  suggestedDollars: number;
  maxWeight: number;
  entryStyle: string;
  reserveAfterTrade: number;
  reasoning: string;
}

export interface Explainability {
  summary: string;
  topDrivers: ScoreContribution[];
  topPenalties: ScoreContribution[];
  riskNotes: string[];
  fitNotes: string[];
  regimeNotes: string[];
  allocationNotes: string[];
  watchPoints: string[];
  dataQualityNotes: string[];
  changeTriggers: string[];
}

export interface ScoreCard {
  symbol: string;
  opportunity: ScoreBreakdown;
  fragility: ScoreBreakdown;
  timing: ScoreBreakdown;
  portfolioFit: ScoreBreakdown;
  confidence: number;
  composite: number;
  risk: RiskBreakdown;
  expectedReturns: ExpectedReturnScenario[];
  action: ActionLabel;
  fitImpact: FitImpact;
  allocation: AllocationSuggestion;
  explanation: Explainability;
}

export interface RegimeSnapshot {
  key: RegimeKey;
  confidence: number;
  deploymentTilt: number;
  narrative: string;
  factorEmphasis: string[];
}

export interface HoldingAnalysis {
  symbol: string;
  shares: number;
  marketValue: number;
  weight: number;
  gainLossPct: number;
  action: ActionLabel;
  riskContribution: number;
  overlapToPortfolio: number;
  concentrationFlag: boolean;
}

export interface AlertItem {
  id: string;
  symbol?: string;
  severity: 'high' | 'medium' | 'low';
  kind: string;
  message: string;
  route: string;
}

export interface WatchlistMover {
  watchlist: string;
  symbol: string;
  move: number;
  note: string;
}

export interface PlannedAllocation {
  symbol: string;
  dollars: number;
  weight: number;
  role: string;
  entryStyle: string;
  rationale: string;
}

export interface AvoidanceItem {
  symbol: string;
  reason: string;
}

export interface DeploymentPlan {
  availableCash: number;
  deployNow: number;
  holdBack: number;
  reserveTarget: number;
  posture: string;
  rationale: string[];
  allocations: PlannedAllocation[];
  avoids: AvoidanceItem[];
}

export interface PlannerInputs {
  availableCash: number;
  riskTolerance: RiskTolerance;
  horizonMonths: number;
  priority: PlannerPriority;
  deploymentStyle: DeploymentStyle;
}

export interface CommandCenterModel {
  dataset: MockDataset;
  regime: RegimeSnapshot;
  scorecards: ScoreCard[];
  holdings: HoldingAnalysis[];
  alerts: AlertItem[];
  watchlistMovers: WatchlistMover[];
  deploymentPlan: DeploymentPlan;
  sectorExposure: Array<{ sector: string; weight: number }>;
  factorExposure: Array<{ factor: string; value: number }>;
  riskExposure: Array<{ bucket: RiskBucket; value: number }>;
  concentrationIssues: string[];
  notableChanges: string[];
  portfolioValue: number;
  diversificationScore: number;
  averageRisk: number;
}
