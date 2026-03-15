/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildCommandCenterModel, buildRecommendationRunSnapshot } from '../domain/engine';
import {
  buildDecisionAuditEntries,
  mergeDecisionAuditLog,
  mergeRecommendationHistory,
} from '../domain/recommendationHistory';
import { buildPortfolioReconciliation } from '../domain/reconciliation';
import { currentDataset as baseDataset } from '../data/currentDataset';
import type {
  ActionLabel,
  AppTheme,
  BrokerImportPosition,
  BrokerImportSnapshot,
  ConfidenceBand,
  DecisionAuditRecord,
  EditableUserSettings,
  Holding,
  JournalEntry,
  LedgerBaseline,
  MockDataset,
  OutcomeHorizon,
  PortfolioHistoryGranularity,
  PortfolioHistorySnapshot,
  PortfolioHistoryStore,
  PortfolioTransaction,
  RecommendationOutcome,
  RecommendationRecord,
  RecommendationRunSnapshot,
  RiskBucket,
  SecuritySeed,
  PortfolioReconciliation,
  StrategyStyle,
  StrategyWeights,
  SymbolDirectoryEntry,
  Watchlist,
} from '../domain/types';
import { createLedgerBaseline, replayTransactions } from '../domain/portfolioAccounting';
import { normalizeSymbol } from '../lib/symbols';
import { YahooPublicProvider, YahooRateLimitError } from '../live/yahooPublic';
import type { LiveQuoteSnapshot } from '../live/types';
import type { PortfolioWorkspaceValue } from './portfolioContext';
import { PortfolioWorkspaceContext } from './portfolioContext';
import {
  fetchSharedPortfolioHistory,
  mergePortfolioHistoryStores,
  normalizePortfolioHistory,
  persistSharedPortfolioHistory,
} from './sharedStorage';
import { useToast } from './toastContext';
import {
  applyQuoteToSecurity,
  buildSecurityFromLiveData,
  createProvisionalSecurity,
  mergeSecurityWithLiveData,
} from './securityFactory';

interface PersistedState {
  investableCash: number;
  holdings: Holding[];
  transactions: PortfolioTransaction[];
  ledgerBaseline: LedgerBaseline | null;
  brokerSnapshot: BrokerImportSnapshot | null;
  userSettings: EditableUserSettings;
  theme: AppTheme;
  journal: JournalEntry[];
  watchlists: Watchlist[];
  recommendationHistory: RecommendationRunSnapshot[];
  decisionAuditLog: DecisionAuditRecord[];
}

const storageKey = 'investment-center-user-portfolio-v1';
const historyStorageKey = 'investment-center-portfolio-history-v1';
const quotePollIntervalMs = 5_000;
const intradayBucketMinutes = 15;
const intradayRetentionDays = 14;
const dailyRetentionDays = 400;
const availableRiskTolerances = ['low', 'moderate', 'moderate-aggressive', 'aggressive'] as const;
const availableThemes = [
  'emerald',
  'cobalt',
  'amber',
  'rose',
  'graphite',
  'violet',
  'teal',
  'mint',
  'orange',
  'indigo',
  'cyan',
  'lime',
  'fuchsia',
  'sky',
] as const;
const availableMarketCaps = ['micro', 'small', 'mid', 'large', 'mega'] as const;
const availableSecurityTypes = ['stock', 'adr', 'reit'] as const;

function defaultUserSettings(): EditableUserSettings {
  return {
    monthlyContribution: baseDataset.user.monthlyContribution,
    timeHorizonMonths: baseDataset.user.timeHorizonMonths,
    riskTolerance: baseDataset.user.riskTolerance,
    targetStrategy: [...baseDataset.user.targetStrategy],
    strategyWeights: { ...baseDataset.user.strategyWeights },
    allowedMarketCaps: [...baseDataset.user.allowedMarketCaps],
    preferredSectors: [...baseDataset.user.preferredSectors],
    excludedSectors: [...baseDataset.user.excludedSectors],
    allowedSecurityTypes: [...baseDataset.user.allowedSecurityTypes],
    maxSinglePositionWeight: baseDataset.user.maxSinglePositionWeight,
    maxSectorWeight: baseDataset.user.maxSectorWeight,
    maxPortfolioDrawdownTolerance: baseDataset.user.maxPortfolioDrawdownTolerance,
    avoidEarningsRisk: baseDataset.user.avoidEarningsRisk,
    avoidDilutionProne: baseDataset.user.avoidDilutionProne,
    avoidCashBurners: baseDataset.user.avoidCashBurners,
    targetCashReserve: baseDataset.user.targetCashReserve,
    preferredHoldingPeriodDays: baseDataset.user.preferredHoldingPeriodDays,
    benchmarkSymbol: baseDataset.user.benchmarkSymbol,
    watchlistNames: [...baseDataset.user.watchlistNames],
    manualTags: [...baseDataset.user.manualTags],
  };
}

function defaultTheme(): AppTheme {
  return 'emerald';
}

function defaultState(): PersistedState {
  return {
    investableCash: 0,
    holdings: [],
    transactions: [],
    ledgerBaseline: null,
    brokerSnapshot: null,
    userSettings: defaultUserSettings(),
    theme: defaultTheme(),
    journal: [],
    watchlists: [],
    recommendationHistory: [],
    decisionAuditLog: [],
  };
}

function defaultPortfolioHistory(): PortfolioHistoryStore {
  return normalizePortfolioHistory({});
}

