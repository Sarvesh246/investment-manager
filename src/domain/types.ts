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

export type AppTheme =
  | 'emerald'
  | 'cobalt'
  | 'amber'
  | 'rose'
  | 'graphite'
  | 'violet'
  | 'teal'
  | 'mint'
  | 'orange'
  | 'indigo'
  | 'cyan'
  | 'lime'
  | 'fuchsia'
  | 'sky';

export type RiskBucket =
  | 'Defensive'
  | 'Moderate'
  | 'Elevated'
  | 'Aggressive'
  | 'Fragile';

export type ConfidenceBand = 'High confidence' | 'Medium confidence' | 'Low confidence';

export type ThesisHealth = 'Improving' | 'Stable' | 'Weakening' | 'Broken';

export type FreshnessStatus = 'fresh' | 'aging' | 'stale';

export type SellDiscipline =
  | 'Thesis broken'
  | 'Upside mostly realized'
  | 'Valuation too stretched'
  | 'Risk increased too much'
  | 'Portfolio concentration issue'
  | 'Better replacement available'
  | 'Event risk no longer worth it';

export type ActionLabel =
  | 'Buy now'
  | 'Buy partial'
  | 'Accumulate slowly'
  | 'Watch only'
  | 'Avoid'
  | 'Hold'
  | 'Trim'
  | 'Sell'
  | 'Rotate'
  | 'De-risk'
  | 'Take profit'
  | 'Reassess after earnings'
  | 'High-upside / high-risk only'
  | 'Not suitable for current portfolio';

export type OutcomeHorizon = '1W' | '1M' | '3M' | '6M' | '12M';

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

export type DeploymentStyle =
  | 'deploy-all'
  | 'stage-entries'
  | 'hold-flexibility'
  | 'safe-starter';

export type TransactionKind =
  | 'deposit'
  | 'withdrawal'
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'split'
  | 'fee';

export type TransactionSource = 'manual' | 'system';

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

export type EditableUserSettings = Omit<
  UserProfile,
  'id' | 'name' | 'baseCurrency' | 'investableCash'
>;

export interface Holding {
  symbol: string;
  shares: number;
  costBasis: number;
  styleTags: string[];
  thesisTags: string[];
  entryDate: string;
}

export interface PortfolioTransaction {
  id: string;
  kind: TransactionKind;
  date: string;
  symbol?: string;
  shares?: number;
  price?: number;
  amount?: number;
  splitRatio?: number;
  note?: string;
  source: TransactionSource;
}

export interface LedgerBaseline {
  asOf: string;
  holdings: Holding[];
  investableCash: number;
}

export interface PortfolioLedgerSummary {
  transactionCount: number;
  realizedPnl: number;
  dividendsReceived: number;
  feesPaid: number;
  deposits: number;
  withdrawals: number;
  netCashFlow: number;
  lastActivityDate?: string;
  notes: string[];
}

export interface BrokerImportPosition {
  symbol: string;
  name?: string;
  shares: number;
  costBasis?: number;
  marketPrice?: number;
  marketValue?: number;
}

export interface BrokerImportSnapshot {
  importedAt: string;
  source: string;
  positions: BrokerImportPosition[];
  cash?: number;
  holdingsValue?: number;
  portfolioValue?: number;
  rawRowCount: number;
  notes: string[];
}

export type ReconciliationStatus =
  | 'Aligned'
  | 'Missing in app'
  | 'Missing in broker'
  | 'Share count differs'
  | 'Price differs'
  | 'Cost basis differs';

export interface ReconciliationItem {
  symbol: string;
  status: ReconciliationStatus;
  appShares?: number;
  brokerShares?: number;
  appMarketValue?: number;
  brokerMarketValue?: number;
  appCostBasis?: number;
  brokerCostBasis?: number;
  differenceValue?: number;
  note: string;
}

