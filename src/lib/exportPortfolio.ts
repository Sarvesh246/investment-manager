import type { JournalEntry, PortfolioTransaction } from '../domain/types';
import { formatCurrency, formatPercent } from './format';

export function exportHoldingsCsv(holdings: Array<{ symbol: string; shares: number; costBasis: number; marketValue?: number; weight?: number }>) {
  const headers = ['Symbol', 'Shares', 'Cost Basis', 'Market Value', 'Weight %'];
  const rows = holdings.map((h) => [
    h.symbol,
    h.shares.toLocaleString('en-US', { maximumFractionDigits: 6 }),
    formatCurrency(h.costBasis * h.shares),
    h.marketValue != null ? formatCurrency(h.marketValue) : '-',
    h.weight != null ? formatPercent(h.weight, 1) : '-',
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

export function exportJournalCsv(entries: JournalEntry[]) {
  const headers = ['Symbol', 'Decision Date', 'Decision Type', 'Original Thesis', 'Invalidation Rule', 'System Summary', 'Outcome'];
  const escape = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;
  const rows = entries.map((e) => [
    e.symbol,
    e.decisionDate,
    e.decisionType,
    escape(e.userThesis),
    escape(e.invalidationRule),
    escape(e.systemSummary),
    escape(e.outcome),
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

export function exportTransactionsCsv(transactions: PortfolioTransaction[]) {
  const headers = ['Date', 'Kind', 'Symbol', 'Shares', 'Price', 'Amount', 'Note'];
  const rows = transactions.map((t) => [
    t.date,
    t.kind,
    t.symbol ?? '',
    t.shares?.toLocaleString('en-US') ?? '',
    t.price != null ? t.price.toFixed(2) : '',
    t.amount != null ? t.amount.toFixed(2) : '',
    (t.note ?? '').replace(/,/g, ';'),
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