function roundMoney(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeStringList(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(input.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeStrategyWeights(input: unknown): StrategyWeights {
  const defaults = defaultUserSettings().strategyWeights;
  const candidate = input && typeof input === 'object' ? (input as Partial<StrategyWeights>) : {};
  const rawWeights: StrategyWeights = {
    growth: Math.max(0, Number(candidate.growth ?? defaults.growth) || 0),
    balanced: Math.max(0, Number(candidate.balanced ?? defaults.balanced) || 0),
    value: Math.max(0, Number(candidate.value ?? defaults.value) || 0),
    momentum: Math.max(0, Number(candidate.momentum ?? defaults.momentum) || 0),
    quality: Math.max(0, Number(candidate.quality ?? defaults.quality) || 0),
    speculative: Math.max(0, Number(candidate.speculative ?? defaults.speculative) || 0),
    defensive: Math.max(0, Number(candidate.defensive ?? defaults.defensive) || 0),
    dividend: Math.max(0, Number(candidate.dividend ?? defaults.dividend) || 0),
  };
  const total = Object.values(rawWeights).reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    return defaults;
  }

  return {
    growth: rawWeights.growth / total,
    balanced: rawWeights.balanced / total,
    value: rawWeights.value / total,
    momentum: rawWeights.momentum / total,
    quality: rawWeights.quality / total,
    speculative: rawWeights.speculative / total,
    defensive: rawWeights.defensive / total,
    dividend: rawWeights.dividend / total,
  };
}

function deriveTargetStrategy(strategyWeights: StrategyWeights): StrategyStyle[] {
  const styleMap: Array<{ style: StrategyStyle; value: number }> = [
    { style: 'growth', value: strategyWeights.growth },
    { style: 'balanced', value: strategyWeights.balanced },
    { style: 'value', value: strategyWeights.value },
    { style: 'momentum', value: strategyWeights.momentum },
    { style: 'quality', value: strategyWeights.quality },
    { style: 'speculative catalyst', value: strategyWeights.speculative },
    { style: 'defensive', value: strategyWeights.defensive },
    { style: 'dividend', value: strategyWeights.dividend },
  ];

  const targetStrategy = styleMap
    .sort((left, right) => right.value - left.value)
    .filter((entry) => entry.value > 0)
    .slice(0, 3)
    .map((entry) => entry.style);

  return targetStrategy.length > 0 ? targetStrategy : ['balanced'];
}

function normalizeUserSettings(input: unknown): EditableUserSettings {
  const defaults = defaultUserSettings();
  const candidate = input && typeof input === 'object' ? (input as Partial<EditableUserSettings>) : {};
  const strategyWeights = normalizeStrategyWeights(candidate.strategyWeights);
  const riskTolerance = availableRiskTolerances.includes(
    candidate.riskTolerance as (typeof availableRiskTolerances)[number],
  )
    ? (candidate.riskTolerance as EditableUserSettings['riskTolerance'])
    : defaults.riskTolerance;
  const allowedMarketCaps = normalizeStringList(candidate.allowedMarketCaps).filter((bucket) =>
    availableMarketCaps.includes(bucket as typeof availableMarketCaps[number]),
  ) as EditableUserSettings['allowedMarketCaps'];
  const allowedSecurityTypes = normalizeStringList(candidate.allowedSecurityTypes).filter((type) =>
    availableSecurityTypes.includes(type as typeof availableSecurityTypes[number]),
  ) as EditableUserSettings['allowedSecurityTypes'];

  return {
    monthlyContribution: Math.max(0, Number(candidate.monthlyContribution ?? defaults.monthlyContribution) || 0),
    timeHorizonMonths: clamp(
      Math.round(Number(candidate.timeHorizonMonths ?? defaults.timeHorizonMonths) || defaults.timeHorizonMonths),
      1,
      360,
    ),
    riskTolerance,
    targetStrategy: deriveTargetStrategy(strategyWeights),
    strategyWeights,
    allowedMarketCaps: allowedMarketCaps.length > 0 ? allowedMarketCaps : defaults.allowedMarketCaps,
    preferredSectors: normalizeStringList(candidate.preferredSectors),
    excludedSectors: normalizeStringList(candidate.excludedSectors),
    allowedSecurityTypes:
      allowedSecurityTypes.length > 0 ? allowedSecurityTypes : defaults.allowedSecurityTypes,
    maxSinglePositionWeight: clamp(
      Number(candidate.maxSinglePositionWeight ?? defaults.maxSinglePositionWeight) || defaults.maxSinglePositionWeight,
      0.01,
      1,
    ),
    maxSectorWeight: clamp(
      Number(candidate.maxSectorWeight ?? defaults.maxSectorWeight) || defaults.maxSectorWeight,
      0.01,
      1,
    ),
    maxPortfolioDrawdownTolerance: clamp(
      Number(candidate.maxPortfolioDrawdownTolerance ?? defaults.maxPortfolioDrawdownTolerance) ||
        defaults.maxPortfolioDrawdownTolerance,
      0.01,
      1,
    ),
    avoidEarningsRisk: Boolean(candidate.avoidEarningsRisk ?? defaults.avoidEarningsRisk),
    avoidDilutionProne: Boolean(candidate.avoidDilutionProne ?? defaults.avoidDilutionProne),
    avoidCashBurners: Boolean(candidate.avoidCashBurners ?? defaults.avoidCashBurners),
    targetCashReserve: Math.max(0, Number(candidate.targetCashReserve ?? defaults.targetCashReserve) || 0),
    preferredHoldingPeriodDays: clamp(
      Math.round(
        Number(candidate.preferredHoldingPeriodDays ?? defaults.preferredHoldingPeriodDays) ||
          defaults.preferredHoldingPeriodDays,
      ),
      1,
      3650,
    ),
    benchmarkSymbol: String(candidate.benchmarkSymbol ?? defaults.benchmarkSymbol).trim().toUpperCase() || defaults.benchmarkSymbol,
    watchlistNames: normalizeStringList(candidate.watchlistNames),
    manualTags: normalizeStringList(candidate.manualTags),
  };
}

function normalizeTheme(input: unknown): AppTheme {
  return availableThemes.includes(input as AppTheme) ? (input as AppTheme) : defaultTheme();
}

function padTimeUnit(value: number) {
  return String(value).padStart(2, '0');
}

function toLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${padTimeUnit(date.getMonth() + 1)}-${padTimeUnit(date.getDate())}`;
}

function toIntradayBucketKey(date: Date) {
  const bucketMinute = Math.floor(date.getMinutes() / intradayBucketMinutes) * intradayBucketMinutes;
  return `${toLocalDateKey(date)}T${padTimeUnit(date.getHours())}:${padTimeUnit(bucketMinute)}`;
}

function snapshotKey(snapshot: PortfolioHistorySnapshot) {
  const timestamp = new Date(snapshot.timestamp);
  return snapshot.granularity === 'daily'
    ? toLocalDateKey(timestamp)
    : toIntradayBucketKey(timestamp);
}

function sortSnapshots(snapshots: PortfolioHistorySnapshot[]) {
  return [...snapshots].sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
}

function normalizeHolding(holding: Holding): Holding {
  return {
    ...holding,
    symbol: normalizeSymbol(holding.symbol),
  };
}

function normalizeTransaction(input: unknown): PortfolioTransaction | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Partial<PortfolioTransaction>;
  const id = String(candidate.id ?? '').trim();
  const kind = String(candidate.kind ?? '').trim() as PortfolioTransaction['kind'];
  const date = String(candidate.date ?? '').trim();

  if (!id || !kind || !date) {
    return null;
  }

  return {
    id,
    kind,
    date,
    symbol: candidate.symbol ? normalizeSymbol(candidate.symbol) : undefined,
    shares: candidate.shares != null ? Number(candidate.shares) : undefined,
    price: candidate.price != null ? Number(candidate.price) : undefined,
    amount: candidate.amount != null ? Number(candidate.amount) : undefined,
    splitRatio: candidate.splitRatio != null ? Number(candidate.splitRatio) : undefined,
    note: candidate.note ? String(candidate.note) : undefined,
    source: candidate.source === 'system' ? 'system' : 'manual',
  };
}

function normalizeLedgerBaseline(input: unknown): LedgerBaseline | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Partial<LedgerBaseline>;

  return {
    asOf: String(candidate.asOf ?? new Date().toISOString()),
    holdings: Array.isArray(candidate.holdings)
      ? candidate.holdings.map(normalizeHolding).filter((holding) => holding.symbol)
      : [],
    investableCash: Number(candidate.investableCash ?? 0) || 0,
  };
}

function ledgerBaselinesEqual(left: LedgerBaseline | null, right: LedgerBaseline) {
  if (!left) {
    return false;
  }

  if (left.investableCash !== right.investableCash || left.holdings.length !== right.holdings.length) {
    return false;
  }

  return left.holdings.every((holding, index) => {
    const candidate = right.holdings[index];

    return (
      holding.symbol === candidate.symbol &&
      holding.shares === candidate.shares &&
      holding.costBasis === candidate.costBasis &&
      holding.entryDate === candidate.entryDate
    );
  });
}

function normalizeJournalEntry(input: unknown): JournalEntry | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Partial<JournalEntry>;
  const id = String(candidate.id ?? '').trim();

  if (!id) {
    return null;
  }

  return {
    id,
    symbol: normalizeSymbol(candidate.symbol ?? '') || '?',
    decisionDate: String(candidate.decisionDate ?? new Date().toISOString().slice(0, 10)),
    decisionType: String(candidate.decisionType ?? 'Buy').trim() || 'Buy',
    userThesis: String(candidate.userThesis ?? '').trim(),
    invalidationRule: String(candidate.invalidationRule ?? '').trim(),
    systemSummary: String(candidate.systemSummary ?? '').trim(),
    outcome: String(candidate.outcome ?? '').trim(),
  };
}

function normalizeWatchlist(input: unknown): Watchlist | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Partial<Watchlist>;
  const id = String(candidate.id ?? '').trim();
  const name = String(candidate.name ?? '').trim();

  if (!id || !name) {
    return null;
  }

  const symbols = Array.isArray(candidate.symbols)
    ? candidate.symbols.map((s) => normalizeSymbol(String(s))).filter(Boolean)
    : [];

  return {
    id,
    name,
    symbols: [...new Set(symbols)],
    notes: String(candidate.notes ?? '').trim(),
  };
}

function normalizeBrokerImportPosition(input: unknown): BrokerImportPosition | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Partial<BrokerImportPosition>;
  const symbol = normalizeSymbol(String(candidate.symbol ?? ''));
  const shares = Number(candidate.shares ?? 0);

  if (!symbol || !Number.isFinite(shares) || shares <= 0) {
    return null;
  }

  return {
    symbol,
    name: candidate.name ? String(candidate.name).trim() : undefined,
    shares,
    costBasis: candidate.costBasis == null ? undefined : Number(candidate.costBasis),
    marketPrice: candidate.marketPrice == null ? undefined : Number(candidate.marketPrice),
    marketValue: candidate.marketValue == null ? undefined : Number(candidate.marketValue),
  };
}

function normalizeBrokerSnapshot(input: unknown): BrokerImportSnapshot | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Partial<BrokerImportSnapshot>;
  const importedAt = String(candidate.importedAt ?? '').trim();
  const source = String(candidate.source ?? '').trim();

  if (!importedAt || !source) {
    return null;
  }

  return {
    importedAt,
    source,
    positions: Array.isArray(candidate.positions)
      ? candidate.positions
          .map(normalizeBrokerImportPosition)
          .filter((position): position is BrokerImportPosition => position !== null)
      : [],
    cash: candidate.cash == null ? undefined : Number(candidate.cash),
    holdingsValue: candidate.holdingsValue == null ? undefined : Number(candidate.holdingsValue),
    portfolioValue: candidate.portfolioValue == null ? undefined : Number(candidate.portfolioValue),
    rawRowCount: Math.max(0, Math.round(Number(candidate.rawRowCount ?? 0) || 0)),
    notes: normalizeStringList(candidate.notes),
  };
}

function transactionSignature(transaction: Omit<PortfolioTransaction, 'id'>) {
  return [
    transaction.kind,
    transaction.date,
    transaction.symbol ?? '',
    transaction.shares ?? '',
    transaction.price ?? '',
    transaction.amount ?? '',
    transaction.splitRatio ?? '',
    transaction.note ?? '',
    transaction.source,
  ].join('|');
}

function mergeImportedTransactions(
  existing: PortfolioTransaction[],
  imported: PortfolioTransaction[],
) {
  const signatures = new Set(existing.map((transaction) => transactionSignature(transaction)));
  const additions: PortfolioTransaction[] = [];
  let skipped = 0;

  imported.forEach((transaction) => {
    const signature = transactionSignature(transaction);

    if (signatures.has(signature)) {
      skipped += 1;
      return;
    }

    signatures.add(signature);
    additions.push(transaction);
  });

  return {
    transactions: [...existing, ...additions],
    added: additions.length,
    skipped,
  };
}

function normalizeRecommendationOutcome(
  horizon: OutcomeHorizon,
  input: unknown,
): RecommendationOutcome | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Partial<RecommendationOutcome>;
  const measuredAt = String(candidate.measuredAt ?? '').trim();

  if (!measuredAt) {
    return null;
  }

  return {
    horizon,
    measuredAt,
    forwardReturn: Number(candidate.forwardReturn ?? 0) || 0,
    benchmarkRelativeReturn: Number(candidate.benchmarkRelativeReturn ?? 0) || 0,
    hit: Boolean(candidate.hit),
    outperformed: Boolean(candidate.outperformed),
  };
}

function normalizeRecommendationRecord(input: unknown): RecommendationRecord | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Partial<RecommendationRecord>;
  const symbol = normalizeSymbol(String(candidate.symbol ?? ''));
  const action = String(candidate.action ?? '').trim() as ActionLabel;
  const confidenceBand = String(candidate.confidenceBand ?? '').trim() as ConfidenceBand;
  const riskBucket = String(candidate.riskBucket ?? '').trim() as RiskBucket;

  if (!symbol || !action || !confidenceBand || !riskBucket) {
    return null;
  }

  const outcomesSource =
    candidate.outcomes && typeof candidate.outcomes === 'object'
      ? (candidate.outcomes as Partial<Record<OutcomeHorizon, RecommendationOutcome>>)
      : {};
  const outcomeEntries = (['1W', '1M', '3M', '6M', '12M'] as OutcomeHorizon[])
    .map((horizon) => [horizon, normalizeRecommendationOutcome(horizon, outcomesSource[horizon])] as const)
    .filter((entry): entry is readonly [OutcomeHorizon, RecommendationOutcome] => entry[1] !== null);

  return {
    symbol,
    sector: String(candidate.sector ?? '').trim() || undefined,
    action,
    composite: Number(candidate.composite ?? 0) || 0,
    opportunityScore: Number(candidate.opportunityScore ?? 0) || 0,
    timingScore: Number(candidate.timingScore ?? 0) || 0,
    portfolioFitScore: Number(candidate.portfolioFitScore ?? 0) || 0,
    confidence: Number(candidate.confidence ?? 0) || 0,
    dataQualityScore: Number(candidate.dataQualityScore ?? 0) || 0,
    riskOverall: Number(candidate.riskOverall ?? 0) || 0,
    riskBucket,
    expected12m: Number(candidate.expected12m ?? 0) || 0,
    confidenceBand,
    priceAtRun: candidate.priceAtRun == null ? undefined : Number(candidate.priceAtRun),
    expectedReturns: Array.isArray(candidate.expectedReturns) ? candidate.expectedReturns : undefined,
    suggestedWeightRange:
      Array.isArray(candidate.suggestedWeightRange) && candidate.suggestedWeightRange.length === 2
        ? [Number(candidate.suggestedWeightRange[0]) || 0, Number(candidate.suggestedWeightRange[1]) || 0]
        : undefined,
    suggestedDollarRange:
      Array.isArray(candidate.suggestedDollarRange) && candidate.suggestedDollarRange.length === 2
        ? [Number(candidate.suggestedDollarRange[0]) || 0, Number(candidate.suggestedDollarRange[1]) || 0]
        : undefined,
    reasonTags: normalizeStringList(candidate.reasonTags),
    unknowns: normalizeStringList(candidate.unknowns),
    outcomes: outcomeEntries.length > 0 ? Object.fromEntries(outcomeEntries) : undefined,
  };
}

function normalizeRecommendationRun(input: unknown): RecommendationRunSnapshot | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Partial<RecommendationRunSnapshot>;
  const runAt = String(candidate.runAt ?? '').trim();
  const datasetAsOf = String(candidate.datasetAsOf ?? '').trim();
  const regimeKey = String(candidate.regimeKey ?? '').trim() as RecommendationRunSnapshot['regimeKey'];

  if (!runAt || !datasetAsOf || !regimeKey) {
    return null;
  }

  return {
    runAt,
    datasetAsOf,
    regimeKey,
    deploymentTilt: Number(candidate.deploymentTilt ?? 0) || 0,
    portfolioValue: Number(candidate.portfolioValue ?? 0) || 0,
    benchmarkPrice: candidate.benchmarkPrice == null ? undefined : Number(candidate.benchmarkPrice),
    records: Array.isArray(candidate.records)
      ? candidate.records
          .map(normalizeRecommendationRecord)
          .filter((record): record is RecommendationRecord => record !== null)
      : [],
  };
}

function normalizeDecisionAuditRecord(input: unknown): DecisionAuditRecord | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Partial<DecisionAuditRecord>;
  const id = String(candidate.id ?? '').trim();
  const date = String(candidate.date ?? '').trim();
  const symbol = normalizeSymbol(String(candidate.symbol ?? ''));
  const oldAction = String(candidate.oldAction ?? '').trim() as ActionLabel;
  const newAction = String(candidate.newAction ?? '').trim() as ActionLabel;

  if (!id || !date || !symbol || !oldAction || !newAction) {
    return null;
  }

  return {
    id,
    date,
    symbol,
    oldAction,
    newAction,
    reason: String(candidate.reason ?? '').trim(),
  };
}

export function parsePersistedState(raw: string | null): PersistedState {
  if (!raw) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(raw) as PersistedState;
    const hasPersistedJournal = Object.prototype.hasOwnProperty.call(parsed, 'journal');
    const hasPersistedWatchlists = Object.prototype.hasOwnProperty.call(parsed, 'watchlists');

    return {
      investableCash: parsed.investableCash ?? 0,
      holdings: Array.isArray(parsed.holdings)
        ? parsed.holdings.map(normalizeHolding).filter((holding) => holding.symbol)
        : [],
      transactions: Array.isArray(parsed.transactions)
        ? parsed.transactions.map(normalizeTransaction).filter((transaction): transaction is PortfolioTransaction => transaction !== null)
        : [],
      ledgerBaseline: normalizeLedgerBaseline(parsed.ledgerBaseline),
      brokerSnapshot: normalizeBrokerSnapshot(parsed.brokerSnapshot),
      userSettings: normalizeUserSettings(parsed.userSettings),
      theme: normalizeTheme(parsed.theme),
      journal: hasPersistedJournal && Array.isArray(parsed.journal)
        ? parsed.journal.map(normalizeJournalEntry).filter((entry): entry is JournalEntry => entry !== null)
        : (baseDataset.journal ?? []).map(normalizeJournalEntry).filter((entry): entry is JournalEntry => entry !== null),
      watchlists: hasPersistedWatchlists && Array.isArray(parsed.watchlists)
        ? parsed.watchlists.map(normalizeWatchlist).filter((watchlist): watchlist is Watchlist => watchlist !== null)
        : (baseDataset.watchlists ?? []).map(normalizeWatchlist).filter((watchlist): watchlist is Watchlist => watchlist !== null),
      recommendationHistory: Array.isArray(parsed.recommendationHistory)
        ? parsed.recommendationHistory
            .map(normalizeRecommendationRun)
            .filter((run): run is RecommendationRunSnapshot => run !== null)
            .slice(-50)
        : [],
      decisionAuditLog: Array.isArray(parsed.decisionAuditLog)
        ? parsed.decisionAuditLog
            .map(normalizeDecisionAuditRecord)
            .filter((entry): entry is DecisionAuditRecord => entry !== null)
            .slice(-250)
        : [],
    };
  } catch {
    return defaultState();
  }
}

function loadPersistedState(): PersistedState {
  if (typeof window === 'undefined') {
    return defaultState();
  }

  return parsePersistedState(window.localStorage.getItem(storageKey));
}

function persistState(state: PersistedState) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function loadPersistedHistory(): PortfolioHistoryStore {
  if (typeof window === 'undefined') {
    return defaultPortfolioHistory();
  }

  const raw = window.localStorage.getItem(historyStorageKey);

  if (!raw) {
    return defaultPortfolioHistory();
  }

  try {
    const parsed = normalizePortfolioHistory(JSON.parse(raw));
    return {
      intraday: pruneSnapshots(parsed.intraday, 'intraday'),
      daily: pruneSnapshots(parsed.daily, 'daily'),
    };
  } catch {
    return defaultPortfolioHistory();
  }
}

function persistPortfolioHistory(history: PortfolioHistoryStore) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(historyStorageKey, JSON.stringify(history));
}

export function resolveLedgerBaselineForTransactions(
  current: LedgerBaseline | null,
  holdings: Holding[],
  investableCash: number,
  transactionCount: number,
) {
  if (transactionCount === 0) {
    return current;
  }

  const nextBaseline = createLedgerBaseline(holdings, investableCash);
  return ledgerBaselinesEqual(current, nextBaseline) ? current : nextBaseline;
}

function pruneSnapshots(
  snapshots: PortfolioHistorySnapshot[],
  granularity: PortfolioHistoryGranularity,
) {
  const now = Date.now();
  const retentionDays = granularity === 'daily' ? dailyRetentionDays : intradayRetentionDays;
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;

  return sortSnapshots(
    snapshots.filter((snapshot) => new Date(snapshot.timestamp).getTime() >= cutoff),
  );
}

function mergeSnapshotIntoSeries(
  snapshots: PortfolioHistorySnapshot[],
  nextSnapshot: PortfolioHistorySnapshot,
) {
  const nextKey = snapshotKey(nextSnapshot);
  const matchIndex = snapshots.findIndex((snapshot) => snapshotKey(snapshot) === nextKey);

  if (matchIndex === -1) {
    return pruneSnapshots([...snapshots, nextSnapshot], nextSnapshot.granularity);
  }

  const current = snapshots[matchIndex];
  const unchanged =
    current.portfolioValue === nextSnapshot.portfolioValue &&
    current.holdingsValue === nextSnapshot.holdingsValue &&
    current.cashValue === nextSnapshot.cashValue &&
    current.costBasisValue === nextSnapshot.costBasisValue &&
    current.holdingCount === nextSnapshot.holdingCount;

  if (unchanged) {
    return snapshots;
  }

  const nextSnapshots = [...snapshots];
  nextSnapshots[matchIndex] = nextSnapshot;
  return pruneSnapshots(nextSnapshots, nextSnapshot.granularity);
}

function buildPortfolioSnapshot(
  portfolioValue: number,
  marketValue: number,
  investableCash: number,
  holdings: Holding[],
) {
  return {
    timestamp: new Date().toISOString(),
    portfolioValue: roundMoney(portfolioValue),
    holdingsValue: roundMoney(marketValue),
    cashValue: roundMoney(investableCash),
    costBasisValue: roundMoney(
      holdings.reduce((total, holding) => total + holding.shares * holding.costBasis, 0),
    ),
    holdingCount: holdings.length,
  };
}

function shouldCaptureSnapshot(snapshot: Omit<PortfolioHistorySnapshot, 'granularity'>) {
  return (
    snapshot.portfolioValue > 0 ||
    snapshot.holdingsValue > 0 ||
    snapshot.cashValue > 0 ||
    snapshot.holdingCount > 0
  );
}

function fallbackSecurityForSymbol(
  symbol: string,
  holdings: Holding[],
  liveSecurities: Record<string, SecuritySeed>,
) {
  return (
    liveSecurities[symbol] ??
    baseDataset.securities.find((security) => security.symbol === symbol) ??
    createProvisionalSecurity(
      symbol,
      holdings.find((holding) => holding.symbol === symbol)?.costBasis ?? 100,
    )
  );
}

export function PortfolioWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { addToast } = useToast();
  const initial = loadPersistedState();
  const [baseHoldings, setBaseHoldings] = useState<Holding[]>(initial.holdings);
  const [baseInvestableCash, setBaseInvestableCashState] = useState(initial.investableCash);
  const [transactions, setTransactions] = useState<PortfolioTransaction[]>(initial.transactions);
  const [ledgerBaseline, setLedgerBaseline] = useState<LedgerBaseline | null>(initial.ledgerBaseline);
  const [brokerSnapshot, setBrokerSnapshot] = useState<BrokerImportSnapshot | null>(
    initial.brokerSnapshot,
  );
  const [userSettings, setUserSettings] = useState<EditableUserSettings>(initial.userSettings);
  const [theme, setThemeState] = useState<AppTheme>(initial.theme);
  const [journal, setJournal] = useState<JournalEntry[]>(initial.journal);
  const [watchlists, setWatchlists] = useState<Watchlist[]>(initial.watchlists);
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioHistoryStore>(() =>
    loadPersistedHistory(),
  );
  const [sharedHistoryReady, setSharedHistoryReady] = useState(false);
  const [symbolDirectory, setSymbolDirectory] = useState<SymbolDirectoryEntry[]>([]);
  const [symbolDirectoryState, setSymbolDirectoryState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [symbolDirectoryError, setSymbolDirectoryError] = useState<string | null>(null);
  const [liveSecurities, setLiveSecurities] = useState<Record<string, SecuritySeed>>({});
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveQuoteSnapshot>>({});
  const [trackedSymbols, setTrackedSymbols] = useState<string[]>([]);
  const [loadingSymbols, setLoadingSymbols] = useState<string[]>([]);
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});
  const [lastQuoteRefreshAt, setLastQuoteRefreshAt] = useState<string | null>(null);
  const [recommendationHistory, setRecommendationHistory] = useState<
    RecommendationRunSnapshot[]
  >(initial.recommendationHistory);
  const [decisionAuditLog, setDecisionAuditLog] = useState<DecisionAuditRecord[]>(
    initial.decisionAuditLog,
  );
  const rateLimitToastShownRef = useRef(false);

  const accounting = useMemo(() => {
    if (transactions.length === 0) {
      return {
        holdings: baseHoldings,
        investableCash: baseInvestableCash,
        summary: {
          transactionCount: 0,
          realizedPnl: 0,
          dividendsReceived: 0,
          feesPaid: 0,
          deposits: 0,
          withdrawals: 0,
          netCashFlow: 0,
          notes: [],
        },
      };
    }

    const baseline =
      ledgerBaseline ??
      createLedgerBaseline(baseHoldings, baseInvestableCash);

    return replayTransactions(baseline, transactions);
  }, [baseHoldings, baseInvestableCash, ledgerBaseline, transactions]);
  const holdings = accounting.holdings;
  const investableCash = accounting.investableCash;

  const provider = useMemo(() => new YahooPublicProvider(), []);
  const holdingSymbols = useMemo(
    () => [...new Set(holdings.map((holding) => normalizeSymbol(holding.symbol)).filter(Boolean))],
    [holdings],
  );
  const holdingSymbolsKey = holdingSymbols.join('|');

  useEffect(() => {
    persistState({
      holdings: baseHoldings,
      investableCash: baseInvestableCash,
      transactions,
      ledgerBaseline,
      brokerSnapshot,
      userSettings,
      journal,
      watchlists,
      recommendationHistory,
      decisionAuditLog,
      theme,
    });
  }, [baseHoldings, baseInvestableCash, brokerSnapshot, decisionAuditLog, journal, ledgerBaseline, recommendationHistory, theme, transactions, userSettings, watchlists]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    setLedgerBaseline((current) =>
      resolveLedgerBaselineForTransactions(
        current,
        baseHoldings,
        baseInvestableCash,
        transactions.length,
      ),
    );
  }, [baseHoldings, baseInvestableCash, transactions.length]);

  useEffect(() => {
    persistPortfolioHistory(portfolioHistory);
  }, [portfolioHistory]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSharedPortfolioHistory() {
      try {
        const sharedHistory = await fetchSharedPortfolioHistory();

        if (cancelled) {
          return;
        }

        setPortfolioHistory((current) => {
          const merged = mergePortfolioHistoryStores(current, sharedHistory);
          return {
            intraday: pruneSnapshots(merged.intraday, 'intraday'),
            daily: pruneSnapshots(merged.daily, 'daily'),
          };
        });
      } catch {
        // Shared file-backed history is best-effort; local cache remains the fallback.
      } finally {
        if (!cancelled) {
          setSharedHistoryReady(true);
        }
      }
    }

    void hydrateSharedPortfolioHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sharedHistoryReady) {
      return;
    }

    void persistSharedPortfolioHistory(portfolioHistory);
  }, [portfolioHistory, sharedHistoryReady]);

  useEffect(() => {
    let cancelled = false;

    async function loadSymbolDirectory() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}symbol-directory.json`);

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        const payload = (await response.json()) as {
          entries?: SymbolDirectoryEntry[];
        };

        if (!cancelled) {
          setSymbolDirectory(payload.entries ?? []);
          setSymbolDirectoryState('ready');
          setSymbolDirectoryError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setSymbolDirectory([]);
          setSymbolDirectoryState('error');
          setSymbolDirectoryError(
            error instanceof Error ? error.message : 'Symbol directory fetch failed.',
          );
        }
      }
    }

    void loadSymbolDirectory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const activeSymbols = new Set([...holdingSymbols, ...trackedSymbols]);

    setLiveSecurities((current) => {
      return Object.fromEntries(
        Object.entries(current).filter(([symbol]) => activeSymbols.has(symbol)),
      );
    });
    setQuoteErrors((current) => {
      return Object.fromEntries(
        Object.entries(current).filter(([symbol]) => activeSymbols.has(symbol)),
      );
    });
    setLoadingSymbols((current) => current.filter((symbol) => activeSymbols.has(symbol)));
  }, [holdingSymbolsKey, holdingSymbols, trackedSymbols]);

  const buildQuoteFallbackSecurity = useCallback(
    async (symbol: string, currentLiveSecurities: Record<string, SecuritySeed>) => {
      const { quotes, errors, rateLimited } = await provider.fetchQuoteBatch([symbol]);
      const quote = quotes[symbol];

      if (!quote) {
        if (rateLimited) {
          throw new YahooRateLimitError();
        }

        throw new Error(errors[symbol] ?? 'No live quote data returned for symbol.');
      }

      return {
        quote,
        security: applyQuoteToSecurity(
          fallbackSecurityForSymbol(symbol, holdings, currentLiveSecurities),
          quote,
        ),
      };
    },
    [holdings, provider],
  );

  const notifyRateLimit = useCallback(() => {
    if (rateLimitToastShownRef.current) {
      return;
    }

    addToast(new YahooRateLimitError().message, 'warning');
    rateLimitToastShownRef.current = true;
  }, [addToast]);

  const fetchFullSymbol = useCallback(
    async (inputSymbol: string) => {
      const symbol = normalizeSymbol(inputSymbol);

      if (!symbol) {
        return;
      }

      setTrackedSymbols((current) => [...new Set([...current, symbol])]);
      setLoadingSymbols((current) => [...new Set([...current, symbol])]);

      try {
        const seed = fallbackSecurityForSymbol(symbol, holdings, liveSecurities);
        const record = await provider.fetchSecurityRecord(seed);
        const quoteBatch = await provider.fetchQuoteBatch([symbol]);
        const quote = quoteBatch.quotes[symbol];
        if (quoteBatch.rateLimited) {
          notifyRateLimit();
        } else if (quote) {
          rateLimitToastShownRef.current = false;
        }

        const baseSeed = baseDataset.securities.find((security) => security.symbol === symbol);
        const merged = record.priceSnapshot
          ? baseSeed
            ? mergeSecurityWithLiveData(
                baseSeed,
                record.priceSnapshot,
                record.sector,
                record.fundamentalsSnapshot,
              )
            : buildSecurityFromLiveData(
                symbol,
                record.priceSnapshot,
                record.sector,
                record.fundamentalsSnapshot,
              )
          : (await buildQuoteFallbackSecurity(symbol, liveSecurities)).security;
        const sessionAwareSecurity = quote ? applyQuoteToSecurity(merged, quote) : merged;

        setLiveSecurities((current) => ({
          ...current,
          [symbol]: sessionAwareSecurity,
        }));
        if (quote) {
          setLiveQuotes((current) => ({
            ...current,
            [symbol]: quote,
          }));
        }
        setLastQuoteRefreshAt(new Date().toISOString());
        setQuoteErrors((current) => {
          const next = { ...current };
          if (quoteBatch.errors[symbol]) {
            next[symbol] = quoteBatch.errors[symbol];
          } else {
            delete next[symbol];
          }
          return next;
        });
      } catch (error) {
        if (error instanceof YahooRateLimitError) {
          notifyRateLimit();
        }

        try {
          const quoteBacked = await buildQuoteFallbackSecurity(symbol, liveSecurities);

          setLiveSecurities((current) => ({
            ...current,
            [symbol]: quoteBacked.security,
          }));
          setLiveQuotes((current) => ({
            ...current,
            [symbol]: quoteBacked.quote,
          }));
          setLastQuoteRefreshAt(new Date().toISOString());
          rateLimitToastShownRef.current = false;
          setQuoteErrors((current) => {
            const next = { ...current };
            delete next[symbol];
            return next;
          });
        } catch (quoteError) {
          if (quoteError instanceof YahooRateLimitError) {
            notifyRateLimit();
          }

          setLiveSecurities((current) => ({
            ...current,
            [symbol]: fallbackSecurityForSymbol(symbol, holdings, current),
          }));
          setQuoteErrors((current) => ({
            ...current,
            [symbol]:
              (quoteError as Error).message ||
              (error as Error).message ||
              'Yahoo quote refresh failed.',
          }));
        }
      } finally {
        setLoadingSymbols((current) => current.filter((item) => item !== symbol));
      }
    },
    [buildQuoteFallbackSecurity, holdings, liveSecurities, notifyRateLimit, provider],
  );

  useEffect(() => {
    holdingSymbols.forEach((symbol) => {
      if (!liveSecurities[symbol]) {
        void fetchFullSymbol(symbol);
      }
    });
  }, [fetchFullSymbol, holdingSymbols, liveSecurities]);

  const refreshHeldQuotes = useCallback(async () => {
    if (holdingSymbols.length === 0) {
      return;
    }

    try {
      const { quotes, errors, rateLimited } = await provider.fetchQuoteBatch(holdingSymbols);

      setLiveQuotes((current) => ({
        ...current,
        ...quotes,
      }));
      setLiveSecurities((current) => {
        const next = { ...current };

        holdingSymbols.forEach((symbol) => {
          const quote = quotes[symbol];

          if (!quote) {
            return;
          }

          next[symbol] = applyQuoteToSecurity(
            fallbackSecurityForSymbol(symbol, holdings, current),
            quote,
          );
        });

        return next;
      });
      setLastQuoteRefreshAt(new Date().toISOString());

      setQuoteErrors((current) => {
        const next = { ...current };
        holdingSymbols.forEach((symbol) => {
          if (quotes[symbol]) {
            delete next[symbol];
          } else if (errors[symbol]) {
            next[symbol] = errors[symbol];
          } else if (!next[symbol]) {
            next[symbol] = 'No live quote data returned for symbol.';
          }
        });
        return next;
      });

      if (rateLimited) {
        notifyRateLimit();
      } else if (Object.keys(quotes).length > 0) {
        rateLimitToastShownRef.current = false;
      }
    } catch (error) {
      if (error instanceof YahooRateLimitError) {
        notifyRateLimit();
      }
      setQuoteErrors((current) => {
        const next = { ...current };
        holdingSymbols.forEach((symbol) => {
          if (!next[symbol]) {
            next[symbol] = `Yahoo quote refresh failed: ${(error as Error).message}`;
          }
        });
        return next;
      });
    }
  }, [holdingSymbols, holdings, notifyRateLimit, provider]);

  useEffect(() => {
    if (holdingSymbols.length === 0) {
      return undefined;
    }

    void refreshHeldQuotes();
    const intervalId = window.setInterval(() => {
      void refreshHeldQuotes();
    }, quotePollIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [holdingSymbolsKey, holdingSymbols.length, refreshHeldQuotes]);

  const dataset = useMemo<MockDataset>(() => {
    const holdingsWatchlist =
      holdingSymbols.length > 0
        ? {
            id: 'runtime-holdings',
            name: 'My Holdings',
            symbols: holdingSymbols,
            notes: 'Auto-generated from current positions.',
          }
        : null;
    const runtimeWatchlists = holdingsWatchlist
      ? [holdingsWatchlist, ...watchlists]
      : watchlists;
    const liveUniverse = Object.values(liveSecurities);
    const trackedUniverseSymbols = [...new Set([...holdingSymbols, ...trackedSymbols])];
    const provisionalUniverse = trackedUniverseSymbols
      .filter(
        (symbol) =>
          !baseDataset.securities.some((security) => security.symbol === symbol) &&
          !liveUniverse.some((security) => security.symbol === symbol),
      )
      .map((symbol) =>
        createProvisionalSecurity(
          symbol,
          holdings.find((holding) => holding.symbol === symbol)?.costBasis ?? 100,
        ),
      );

    return {
      ...baseDataset,
      user: {
        ...baseDataset.user,
        ...userSettings,
        name: 'You',
        investableCash,
      },
      holdings,
      transactions,
      ledgerBaseline: transactions.length > 0 ? ledgerBaseline ?? createLedgerBaseline(baseHoldings, baseInvestableCash) : undefined,
      watchlists: runtimeWatchlists,
      journal,
      securities: [
        ...baseDataset.securities.map(
          (security) => liveSecurities[security.symbol] ?? security,
        ),
        ...provisionalUniverse,
        ...liveUniverse.filter(
          (security) =>
            !baseDataset.securities.some((existing) => existing.symbol === security.symbol),
        ),
      ],
      dataMode:
        holdingSymbols.length > 0
          ? liveUniverse.length === holdingSymbols.length
            ? 'live'
            : 'blended'
          : baseDataset.dataMode,
      syncNotes: [
        ...(baseDataset.syncNotes ?? []),
        transactions.length > 0
          ? `Transaction ledger is active with ${transactions.length} recorded event${transactions.length === 1 ? '' : 's'}.`
          : 'Transaction ledger is not active yet; holdings and cash are being treated as the current baseline.',
        holdingSymbols.length > 0
          ? `Yahoo quote polling active for held symbols every ${quotePollIntervalMs / 1000} seconds.`
          : 'No user-added runtime holdings loaded.',
      ],
    };
  }, [
    baseHoldings,
    baseInvestableCash,
    holdingSymbols,
    holdings,
    investableCash,
    journal,
    ledgerBaseline,
    liveSecurities,
    trackedSymbols,
    transactions,
    userSettings,
    watchlists,
  ]);

  const model = useMemo(() => buildCommandCenterModel(dataset), [dataset]);

  const reconciliation = useMemo<PortfolioReconciliation | null>(() => {
    const baseReconciliation = buildPortfolioReconciliation({
      brokerSnapshot,
      holdings: model.holdings,
      investableCash,
      portfolioValue: model.portfolioValue,
    });

    if (!baseReconciliation) {
      return null;
    }

    const likelyCauses = [...baseReconciliation.likelyCauses];
    const unavailableSymbols = model.holdings
      .filter((holding) => quoteErrors[holding.symbol])
      .map((holding) => holding.symbol);
    const extendedHoursSymbols = Object.entries(liveQuotes)
      .filter(([, quote]) => quote.session !== 'regular')
      .map(([symbol]) => symbol);

    if (unavailableSymbols.length > 0) {
      likelyCauses.push(
        `Live prices were unavailable for ${unavailableSymbols.join(', ')}, so the app is falling back to older snapshot prices for those names.`,
      );
    }

    if (extendedHoursSymbols.length > 0) {
      likelyCauses.push(
        `Some values are using extended-hours prices (${extendedHoursSymbols.join(', ')}). Broker totals can move faster than public feeds outside the regular session.`,
      );
    }

    if (lastQuoteRefreshAt) {
      likelyCauses.push(`Last public quote refresh: ${new Date(lastQuoteRefreshAt).toLocaleString()}.`);
    }

    return {
      ...baseReconciliation,
      likelyCauses: [...new Set(likelyCauses)],
    };
  }, [brokerSnapshot, investableCash, lastQuoteRefreshAt, liveQuotes, model.holdings, model.portfolioValue, quoteErrors]);

  useEffect(() => {
    const snapshot = buildRecommendationRunSnapshot(model);
    setRecommendationHistory((prev) => {
      const next = mergeRecommendationHistory(prev, snapshot);
      const previousRun = next.length > 1 ? next[next.length - 2] : undefined;
      const auditEntries = buildDecisionAuditEntries(previousRun, snapshot);
      if (auditEntries.length > 0) {
        setDecisionAuditLog((current) => mergeDecisionAuditLog(current, auditEntries));
      }

      return next;
    });
  }, [model]);

  useEffect(() => {
    const holdingsValue = model.holdings.reduce((total, holding) => total + holding.marketValue, 0);
    const snapshot = buildPortfolioSnapshot(
      model.portfolioValue,
      holdingsValue,
      investableCash,
      holdings,
    );

    if (!shouldCaptureSnapshot(snapshot)) {
      return;
    }

    setPortfolioHistory((current) => {
      const intraday = mergeSnapshotIntoSeries(current.intraday, {
        ...snapshot,
        granularity: 'intraday',
      });
      const daily = mergeSnapshotIntoSeries(current.daily, {
        ...snapshot,
        granularity: 'daily',
      });

      if (intraday === current.intraday && daily === current.daily) {
        return current;
      }

      return {
        intraday,
        daily,
      };
    });
  }, [holdings, investableCash, model.holdings, model.portfolioValue]);

  const generateId = useCallback(() => {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  const addHolding = useCallback(
    async ({
      symbol,
      shares,
      costBasis,
      journalEntry,
    }: {
      symbol: string;
      shares: number;
      costBasis: number;
      journalEntry?: { userThesis: string; invalidationRule: string; systemSummary?: string };
    }) => {
      const normalized = normalizeSymbol(symbol);

      if (!normalized) {
        return;
      }

      setBaseHoldings((current) => {
        const existing = current.find((holding) => holding.symbol === normalized);

        if (existing) {
          return current.map((holding) =>
            holding.symbol === normalized
              ? {
                  ...holding,
                  shares,
                  costBasis,
                }
              : holding,
          );
        }

        return [
          ...current,
          {
            symbol: normalized,
            shares,
            costBasis,
            styleTags: [],
            thesisTags: [],
            entryDate: new Date().toISOString().slice(0, 10),
          },
        ];
      });

      if (journalEntry?.userThesis?.trim()) {
        setJournal((current) => [
          ...current,
          {
            id: generateId(),
            symbol: normalized,
            decisionDate: new Date().toISOString().slice(0, 10),
            decisionType: 'Buy',
            userThesis: journalEntry.userThesis.trim(),
            invalidationRule: journalEntry.invalidationRule?.trim() ?? '',
            systemSummary: journalEntry.systemSummary?.trim() ?? '',
            outcome: '',
          },
        ]);
      }

      void fetchFullSymbol(normalized);
      addToast(`Added ${normalized} to portfolio`, 'success');
    },
    [addToast, fetchFullSymbol, generateId],
  );

  const removeHolding = useCallback((symbol: string) => {
    const normalized = normalizeSymbol(symbol);
    setBaseHoldings((current) => current.filter((holding) => holding.symbol !== normalized));
  }, []);

  const setInvestableCash = useCallback((value: number) => {
    setBaseInvestableCashState(value);
  }, []);

  const addTransaction = useCallback(
    (
      input: Omit<PortfolioTransaction, 'id' | 'source'> & { source?: PortfolioTransaction['source'] },
    ) => {
      const normalizedSymbol = input.symbol ? normalizeSymbol(input.symbol) : undefined;
      const nextTransaction: PortfolioTransaction = {
        ...input,
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        symbol: normalizedSymbol,
        source: input.source ?? 'manual',
      };

      if (
        nextTransaction.kind === 'buy' &&
        normalizedSymbol &&
        !baseDataset.securities.some((security) => security.symbol === normalizedSymbol) &&
        !liveSecurities[normalizedSymbol]
      ) {
        void fetchFullSymbol(normalizedSymbol);
      }

      setTransactions((current) => [...current, nextTransaction]);
      setLedgerBaseline((current) => current ?? createLedgerBaseline(baseHoldings, baseInvestableCash));
    },
    [baseHoldings, baseInvestableCash, fetchFullSymbol, liveSecurities],
  );

  const removeTransaction = useCallback((id: string) => {
    setTransactions((current) => current.filter((transaction) => transaction.id !== id));
  }, []);

  const clearTransactions = useCallback(() => {
    setTransactions([]);
    setLedgerBaseline(null);
  }, []);

  const appendImportedTransactions = useCallback((importedTransactions: PortfolioTransaction[]) => {
    const normalizedTransactions = importedTransactions
      .map(normalizeTransaction)
      .filter((transaction): transaction is PortfolioTransaction => transaction !== null);

    const result = mergeImportedTransactions(transactions, normalizedTransactions);
    setTransactions(result.transactions);
    setLedgerBaseline((current) => current ?? createLedgerBaseline(baseHoldings, baseInvestableCash));

    return { added: result.added, skipped: result.skipped };
  }, [baseHoldings, baseInvestableCash, transactions]);

  const replaceTransactionsWithImport = useCallback(
    (
      importedTransactions: PortfolioTransaction[],
      options?: { resetBaseline?: boolean },
    ) => {
      const normalizedTransactions = importedTransactions
        .map(normalizeTransaction)
        .filter((transaction): transaction is PortfolioTransaction => transaction !== null);
      const uniqueImport = mergeImportedTransactions([], normalizedTransactions);

      if (options?.resetBaseline) {
        setBaseHoldings([]);
        setBaseInvestableCashState(0);
        setLedgerBaseline(createLedgerBaseline([], 0));
      } else {
        setLedgerBaseline(createLedgerBaseline(baseHoldings, baseInvestableCash));
      }

      setTransactions(uniqueImport.transactions);

      return { added: uniqueImport.added, skipped: uniqueImport.skipped };
    },
    [baseHoldings, baseInvestableCash],
  );

  const saveBrokerSnapshot = useCallback((snapshot: BrokerImportSnapshot) => {
    setBrokerSnapshot(normalizeBrokerSnapshot(snapshot));
  }, []);

  const applyBrokerSnapshot = useCallback(
    (snapshot: BrokerImportSnapshot) => {
      const normalized = normalizeBrokerSnapshot(snapshot);

      if (!normalized) {
        return;
      }

      setBrokerSnapshot(normalized);
      setBaseHoldings(
        normalized.positions.map((position) => ({
          symbol: position.symbol,
          shares: position.shares,
          costBasis:
            position.costBasis ??
            position.marketPrice ??
            ((position.marketValue ?? 0) / Math.max(position.shares, 1)),
          styleTags: [],
          thesisTags: [],
          entryDate: new Date().toISOString().slice(0, 10),
        })),
      );
      setBaseInvestableCashState(normalized.cash ?? baseInvestableCash);
      setTransactions([]);
      setLedgerBaseline(null);
      normalized.positions.forEach((position) => {
        void fetchFullSymbol(position.symbol);
      });
    },
    [baseInvestableCash, fetchFullSymbol],
  );

  const clearBrokerSnapshot = useCallback(() => {
    setBrokerSnapshot(null);
  }, []);

  const updateUserSettings = useCallback(
    (
      update:
        | Partial<EditableUserSettings>
        | ((current: EditableUserSettings) => EditableUserSettings),
    ) => {
      setUserSettings((current) =>
        normalizeUserSettings(
          typeof update === 'function'
            ? update(current)
            : {
                ...current,
                ...update,
              },
        ),
      );
    },
    [],
  );

  const resetUserSettings = useCallback(() => {
    setUserSettings(defaultUserSettings());
  }, []);

  const setTheme = useCallback((nextTheme: AppTheme) => {
    setThemeState(normalizeTheme(nextTheme));
  }, []);

  const addJournalEntry = useCallback(
    (entry: Omit<JournalEntry, 'id'>) => {
      const normalized = {
        ...entry,
        id: generateId(),
        symbol: normalizeSymbol(entry.symbol) || entry.symbol,
      };
      setJournal((current) => [...current, normalizeJournalEntry(normalized)!]);
    },
    [generateId],
  );

  const updateJournalEntry = useCallback((id: string, update: Partial<Omit<JournalEntry, 'id'>>) => {
    setJournal((current) =>
      current.map((e) =>
        e.id === id
          ? normalizeJournalEntry({ ...e, ...update }) ?? e
          : e,
      ),
    );
  }, []);

  const removeJournalEntry = useCallback((id: string) => {
    setJournal((current) => current.filter((e) => e.id !== id));
  }, []);

  const addWatchlist = useCallback(
    (watchlist: Omit<Watchlist, 'id'>) => {
      const id = `wl-${generateId().slice(0, 8)}`;
      const normalized = normalizeWatchlist({ ...watchlist, id });
      if (normalized) {
        setWatchlists((current) => [...current, normalized]);
      }
    },
    [generateId],
  );

  const updateWatchlist = useCallback((id: string, update: Partial<Omit<Watchlist, 'id'>>) => {
    setWatchlists((current) =>
      current.map((w) =>
        w.id === id ? (normalizeWatchlist({ ...w, ...update }) ?? w) : w,
      ),
    );
  }, []);

  const removeWatchlist = useCallback((id: string) => {
    setWatchlists((current) => current.filter((w) => w.id !== id));
  }, []);

  const addSymbolToWatchlist = useCallback((watchlistId: string, symbol: string) => {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return;
    setWatchlists((current) =>
      current.map((w) =>
        w.id === watchlistId
          ? { ...w, symbols: [...new Set([...w.symbols, normalized])] }
          : w,
      ),
    );
    addToast(`Added ${normalized} to watchlist`, 'success');
  }, [addToast]);

  const removeSymbolFromWatchlist = useCallback((watchlistId: string, symbol: string) => {
    const normalized = normalizeSymbol(symbol);
    setWatchlists((current) =>
      current.map((w) =>
        w.id === watchlistId
          ? { ...w, symbols: w.symbols.filter((s) => s !== normalized) }
          : w,
      ),
    );
  }, []);

  const value = useMemo<PortfolioWorkspaceValue>(
    () => ({
      dataset,
      model,
      symbolDirectory,
      symbolDirectoryState,
      symbolDirectoryError,
      holdings,
      investableCash,
      addHolding,
      removeHolding,
      setInvestableCash,
      transactions,
      ledgerBaseline,
      ledgerSummary: accounting.summary,
      addTransaction,
      removeTransaction,
      clearTransactions,
      appendImportedTransactions,
      replaceTransactionsWithImport,
      userSettings,
      updateUserSettings,
      resetUserSettings,
      theme,
      setTheme,
      journal,
      addJournalEntry,
      updateJournalEntry,
      removeJournalEntry,
      watchlists,
      addWatchlist,
      updateWatchlist,
      removeWatchlist,
      addSymbolToWatchlist,
      removeSymbolFromWatchlist,
      ensureLiveSecurity: fetchFullSymbol,
      loadingSymbols,
      quoteErrors,
      liveQuotes,
      livePriceSymbols: Object.keys(liveQuotes),
      lastQuoteRefreshAt,
      brokerSnapshot,
      saveBrokerSnapshot,
      applyBrokerSnapshot,
      clearBrokerSnapshot,
      reconciliation,
      portfolioHistory,
      recommendationHistory,
      decisionAuditLog,
    }),
    [
      addHolding,
      addJournalEntry,
      addSymbolToWatchlist,
      addTransaction,
      addWatchlist,
      appendImportedTransactions,
      applyBrokerSnapshot,
      clearTransactions,
      clearBrokerSnapshot,
      dataset,
      holdings,
      investableCash,
      journal,
      lastQuoteRefreshAt,
      loadingSymbols,
      model,
      portfolioHistory,
      quoteErrors,
      liveQuotes,
      recommendationHistory,
      decisionAuditLog,
      reconciliation,
      removeHolding,
      removeJournalEntry,
      removeSymbolFromWatchlist,
      removeTransaction,
      removeWatchlist,
      replaceTransactionsWithImport,
      fetchFullSymbol,
      resetUserSettings,
      saveBrokerSnapshot,
      setInvestableCash,
      setTheme,
      symbolDirectory,
      symbolDirectoryError,
      symbolDirectoryState,
      theme,
      transactions,
      ledgerBaseline,
      accounting.summary,
      brokerSnapshot,
      updateJournalEntry,
      updateUserSettings,
      updateWatchlist,
      userSettings,
      watchlists,
    ],
  );

  return (
    <PortfolioWorkspaceContext.Provider value={value}>
      {children}
    </PortfolioWorkspaceContext.Provider>
  );
}
