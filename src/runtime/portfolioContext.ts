import { createContext, useContext } from 'react';
import type { buildCommandCenterModel } from '../domain/engine';
import type {
  AppTheme,
  EditableUserSettings,
  Holding,
  JournalEntry,
  LedgerBaseline,
  MockDataset,
  PortfolioLedgerSummary,
  PortfolioHistoryStore,
  PortfolioTransaction,
  SymbolDirectoryEntry,
  Watchlist,
} from '../domain/types';
import type { LiveQuoteSnapshot } from '../live/types';

export interface PortfolioWorkspaceValue {
  dataset: MockDataset;
  model: ReturnType<typeof buildCommandCenterModel>;
  symbolDirectory: SymbolDirectoryEntry[];
  symbolDirectoryState: 'loading' | 'ready' | 'error';
  symbolDirectoryError: string | null;
  holdings: Holding[];
  investableCash: number;
  addHolding: (input: {
    symbol: string;
    shares: number;
    costBasis: number;
    journalEntry?: { userThesis: string; invalidationRule: string; systemSummary?: string };
  }) => Promise<void>;
  removeHolding: (symbol: string) => void;
  setInvestableCash: (value: number) => void;
  transactions: PortfolioTransaction[];
  ledgerBaseline: LedgerBaseline | null;
  ledgerSummary: PortfolioLedgerSummary;
  addTransaction: (
    input: Omit<PortfolioTransaction, 'id' | 'source'> & { source?: PortfolioTransaction['source'] },
  ) => void;
  removeTransaction: (id: string) => void;
  clearTransactions: () => void;
  userSettings: EditableUserSettings;
  updateUserSettings: (
    update:
      | Partial<EditableUserSettings>
      | ((current: EditableUserSettings) => EditableUserSettings),
  ) => void;
  resetUserSettings: () => void;
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  journal: JournalEntry[];
  addJournalEntry: (entry: Omit<JournalEntry, 'id'>) => void;
  updateJournalEntry: (id: string, update: Partial<Omit<JournalEntry, 'id'>>) => void;
  removeJournalEntry: (id: string) => void;
  watchlists: Watchlist[];
  addWatchlist: (watchlist: Omit<Watchlist, 'id'>) => void;
  updateWatchlist: (id: string, update: Partial<Omit<Watchlist, 'id'>>) => void;
  removeWatchlist: (id: string) => void;
  addSymbolToWatchlist: (watchlistId: string, symbol: string) => void;
  removeSymbolFromWatchlist: (watchlistId: string, symbol: string) => void;
  ensureLiveSecurity: (symbol: string) => Promise<void>;
  loadingSymbols: string[];
  quoteErrors: Record<string, string>;
  liveQuotes: Record<string, LiveQuoteSnapshot>;
  livePriceSymbols: string[];
  lastQuoteRefreshAt: string | null;
  portfolioHistory: PortfolioHistoryStore;
}

export const PortfolioWorkspaceContext = createContext<PortfolioWorkspaceValue | null>(null);

export function usePortfolioWorkspace() {
  const context = useContext(PortfolioWorkspaceContext);

  if (!context) {
    throw new Error('usePortfolioWorkspace must be used inside PortfolioWorkspaceProvider');
  }

  return context;
}
