import type { MockDataset, SecuritySeed } from '../domain/types';

export interface HistoricalBar {
  date: string;
  close: number;
  volume: number;
}

export interface LivePriceSnapshot {
  symbol: string;
  price: number;
  previousClose: number;
  volume: number;
  longName?: string;
  exchangeName?: string;
  bars: HistoricalBar[];
}

export interface LiveQuoteSnapshot {
  symbol: string;
  price: number;
  previousClose: number;
  volume: number;
  longName?: string;
  exchangeName?: string;
}

export interface TimeseriesPoint {
  asOfDate: string;
  value: number;
}

export interface LiveFundamentalSnapshot {
  symbol: string;
  annualTotalRevenue: TimeseriesPoint[];
  annualBasicEps: TimeseriesPoint[];
  annualGrossProfit: TimeseriesPoint[];
  annualOperatingIncome: TimeseriesPoint[];
  annualFreeCashFlow: TimeseriesPoint[];
  annualCurrentAssets: TimeseriesPoint[];
  annualCurrentLiabilities: TimeseriesPoint[];
  annualTotalDebt: TimeseriesPoint[];
  annualCashAndCashEquivalents: TimeseriesPoint[];
  annualDilutedAverageShares: TimeseriesPoint[];
}

export interface LiveProviderRecord {
  seed: SecuritySeed;
  priceSnapshot?: LivePriceSnapshot;
  fundamentalsSnapshot?: LiveFundamentalSnapshot;
  sector?: string;
  notes: string[];
}

export interface LiveProviderResult {
  dataset: MockDataset;
  notes: string[];
}
