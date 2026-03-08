import { createContext, useContext } from 'react';
import type { buildCommandCenterModel } from '../domain/engine';
import type {
  Holding,
  MockDataset,
  PortfolioHistoryStore,
  SymbolDirectoryEntry,
} from '../domain/types';

export interface PortfolioWorkspaceValue {
  dataset: MockDataset;
  model: ReturnType<typeof buildCommandCenterModel>;
  symbolDirectory: SymbolDirectoryEntry[];
  symbolDirectoryState: 'loading' | 'ready' | 'error';
  symbolDirectoryError: string | null;
  holdings: Holding[];
  investableCash: number;
  addHolding: (input: { symbol: string; shares: number; costBasis: number }) => Promise<void>;
  removeHolding: (symbol: string) => void;
  setInvestableCash: (value: number) => void;
  ensureLiveSecurity: (symbol: string) => Promise<void>;
  loadingSymbols: string[];
  quoteErrors: Record<string, string>;
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
