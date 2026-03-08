import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildCommandCenterModel } from '../domain/engine';
import { currentDataset as baseDataset } from '../data/currentDataset';
import type {
  Holding,
  MockDataset,
  PortfolioHistoryGranularity,
  PortfolioHistorySnapshot,
  PortfolioHistoryStore,
  SecuritySeed,
  SymbolDirectoryEntry,
} from '../domain/types';
import { normalizeSymbol } from '../lib/symbols';
import { YahooPublicProvider } from '../live/yahooPublic';
import type { PortfolioWorkspaceValue } from './portfolioContext';
import { PortfolioWorkspaceContext } from './portfolioContext';
import {
  fetchSharedPortfolioHistory,
  mergePortfolioHistoryStores,
  normalizePortfolioHistory,
  persistSharedPortfolioHistory,
} from './sharedStorage';
import {
  applyQuoteToSecurity,
  buildSecurityFromLiveData,
  createProvisionalSecurity,
  mergeSecurityWithLiveData,
} from './securityFactory';

interface PersistedState {
  investableCash: number;
  holdings: Holding[];
}

const storageKey = 'investment-center-user-portfolio-v1';
const historyStorageKey = 'investment-center-portfolio-history-v1';
const quotePollIntervalMs = 5_000;
const intradayBucketMinutes = 15;
const intradayRetentionDays = 14;
const dailyRetentionDays = 400;

function defaultState(): PersistedState {
  return {
    investableCash: 0,
    holdings: [],
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
  const initial = loadPersistedState();
  const [holdings, setHoldings] = useState<Holding[]>(initial.holdings);
  const [investableCash, setInvestableCashState] = useState(initial.investableCash);
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
  const [loadingSymbols, setLoadingSymbols] = useState<string[]>([]);
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});
  const [lastQuoteRefreshAt, setLastQuoteRefreshAt] = useState<string | null>(null);

  const provider = useMemo(() => new YahooPublicProvider(), []);
  const holdingSymbols = useMemo(
    () => [...new Set(holdings.map((holding) => normalizeSymbol(holding.symbol)).filter(Boolean))],
    [holdings],
  );
  const holdingSymbolsKey = holdingSymbols.join('|');

  useEffect(() => {
    persistState({ holdings, investableCash });
  }, [holdings, investableCash]);

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

      return applyQuoteToSecurity(
        fallbackSecurityForSymbol(symbol, holdings, currentLiveSecurities),
        quote,
      );
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
          : await buildQuoteFallbackSecurity(symbol, liveSecurities);

        setLiveSecurities((current) => ({
          ...current,
          [symbol]: merged,
        }));
        setLastQuoteRefreshAt(new Date().toISOString());
        setQuoteErrors((current) => {
          const next = { ...current };
          delete next[symbol];
          return next;
        });
      } catch (error) {
        try {
          const quoteBackedSecurity = await buildQuoteFallbackSecurity(symbol, liveSecurities);

          setLiveSecurities((current) => ({
            ...current,
            [symbol]: quoteBackedSecurity,
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
  }, [holdingSymbols, holdings, provider]);

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
    const runtimeWatchlists =
      holdingSymbols.length > 0
        ? [
            {
              id: 'runtime-holdings',
              name: 'My Holdings',
              symbols: holdingSymbols,
              notes: 'Auto-generated from current positions.',
            },
          ]
        : [];
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
        name: 'You',
        investableCash,
      },
      holdings,
      watchlists: runtimeWatchlists,
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
        holdingSymbols.length > 0
          ? `Yahoo quote polling active for held symbols every ${quotePollIntervalMs / 1000} seconds.`
          : 'No user-added runtime holdings loaded.',
      ],
    };
  }, [holdingSymbols, holdings, investableCash, liveSecurities]);

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

  const addHolding = useCallback(
    async ({
      symbol,
      shares,
      costBasis,
    }: {
      symbol: string;
      shares: number;
      costBasis: number;
    }) => {
      const normalized = normalizeSymbol(symbol);

      if (!normalized) {
        return;
      }

      setHoldings((current) => {
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

      void fetchFullSymbol(normalized);
    },
    [fetchFullSymbol],
  );

  const removeHolding = useCallback((symbol: string) => {
    const normalized = normalizeSymbol(symbol);
    setHoldings((current) => current.filter((holding) => holding.symbol !== normalized));
  }, []);

  const setInvestableCash = useCallback((value: number) => {
    setInvestableCashState(value);
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
      ensureLiveSecurity: fetchFullSymbol,
      loadingSymbols,
      quoteErrors,
      livePriceSymbols: Object.keys(liveSecurities),
      lastQuoteRefreshAt,
      portfolioHistory,
    }),
    [
      addHolding,
      dataset,
      holdings,
      investableCash,
      lastQuoteRefreshAt,
      liveSecurities,
      loadingSymbols,
      model,
      portfolioHistory,
      quoteErrors,
      removeHolding,
      fetchFullSymbol,
      setInvestableCash,
      symbolDirectory,
      symbolDirectoryError,
      symbolDirectoryState,
    ],
  );

  return (
    <PortfolioWorkspaceContext.Provider value={value}>
      {children}
    </PortfolioWorkspaceContext.Provider>
  );
}
