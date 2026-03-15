import { useMemo, useRef, useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { mockDataset } from '../data/mockData';
import { buildCommandCenterModel } from '../domain/engine';
import { createLedgerBaseline } from '../domain/portfolioAccounting';
import type {
  AppTheme,
  BrokerImportSnapshot,
  EditableUserSettings,
  Holding,
  JournalEntry,
  LedgerBaseline,
  PortfolioReconciliation,
  PortfolioHistoryStore,
  PortfolioTransaction,
  SymbolDirectoryEntry,
  Watchlist,
} from '../domain/types';
import type { PortfolioWorkspaceValue } from '../runtime/portfolioContext';
import { PortfolioWorkspaceContext } from '../runtime/portfolioContext';
import { ToastProvider } from '../runtime/toastContext';

interface TestWorkspaceOverrides {
  holdings?: Holding[];
  investableCash?: number;
  transactions?: PortfolioTransaction[];
  ledgerBaseline?: LedgerBaseline | null;
  journal?: JournalEntry[];
  watchlists?: Watchlist[];
  userSettings?: Partial<EditableUserSettings>;
  theme?: AppTheme;
  symbolDirectory?: SymbolDirectoryEntry[];
  symbolDirectoryState?: 'loading' | 'ready' | 'error';
  symbolDirectoryError?: string | null;
  ensureLiveSecurity?: PortfolioWorkspaceValue['ensureLiveSecurity'];
  loadingSymbols?: string[];
  quoteErrors?: Record<string, string>;
  liveQuotes?: PortfolioWorkspaceValue['liveQuotes'];
  lastQuoteRefreshAt?: string | null;
  brokerSnapshot?: BrokerImportSnapshot | null;
  reconciliation?: PortfolioReconciliation | null;
}

function defaultUserSettings(): EditableUserSettings {
  return {
    monthlyContribution: mockDataset.user.monthlyContribution,
    timeHorizonMonths: mockDataset.user.timeHorizonMonths,
    riskTolerance: mockDataset.user.riskTolerance,
    targetStrategy: [...mockDataset.user.targetStrategy],
    strategyWeights: { ...mockDataset.user.strategyWeights },
    allowedMarketCaps: [...mockDataset.user.allowedMarketCaps],
    preferredSectors: [...mockDataset.user.preferredSectors],
    excludedSectors: [...mockDataset.user.excludedSectors],
    allowedSecurityTypes: [...mockDataset.user.allowedSecurityTypes],
    maxSinglePositionWeight: mockDataset.user.maxSinglePositionWeight,
    maxSectorWeight: mockDataset.user.maxSectorWeight,
    maxPortfolioDrawdownTolerance: mockDataset.user.maxPortfolioDrawdownTolerance,
    avoidEarningsRisk: mockDataset.user.avoidEarningsRisk,
    avoidDilutionProne: mockDataset.user.avoidDilutionProne,
    avoidCashBurners: mockDataset.user.avoidCashBurners,
    targetCashReserve: mockDataset.user.targetCashReserve,
    preferredHoldingPeriodDays: mockDataset.user.preferredHoldingPeriodDays,
    benchmarkSymbol: mockDataset.user.benchmarkSymbol,
    watchlistNames: [...mockDataset.user.watchlistNames],
    manualTags: [...mockDataset.user.manualTags],
  };
}

function mergeUserSettings(
  current: EditableUserSettings,
  update:
    | Partial<EditableUserSettings>
    | ((current: EditableUserSettings) => EditableUserSettings),
) {
  if (typeof update === 'function') {
    return update(current);
  }

  return {
    ...current,
    ...update,
  };
}

const emptyHistory: PortfolioHistoryStore = {
  intraday: [],
  daily: [],
};

export function TestAppProviders({
  children,
  overrides,
  initialEntries,
}: {
  children: ReactNode;
  overrides?: TestWorkspaceOverrides;
  initialEntries?: string[];
}) {
  const [holdings, setHoldings] = useState<Holding[]>(
    overrides?.holdings ? structuredClone(overrides.holdings) : structuredClone(mockDataset.holdings),
  );
  const [investableCash, setInvestableCash] = useState(
    overrides?.investableCash ?? mockDataset.user.investableCash,
  );
  const [transactions, setTransactions] = useState<PortfolioTransaction[]>(
    overrides?.transactions ? structuredClone(overrides.transactions) : [],
  );
  const [ledgerBaseline] = useState<LedgerBaseline | null>(
    overrides?.ledgerBaseline ?? createLedgerBaseline(holdings, investableCash),
  );
  const [journal, setJournal] = useState<JournalEntry[]>(
    overrides?.journal ? structuredClone(overrides.journal) : [],
  );
  const [watchlists, setWatchlists] = useState<Watchlist[]>(
    overrides?.watchlists ? structuredClone(overrides.watchlists) : [],
  );
  const [userSettings, setUserSettings] = useState<EditableUserSettings>({
    ...defaultUserSettings(),
    ...(overrides?.userSettings ?? {}),
  });
  const [theme, setTheme] = useState<AppTheme>(overrides?.theme ?? 'emerald');
  const journalIdRef = useRef(0);
  const watchlistIdRef = useRef(0);
  const transactionIdRef = useRef(0);

  const dataset = useMemo(() => {
    const nextWatchlistNames = watchlists.map((watchlist) => watchlist.name);

    return {
      ...structuredClone(mockDataset),
      user: {
        ...structuredClone(mockDataset.user),
        ...userSettings,
        investableCash,
        watchlistNames: nextWatchlistNames,
      },
      holdings,
      transactions,
      ledgerBaseline: ledgerBaseline ?? undefined,
      journal,
      watchlists,
    };
  }, [holdings, investableCash, journal, ledgerBaseline, transactions, userSettings, watchlists]);

  const model = useMemo(() => buildCommandCenterModel(dataset), [dataset]);

  const workspace = useMemo<PortfolioWorkspaceValue>(
    () => ({
      dataset,
      model,
      symbolDirectory: overrides?.symbolDirectory ?? [],
      symbolDirectoryState: overrides?.symbolDirectoryState ?? 'ready',
      symbolDirectoryError: overrides?.symbolDirectoryError ?? null,
      holdings,
      investableCash,
      addHolding: async (input) => {
        const journalEntry = input.journalEntry;

        setHoldings((current) => {
          const symbol = input.symbol.toUpperCase();
          const existingIndex = current.findIndex((holding) => holding.symbol === symbol);
          const nextHolding: Holding = {
            symbol,
            shares: input.shares,
            costBasis: input.costBasis,
            styleTags: [],
            thesisTags: [],
            entryDate: new Date().toISOString().slice(0, 10),
          };

          if (existingIndex === -1) {
            return [...current, nextHolding];
          }

          const next = [...current];
          next[existingIndex] = { ...next[existingIndex], ...nextHolding };
          return next;
        });
        if (journalEntry) {
          setJournal((current) => [
            ...current,
            {
              id: `journal-${journalIdRef.current += 1}`,
              symbol: input.symbol.toUpperCase(),
              decisionDate: new Date().toISOString().slice(0, 10),
              decisionType: 'Buy',
              userThesis: journalEntry.userThesis,
              invalidationRule: journalEntry.invalidationRule,
              systemSummary: journalEntry.systemSummary ?? '',
              outcome: '',
            },
          ]);
        }
      },
      removeHolding: (symbol) => {
        setHoldings((current) => current.filter((holding) => holding.symbol !== symbol));
      },
      setInvestableCash,
      transactions,
      ledgerBaseline,
      ledgerSummary: model.ledgerSummary,
      addTransaction: (input) => {
        setTransactions((current) => [
          ...current,
          {
            ...input,
            id: `txn-${transactionIdRef.current += 1}`,
            source: input.source ?? 'manual',
          },
        ]);
      },
      removeTransaction: (id) => {
        setTransactions((current) => current.filter((transaction) => transaction.id !== id));
      },
      clearTransactions: () => {
        setTransactions([]);
      },
      appendImportedTransactions: () => ({ added: 0, skipped: 0 }),
      replaceTransactionsWithImport: () => ({ added: 0, skipped: 0 }),
      userSettings,
      updateUserSettings: (update) => {
        setUserSettings((current) => mergeUserSettings(current, update));
      },
      resetUserSettings: () => {
        setUserSettings(defaultUserSettings());
      },
      theme,
      setTheme,
      journal,
      addJournalEntry: (entry) => {
        setJournal((current) => [
          ...current,
          {
            ...entry,
            id: `journal-${journalIdRef.current += 1}`,
          },
        ]);
      },
      updateJournalEntry: (id, update) => {
        setJournal((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, ...update } : entry)),
        );
      },
      removeJournalEntry: (id) => {
        setJournal((current) => current.filter((entry) => entry.id !== id));
      },
      watchlists,
      addWatchlist: (watchlist) => {
        setWatchlists((current) => [
          ...current,
          {
            ...watchlist,
            id: `watchlist-${watchlistIdRef.current += 1}`,
          },
        ]);
      },
      updateWatchlist: (id, update) => {
        setWatchlists((current) =>
          current.map((watchlist) => (watchlist.id === id ? { ...watchlist, ...update } : watchlist)),
        );
      },
      removeWatchlist: (id) => {
        setWatchlists((current) => current.filter((watchlist) => watchlist.id !== id));
      },
      addSymbolToWatchlist: (watchlistId, symbol) => {
        setWatchlists((current) =>
          current.map((watchlist) =>
            watchlist.id === watchlistId
              ? {
                  ...watchlist,
                  symbols: [...new Set([...watchlist.symbols, symbol.toUpperCase()])],
                }
              : watchlist,
          ),
        );
      },
      removeSymbolFromWatchlist: (watchlistId, symbol) => {
        setWatchlists((current) =>
          current.map((watchlist) =>
            watchlist.id === watchlistId
              ? {
                  ...watchlist,
                  symbols: watchlist.symbols.filter((candidate) => candidate !== symbol),
                }
              : watchlist,
          ),
        );
      },
      ensureLiveSecurity: overrides?.ensureLiveSecurity ?? (async () => {}),
      loadingSymbols: overrides?.loadingSymbols ?? [],
      quoteErrors: overrides?.quoteErrors ?? {},
      liveQuotes: overrides?.liveQuotes ?? {},
      livePriceSymbols: Object.keys(overrides?.liveQuotes ?? {}),
      lastQuoteRefreshAt: overrides?.lastQuoteRefreshAt ?? null,
      brokerSnapshot: overrides?.brokerSnapshot ?? null,
      saveBrokerSnapshot: () => {},
      applyBrokerSnapshot: () => {},
      clearBrokerSnapshot: () => {},
      reconciliation: overrides?.reconciliation ?? null,
      portfolioHistory: emptyHistory,
      recommendationHistory: [],
      decisionAuditLog: [],
    }),
    [
      dataset,
      holdings,
      investableCash,
      journal,
      ledgerBaseline,
      model,
      overrides,
      theme,
      transactions,
      userSettings,
      watchlists,
    ],
  );

  return (
    <MemoryRouter initialEntries={initialEntries}>
      <ToastProvider>
        <PortfolioWorkspaceContext.Provider value={workspace}>
          {children}
        </PortfolioWorkspaceContext.Provider>
      </ToastProvider>
    </MemoryRouter>
  );
}
