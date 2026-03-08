import type { SymbolDirectoryEntry } from '../domain/types';

export function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\./g, '-').replace(/\s+/g, '');
}

export function symbolMatchesQuery(entry: SymbolDirectoryEntry, query: string) {
  const normalizedQuery = normalizeSymbol(query);
  const nameQuery = query.trim().toLowerCase();

  if (!normalizedQuery && !nameQuery) {
    return false;
  }

  return (
    entry.symbol.includes(normalizedQuery) ||
    entry.displaySymbol.toUpperCase().includes(normalizedQuery) ||
    entry.name.toLowerCase().includes(nameQuery)
  );
}