export interface PortfolioReconciliation {
  importedAt: string;
  source: string;
  modeledCash: number;
  modeledHoldingsValue: number;
  modeledPortfolioValue: number;
  brokerCash?: number;
  brokerHoldingsValue?: number;
  brokerPortfolioValue?: number;
  cashDifference?: number;
  holdingsDifference?: number;
  portfolioDifference?: number;
  items: ReconciliationItem[];
  likelyCauses: string[];
  summary: string;
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
  priceAsOf?: string;
  dataQuality?: {
    sourceMode: 'seeded' | 'live' | 'blended' | 'derived';
    coverage: number;
    inferredSignals: number;
    missingCoreFields: string[];
    notes: string[];
  };
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

export interface MacroSnapshot {
  asOf: string;
  yield2y?: number;
  yield10y?: number;
  curve2s10s?: number;
  unemploymentRate?: number;
  inflationYoY?: number;
  highYieldSpread?: number;
  narrative: string;
  riskTone: number;
}

export interface ValidationDecileMetric {
  decile: number;
  count: number;
  avgForwardReturn: number;
  avgBenchmarkRelativeReturn: number;
  hitRate: number;
}

export interface ValidationCalibrationMetric {
  bucket: string;
  count: number;
  predicted: number;
  realized: number;
  brier: number;
}

export interface ValidationRegimeMetric {
  regime: string;
  count: number;
  avgForwardReturn: number;
  hitRate: number;
}

export interface ValidationActionMetric {
  action: ActionLabel;
  count: number;
  avgForwardReturn: number;
  avgBenchmarkRelativeReturn: number;
  hitRate: number;
}

export interface ValidationConfidenceMetric {
  band: ConfidenceBand;
  count: number;
  predicted: number;
  realized: number;
  avgForwardReturn: number;
  hitRate: number;
  brier: number;
}

export interface ValidationSectorMetric {
  sector: string;
  count: number;
  avgForwardReturn: number;
  avgBenchmarkRelativeReturn: number;
  hitRate: number;
}

export interface ValidationReport {
  generatedAt: string;
  snapshotCount: number;
  pairCount: number;
  hitRate: number;
  averageForwardReturn: number;
  averageBenchmarkRelativeReturn: number;
  averageTurnover: number;
  brierScore: number;
  scoreDeciles: ValidationDecileMetric[];
  calibration: ValidationCalibrationMetric[];
  regimes: ValidationRegimeMetric[];
  actions?: ValidationActionMetric[];
  confidenceBands?: ValidationConfidenceMetric[];
  sectors?: ValidationSectorMetric[];
  notes: string[];
}

/** Optional sector-level context (e.g. from current events, trends, geopolitics) to nudge risk/confidence. */
export interface SectorContextEntry {
  sector: string;
  /** 0–100 headwind score; higher = more risk or lower confidence for this sector. */
  headwind?: number;
  /** 0–100 tailwind score; higher = less risk or higher confidence for this sector. */
  tailwind?: number;
  note?: string;
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
  transactions?: PortfolioTransaction[];
  ledgerBaseline?: LedgerBaseline;
  watchlists: Watchlist[];
  securities: SecuritySeed[];
  benchmark: BenchmarkSeed;
  journal: JournalEntry[];
  macroSnapshot?: MacroSnapshot;
  validationReport?: ValidationReport;
  /** Optional: current events / trends by sector; can be filled by UI or a future news/events API. */
  sectorContext?: SectorContextEntry[];
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
  clusterOverlap: number;
  concentrationDelta: number;
  sectorWeightAfter: number;
  diversificationDelta: number;
  portfolioVolDelta: number;
  marginalRiskContribution: number;
  marginalDrawdownImpact: number;
}

export interface AllocationSuggestion {
  suggestedWeight: number;
  suggestedDollars: number;
  suggestedWeightRange?: [number, number];
  suggestedDollarRange?: [number, number];
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

export interface DecisionFrame {
  why: string;
  mainRisk: string;
  suggestedRole: string;
  sizingDiscipline: string;
}

export interface ThesisSummary {
  thesisSummary: string;
  drivers: string[];
  risks: string[];
  thesisHealthScore: number;
}

export interface SignalAudit {
  redundancyPenalty: number;
  priceSignalCrowding: number;
  fragilityCrowding: number;
  families: Array<{
    family: string;
    averageScore: number;
    crowding: number;
    weightShare: number;
    correlatedPairs: string[];
  }>;
  correlatedPairs: Array<{
    family: string;
    pair: string;
    correlation: number;
  }>;
  notes: string[];
}

export interface FreshnessBreakdown {
  quoteAsOf: string;
  quoteFreshnessDays: number;
  quoteStatus: FreshnessStatus;
  fundamentalsAsOf: string;
  fundamentalsFreshnessDays: number;
  fundamentalsStatus: FreshnessStatus;
  macroAsOf?: string;
  macroFreshnessDays?: number;
  macroStatus?: FreshnessStatus;
  validationAsOf?: string;
  validationFreshnessDays?: number;
  validationStatus?: FreshnessStatus;
  modelAsOf: string;
  modelFreshnessDays: number;
  modelStatus: FreshnessStatus;
}

export interface RecommendationChange {
  previousComposite: number;
  compositeDelta: number;
  previousRisk: number;
  riskDelta: number;
  previousDownside: number;
  downsideDelta: number;
  previousAction: ActionLabel;
  actionChanged: boolean;
  summary: string;
  factorMoves: string[];
}

export interface ScoreCard {
  symbol: string;
  businessQuality: number;
  entryQuality: number;
  opportunity: ScoreBreakdown;
  fragility: ScoreBreakdown;
  timing: ScoreBreakdown;
  portfolioFit: ScoreBreakdown;
  confidence: number;
  confidenceBand: ConfidenceBand;
  dataQualityScore: number;
  dataReliabilityScore: number;
  macroAlignmentScore: number;
  composite: number;
  risk: RiskBreakdown;
  expectedReturns: ExpectedReturnScenario[];
  action: ActionLabel;
  thesisHealth: ThesisHealth;
  thesis: ThesisSummary;
  sellDiscipline?: SellDiscipline;
  replacementIdea?: string;
  decision: DecisionFrame;
  freshness: FreshnessBreakdown;
  recommendationChange: RecommendationChange;
  signalAudit: SignalAudit;
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
  environment: string[];
}

export interface HoldingAnalysis {
  symbol: string;
  shares: number;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  weight: number;
  gainLossPct: number;
  action: ActionLabel;
  riskContribution: number;
  overlapToPortfolio: number;
  concentrationFlag: boolean;
  thesisHealth: ThesisHealth;
  confidenceBand: ConfidenceBand;
  sellDiscipline?: SellDiscipline;
  replacementIdea?: string;
}

export interface FreshnessNode {
  label: string;
  asOf?: string;
  ageDays?: number;
  status: FreshnessStatus;
  note: string;
}

export interface FreshnessHierarchy {
  quotes: FreshnessNode;
  fundamentals: FreshnessNode;
  macro: FreshnessNode;
  validation: FreshnessNode;
  model: FreshnessNode;
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

export interface WatchlistSignal {
  id: string;
  watchlist: string;
  symbol: string;
  kind: 'Opportunity appearing' | 'Risk increasing' | 'Earnings approaching';
  message: string;
  severity: 'high' | 'medium' | 'low';
  route: string;
}

export interface PlannedAllocation {
  symbol: string;
  dollars: number;
  weight: number;
  dollarRange?: [number, number];
  weightRange?: [number, number];
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
  cashReserveSuggestion: number;
  posture: string;
  expectedReturnEstimate: number;
  riskEstimate: number;
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

/** Single recommendation record for one symbol in a model run. Used for Recommendation History / Model Memory. */
export interface RecommendationRecord {
  symbol: string;
  sector?: string;
  action: ActionLabel;
  composite: number;
  opportunityScore: number;
  timingScore: number;
  portfolioFitScore: number;
  confidence: number;
  dataQualityScore: number;
  riskOverall: number;
  riskBucket: RiskBucket;
  expected12m: number;
  confidenceBand: ConfidenceBand;
  priceAtRun?: number;
  expectedReturns?: ExpectedReturnScenario[];
  suggestedWeightRange?: [number, number];
  suggestedDollarRange?: [number, number];
  reasonTags: string[];
  unknowns?: string[];
  outcomes?: Partial<Record<OutcomeHorizon, RecommendationOutcome>>;
}

export interface RecommendationOutcome {
  horizon: OutcomeHorizon;
  measuredAt: string;
  forwardReturn: number;
  benchmarkRelativeReturn: number;
  hit: boolean;
  outperformed: boolean;
}

export interface DecisionAuditRecord {
  id: string;
  date: string;
  symbol: string;
  oldAction: ActionLabel;
  newAction: ActionLabel;
  reason: string;
}

export interface PortfolioFragilityAnalysis {
  fragilityScore: number;
  concentrationFlags: string[];
  hiddenExposureThemes: string[];
}

export interface StressScenarioResult {
  scenario: string;
  description: string;
  portfolioDrawdown: number;
  topRiskContributors: Array<{
    symbol: string;
    impact: number;
  }>;
}

export interface OpportunityRadarItem {
  symbol: string;
  setup: string;
  score: number;
  explanation: string;
}

export interface RiskBudgetSummary {
  riskBudgetTotal: number;
  riskUsed: number;
  riskByHolding: Array<{
    symbol: string;
    risk: number;
  }>;
  warning?: string;
}

export interface PortfolioIQSummary {
  score: number;
  summary: string;
  drivers: string[];
}

/** Snapshot of a full model run for later comparison with forward outcomes. */
export interface RecommendationRunSnapshot {
  runAt: string;
  datasetAsOf: string;
  regimeKey: RegimeKey;
  deploymentTilt: number;
  portfolioValue: number;
  benchmarkPrice?: number;
  records: RecommendationRecord[];
}

export interface CommandCenterModel {
  dataset: MockDataset;
  regime: RegimeSnapshot;
  scorecards: ScoreCard[];
  holdings: HoldingAnalysis[];
  ledgerSummary: PortfolioLedgerSummary;
  alerts: AlertItem[];
  watchlistMovers: WatchlistMover[];
  watchlistSignals: WatchlistSignal[];
  deploymentPlan: DeploymentPlan;
  sectorExposure: Array<{ sector: string; weight: number }>;
  factorExposure: Array<{ factor: string; value: number }>;
  riskExposure: Array<{ bucket: RiskBucket; value: number }>;
  portfolioFragility: PortfolioFragilityAnalysis;
  stressTests: StressScenarioResult[];
  opportunityRadar: OpportunityRadarItem[];
  riskBudget: RiskBudgetSummary;
  portfolioIQ: PortfolioIQSummary;
  concentrationIssues: string[];
  notableChanges: string[];
  portfolioValue: number;
  diversificationScore: number;
  averageRisk: number;
  freshnessHierarchy: FreshnessHierarchy;
}
