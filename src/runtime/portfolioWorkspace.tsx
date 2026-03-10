import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildCommandCenterModel } from '../domain/engine';
import { currentDataset as baseDataset } from '../data/currentDataset';
import type {
  AppTheme,
  EditableUserSettings,
  Holding,
  JournalEntry,
  LedgerBaseline,
  MockDataset,
  PortfolioHistoryGranularity,
  PortfolioHistorySnapshot,
  PortfolioHistoryStore,
  PortfolioTransaction,
  SecuritySeed,
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
  userSettings: EditableUserSettings;
  theme: AppTheme;
  journal: JournalEntry[];
  watchlists: Watchlist[];
}

const storageKey = 'investment-center-user-portfolio-v1';
const historyStorageKey = 'investment-center-portfolio-history-v1';
const quotePollIntervalMs = 5_000;
const intradayBucketMinutes = 15;
const intradayRetentionDays = 14;
const dailyRetentionDays = 400;
const availableRiskTolerances = ['low', 'moderate', 'moderate-aggressive', 'aggressive'] as const;
const availableThemes = ['emerald', 'cobalt', 'amber', 'rose', 'graphite'] as const;
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
    userSettings: defaultUserSettings(),
    theme: defaultTheme(),
    journal: [],
    watchlists: [],
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

function loadPersistedState(): PersistedState {
  if (typeof window === 'undefined') {
    return defaultState();
  }

  const raw = window.localStorage.getItem(storageKey);

  if (!raw) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(raw) as PersistedState;
    return {
      investableCash: parsed.investableCash ?? 0,
      holdings: Array.isArray(parsed.holdings)
        ? parsed.holdings.map(normalizeHolding).filter((holding) => holding.symbol)
        : [],
      transactions: Array.isArray(parsed.transactions)
        ? parsed.transactions.map(normalizeTransaction).filter((transaction): transaction is PortfolioTransaction => transaction !== null)
        : [],
      ledgerBaseline: normalizeLedgerBaseline(parsed.ledgerBaseline),
      userSettings: normalizeUserSettings(parsed.userSettings),
      theme: normalizeTheme(parsed.theme),
      journal:
        Array.isArray(parsed.journal) && parsed.journal.length > 0
          ? parsed.journal.map(normalizeJournalEntry).filter((e): e is JournalEntry => e !== null)
          : (baseDataset.journal ?? []).map(normalizeJournalEntry).filter((e): e is JournalEntry => e !== null),
      watchlists:
        Array.isArray(parsed.watchlists) && parsed.watchlists.length > 0
          ? parsed.watchlists.map(normalizeWatchlist).filter((w): w is Watchlist => w !== null)
          : (baseDataset.watchlists ?? []).map(normalizeWatchlist).filter((w): w is Watchlist => w !== null),
    };
  } catch {
    return defaultState();
  }
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
  const [loadingSymbols, setLoadingSymbols] = useState<string[]>([]);
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});
  const [lastQuoteRefreshAt, setLastQuoteRefreshAt] = useState<string | null>(null);

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
      userSettings,
      journal,
      watchlists,
      theme,
    });
  }, [baseHoldings, baseInvestableCash, journal, ledgerBaseline, theme, transactions, userSettings, watchlists]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
    const activeSymbols = new Set(holdingSymbols);

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
  }, [holdingSymbolsKey, holdingSymbols]);

  const buildQuoteFallbackSecurity = useCallback(
    async (symbol: string, currentLiveSecurities: Record<string, SecuritySeed>) => {
      const quotes = await provider.fetchQuoteSnapshots([symbol]);
      const quote = quotes[symbol];

      if (!quote) {
        throw new Error('No live quote data returned for symbol.');
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

  const fetchFullSymbol = useCallback(
    async (inputSymbol: string) => {
      const symbol = normalizeSymbol(inputSymbol);

      if (!symbol) {
        return;
      }

      setLoadingSymbols((current) => [...new Set([...current, symbol])]);

      try {
        const seed = fallbackSecurityForSymbol(symbol, holdings, liveSecurities);
        const record = await provider.fetchSecurityRecord(seed);
        const quotes = await provider.fetchQuoteSnapshots([symbol]);
        const quote = quotes[symbol];

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
          delete next[symbol];
          return next;
        });
      } catch (error) {
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
          setQuoteErrors((current) => {
            const next = { ...current };
            delete next[symbol];
            return next;
          });
        } catch (quoteError) {
          setLiveSecurities((current) => ({
            ...current,
            [symbol]: fallbackSecurityForSymbol(symbol, holdings, current),
          }));
          setQuoteErrors((current) => ({
            ...current,
            [symbol]: (quoteError as Error).message || (error as Error).message,
          }));
        }
      } finally {
        setLoadingSymbols((current) => current.filter((item) => item !== symbol));
      }
    },
    [buildQuoteFallbackSecurity, holdings, liveSecurities, provider],
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
      const quotes = await provider.fetchQuoteSnapshots(holdingSymbols);

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
          }
        });
        return next;
      });
    } catch (error) {
      if (error instanceof YahooRateLimitError) {
        addToast(error.message, 'warning');
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
  }, [addToast, holdingSymbols, holdings, provider]);

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
    const liveUniverse = Object.values(liveSecurities).filter((security) =>
      holdingSymbols.includes(security.symbol),
    );
    const provisionalUniverse = holdingSymbols
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
  }, [baseHoldings, baseInvestableCash, holdingSymbols, holdings, investableCash, journal, ledgerBaseline, liveSecurities, transactions, userSettings, watchlists]);

  const model = useMemo(() => buildCommandCenterModel(dataset), [dataset]);

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
  }, []);

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
      portfolioHistory,
    }),
    [
      addHolding,
      addJournalEntry,
      addSymbolToWatchlist,
      addTransaction,
      addWatchlist,
      clearTransactions,
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
      removeHolding,
      removeJournalEntry,
      removeSymbolFromWatchlist,
      removeTransaction,
      removeWatchlist,
      fetchFullSymbol,
      resetUserSettings,
      setInvestableCash,
      setTheme,
      symbolDirectory,
      symbolDirectoryError,
      symbolDirectoryState,
      theme,
      transactions,
      ledgerBaseline,
      accounting.summary,
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
