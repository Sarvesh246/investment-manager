import type {
  BrokerCsvFormat,
  BrokerImportPosition,
  BrokerImportSnapshot,
  PortfolioTransaction,
} from '../domain/types';
import { normalizeSymbol } from './symbols';

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && next === '\n') {
        index += 1;
      }
      row.push(cell.trim());
      cell = '';
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    cell += character;
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function findColumn(headers: string[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headers.findIndex((header) => normalizedAliases.includes(normalizeHeader(header)));
}

function detectBrokerFormat(headers: string[]): BrokerCsvFormat {
  const normalizedHeaders = headers.map(normalizeHeader);
  const looksLikeRobinhood =
    normalizedHeaders.includes('instrument') &&
    normalizedHeaders.includes('action') &&
    normalizedHeaders.includes('quantity') &&
    normalizedHeaders.includes('price');
  const looksLikeFidelity =
    (normalizedHeaders.includes('accountnumber') || normalizedHeaders.includes('accountname')) &&
    (
      normalizedHeaders.includes('currentvalue') ||
      normalizedHeaders.includes('lastprice') ||
      normalizedHeaders.includes('averagecostbasis')
    );
  const looksLikeSchwab =
    (
      normalizedHeaders.includes('feesandcommissions') ||
      normalizedHeaders.includes('feescommissions') ||
      normalizedHeaders.includes('costbasispershare') ||
      normalizedHeaders.includes('gainlossdollar')
    ) ||
    (
      normalizedHeaders.includes('marketvalue') &&
      normalizedHeaders.includes('costbasis') &&
      normalizedHeaders.includes('description')
    );
  const looksLikeWebull =
    (
      normalizedHeaders.includes('filledtime') &&
      normalizedHeaders.includes('ticker')
    ) ||
    (
      normalizedHeaders.includes('ticker') &&
      (normalizedHeaders.includes('costprice') || normalizedHeaders.includes('marketvalue'))
    );

  if (looksLikeRobinhood) {
    return 'robinhood';
  }

  if (looksLikeFidelity) {
    return 'fidelity';
  }

  if (looksLikeSchwab) {
    return 'schwab';
  }

  if (looksLikeWebull) {
    return 'webull';
  }

  return 'generic';
}

function parseNumber(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const cleaned = value
    .replace(/[$,%]/g, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, '')
    .replace(/,/g, '');
  const negative = /\(.+\)/.test(value);
  const numeric = Number(cleaned);

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  return negative ? -Math.abs(numeric) : numeric;
}

function roundCurrency(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.round(value * 100) / 100;
}

function absoluteAmount(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.abs(value);
}

function extractTicker(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parentheticalMatch = trimmed.match(/\(([A-Z]{1,6}(?:[.-][A-Z]{1,4})?)\)/);
  if (parentheticalMatch) {
    return normalizeSymbol(parentheticalMatch[1]);
  }

  const exactMatch = trimmed.match(/^[A-Z]{1,6}(?:[.-][A-Z]{1,4})?$/);
  if (exactMatch) {
    return normalizeSymbol(exactMatch[0]);
  }

  const tokenMatches = trimmed.match(/\b[A-Z]{1,6}(?:[.-][A-Z]{1,4})?\b/g);
  if (tokenMatches?.length) {
    return normalizeSymbol(tokenMatches[tokenMatches.length - 1]);
  }

  return undefined;
}

function normalizeDate(value: string | undefined) {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }

  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, '0');
    const day = slashMatch[2].padStart(2, '0');
    const year = slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3];
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
}

function positionMarketValue(position: BrokerImportPosition) {
  if (position.marketValue != null && Number.isFinite(position.marketValue)) {
    return position.marketValue;
  }

  if (position.marketPrice != null && Number.isFinite(position.marketPrice)) {
    return position.shares * position.marketPrice;
  }

  return undefined;
}

function combineDuplicatePositions(positions: BrokerImportPosition[]) {
  const grouped = new Map<string, BrokerImportPosition>();

  positions.forEach((position) => {
    const existing = grouped.get(position.symbol);
    if (!existing) {
      grouped.set(position.symbol, { ...position });
      return;
    }

    const shares = existing.shares + position.shares;
    const weightedCost =
      existing.costBasis != null && position.costBasis != null && shares > 0
        ? (existing.costBasis * existing.shares + position.costBasis * position.shares) / shares
        : existing.costBasis ?? position.costBasis;
    const marketValue =
      (positionMarketValue(existing) ?? 0) + (positionMarketValue(position) ?? 0);

    grouped.set(position.symbol, {
      symbol: position.symbol,
      name: existing.name ?? position.name,
      shares,
      costBasis: weightedCost,
      marketValue: marketValue > 0 ? marketValue : undefined,
      marketPrice: marketValue > 0 && shares > 0 ? marketValue / shares : existing.marketPrice ?? position.marketPrice,
    });
  });

  return [...grouped.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function rowLooksLikeCash(label: string) {
  return /(cash|buying power|brokerage cash|uninvested|sweep)/i.test(label);
}

function transactionKindFromText(
  value: string,
  amount: number | undefined,
  shares: number | undefined,
  symbol: string | undefined,
) {
  const normalized = normalizeHeader(value);

  if (
    normalized.includes('optionexercise') ||
    normalized.includes('optionassignment') ||
    normalized.includes('journalentry') ||
    normalized.includes('stocksplit')
  ) {
    return 'unsupported' as const;
  }

  if (normalized.includes('reinvest')) {
    return 'reinvest' as const;
  }
  if (normalized.includes('buy')) {
    return 'buy' as const;
  }
  if (normalized.includes('sell')) {
    return 'sell' as const;
  }
  if (normalized.includes('deposit') || normalized.includes('transferin') || normalized.includes('wirein')) {
    return 'deposit' as const;
  }
  if (normalized.includes('withdraw') || normalized.includes('transferout') || normalized.includes('wireout')) {
    return 'withdrawal' as const;
  }
  if (normalized.includes('dividend')) {
    return 'dividend' as const;
  }
  if (normalized.includes('split')) {
    return 'unsupported' as const;
  }
  if (normalized.includes('fee') || normalized.includes('commission')) {
    return 'fee' as const;
  }
  if (
    normalized.includes('transfer') ||
    normalized.includes('deposit') ||
    normalized.includes('withdraw')
  ) {
    if (
      normalized.includes('withdraw') ||
      normalized.includes('transferout') ||
      normalized.includes('wireout')
    ) {
      return 'withdrawal' as const;
    }

    if (
      normalized.includes('deposit') ||
      normalized.includes('transferin') ||
      normalized.includes('wirein')
    ) {
      return 'deposit' as const;
    }

    if (amount != null) {
      return amount >= 0 ? ('deposit' as const) : ('withdrawal' as const);
    }
  }

  if (symbol && shares != null && shares > 0 && amount != null) {
    return amount < 0 ? ('buy' as const) : ('sell' as const);
  }

  if (symbol && amount != null && (shares == null || shares === 0) && amount > 0) {
    return 'dividend' as const;
  }

  return undefined;
}

function createImportedId(prefix: string, index: number) {
  return `import-${prefix}-${index + 1}`;
}

export function parseBrokerHoldingsCsv(text: string, source = 'Broker CSV') {
  const rows = parseCsvRows(text);

  if (rows.length < 2) {
    throw new Error('The holdings CSV needs a header row and at least one data row.');
  }

  const headers = rows[0];
  const format = detectBrokerFormat(headers);
  const body = rows.slice(1);
  const symbolIndex = findColumn(headers, ['symbol', 'ticker', 'instrument', 'securitysymbol', 'stock']);
  const sharesIndex = findColumn(headers, ['shares', 'quantity', 'qty', 'quantityavailable', 'quantityheld']);
  const costBasisIndex = findColumn(headers, ['averagecost', 'averagebuyprice', 'avgprice', 'costbasispershare', 'costpershare', 'averagecostbasis', 'costprice', 'avgcost']);
  const totalCostIndex = findColumn(headers, ['costbasis', 'totalcost', 'totalcostbasis', 'costbasistotal', 'totalcostbasis$', 'costbasisamount']);
  const marketPriceIndex = findColumn(headers, ['lastprice', 'currentprice', 'marketprice', 'price', 'mark', 'lasttradeprice']);
  const marketValueIndex = findColumn(headers, ['marketvalue', 'equity', 'totalvalue', 'currentvalue', 'value', 'positionvalue']);
  const cashIndex = findColumn(headers, ['cash', 'buyingpower', 'cashbalance', 'availablecash', 'cashandcashequivalents']);
  const nameIndex = findColumn(headers, ['name', 'description', 'security', 'instrumentname', 'securitydescription']);
  const totalEquityIndex = findColumn(headers, ['portfoliovalue', 'totalequity', 'totalaccountvalue', 'accountvalue', 'netliquidation']);

  if (symbolIndex === -1 && nameIndex === -1) {
    throw new Error('Could not find a symbol or name column in the holdings CSV.');
  }

  const notes: string[] = [];
  let importedCash: number | undefined;
  let importedPortfolioValue: number | undefined;
  const positions: BrokerImportPosition[] = [];

  body.forEach((row) => {
    const rawSymbol = symbolIndex >= 0 ? row[symbolIndex] : '';
    const name = nameIndex >= 0 ? row[nameIndex] : undefined;
    const label = `${rawSymbol ?? ''} ${name ?? ''}`.trim();
    const shares = sharesIndex >= 0 ? parseNumber(row[sharesIndex]) : undefined;
    const marketPrice = marketPriceIndex >= 0 ? parseNumber(row[marketPriceIndex]) : undefined;
    const marketValue =
      marketValueIndex >= 0 ? parseNumber(row[marketValueIndex]) : undefined;
    const totalEquity =
      totalEquityIndex >= 0 ? parseNumber(row[totalEquityIndex]) : undefined;
    const totalCost =
      totalCostIndex >= 0 ? parseNumber(row[totalCostIndex]) : undefined;
    const costBasisFromRow =
      costBasisIndex >= 0 ? parseNumber(row[costBasisIndex]) : undefined;

    if (rowLooksLikeCash(label) || (cashIndex >= 0 && !rawSymbol && parseNumber(row[cashIndex]) != null)) {
      importedCash = cashIndex >= 0 ? parseNumber(row[cashIndex]) : marketValue ?? totalEquity ?? importedCash;
      return;
    }

    const symbol = extractTicker(rawSymbol) ?? extractTicker(name);

    if (!symbol) {
      if (totalEquity != null && importedPortfolioValue == null) {
        importedPortfolioValue = totalEquity;
      }
      return;
    }

    if (shares == null || shares <= 0) {
      notes.push(`Skipped ${symbol} because the share count was missing or zero.`);
      return;
    }

    const costBasis =
      costBasisFromRow != null
        ? costBasisFromRow
        : totalCost != null && shares > 0
          ? totalCost / shares
          : undefined;

    positions.push({
      symbol,
      name,
      shares,
      costBasis,
      marketPrice: marketPrice ?? undefined,
      marketValue:
        marketValue ?? (marketPrice != null ? marketPrice * shares : undefined),
    });
  });

  const normalizedPositions = combineDuplicatePositions(positions);
  const holdingsValue = roundCurrency(normalizedPositions.reduce(
    (sum, position) => sum + (positionMarketValue(position) ?? 0),
    0,
  ));
  const cash = roundCurrency(importedCash);
  const portfolioValue = roundCurrency(
    importedPortfolioValue ??
      (holdingsValue != null || cash != null
        ? (holdingsValue ?? 0) + (cash ?? 0)
        : undefined),
  );

  return {
    snapshot: {
      importedAt: new Date().toISOString(),
      source,
      format,
      positions: normalizedPositions,
      cash,
      holdingsValue: holdingsValue != null && holdingsValue > 0 ? holdingsValue : undefined,
      portfolioValue,
      rawRowCount: body.length,
      notes,
    } satisfies BrokerImportSnapshot,
    warnings: notes,
  };
}

export function parseBrokerTransactionsCsv(text: string, source = 'Broker CSV') {
  const rows = parseCsvRows(text);

  if (rows.length < 2) {
    throw new Error('The transactions CSV needs a header row and at least one data row.');
  }

  const headers = rows[0];
  const format = detectBrokerFormat(headers);
  const body = rows.slice(1);
  const dateIndex = findColumn(headers, ['date', 'activitydate', 'tradedate', 'settlementdate', 'filledtime', 'executiondate']);
  const actionIndex = findColumn(headers, ['kind', 'type', 'action', 'side', 'transactiontype', 'activity', 'activitytype']);
  const symbolIndex = findColumn(headers, ['symbol', 'ticker', 'instrument', 'stock']);
  const sharesIndex = findColumn(headers, ['shares', 'quantity', 'qty', 'filledquantity']);
  const priceIndex = findColumn(headers, ['price', 'fillprice', 'averageprice', 'filledprice', 'tradeprice']);
  const amountIndex = findColumn(headers, ['amount', 'totalamount', 'netamount', 'cashamount', 'proceeds', 'principalamount', 'value']);
  const feeIndex = findColumn(headers, ['fee', 'fees', 'commission', 'feesandcommissions', 'feescommissions']);
  const noteIndex = findColumn(headers, ['note', 'notes', 'description', 'details', 'securitydescription']);

  if (dateIndex === -1 || actionIndex === -1) {
    throw new Error('Could not find the date and action columns in the transactions CSV.');
  }

  const warnings: string[] = [];
  const transactions: PortfolioTransaction[] = [];

  body.forEach((row, index) => {
    const rawAction = row[actionIndex] ?? '';
    const rawSymbol = symbolIndex >= 0 ? row[symbolIndex] : undefined;
    const symbol = extractTicker(rawSymbol);
    const sharesValue = sharesIndex >= 0 ? parseNumber(row[sharesIndex]) : undefined;
    const shares = sharesValue == null ? undefined : Math.abs(sharesValue);
    let price = priceIndex >= 0 ? parseNumber(row[priceIndex]) : undefined;
    const amount = amountIndex >= 0 ? parseNumber(row[amountIndex]) : undefined;
    const fee = feeIndex >= 0 ? parseNumber(row[feeIndex]) : undefined;
    const note = noteIndex >= 0 ? row[noteIndex] : undefined;
    const date = normalizeDate(row[dateIndex]);
    const normalizedKind = transactionKindFromText(rawAction, amount, shares, symbol);

    if (!normalizedKind) {
      warnings.push(`Skipped row ${index + 2} because the event type "${rawAction}" was not recognized.`);
      return;
    }

    if (normalizedKind === 'unsupported') {
      warnings.push(`Ignored row ${index + 2} because "${rawAction}" is not supported in the import pipeline yet.`);
      return;
    }

    if ((normalizedKind === 'buy' || normalizedKind === 'sell' || normalizedKind === 'reinvest') && shares != null && price == null && amount != null && shares > 0) {
      price = Math.abs(amount) / shares;
    }

    if (normalizedKind === 'reinvest') {
      const reinvestAmount = absoluteAmount(amount) ?? ((shares ?? 0) * (price ?? 0));
      if (reinvestAmount <= 0 || !symbol || shares == null || price == null) {
        warnings.push(`Skipped row ${index + 2} because the reinvestment data was incomplete.`);
        return;
      }

      transactions.push({
        id: createImportedId(source.toLowerCase().replace(/\s+/g, '-'), transactions.length),
        kind: 'dividend',
        date,
        symbol,
        amount: reinvestAmount,
        note: note ? `${note} (imported reinvestment cash)` : 'Imported reinvestment cash',
        source: 'system',
      });
      transactions.push({
        id: createImportedId(source.toLowerCase().replace(/\s+/g, '-'), transactions.length),
        kind: 'buy',
        date,
        symbol,
        shares,
        price,
        note: note ? `${note} (imported reinvestment buy)` : 'Imported reinvestment buy',
        source: 'system',
      });
    } else {
      const transaction: PortfolioTransaction = {
        id: createImportedId(source.toLowerCase().replace(/\s+/g, '-'), transactions.length),
        kind: normalizedKind,
        date,
        symbol,
        shares: normalizedKind === 'buy' || normalizedKind === 'sell' ? shares : undefined,
        price: normalizedKind === 'buy' || normalizedKind === 'sell' ? price : undefined,
        amount:
          normalizedKind === 'deposit' ||
          normalizedKind === 'withdrawal' ||
          normalizedKind === 'dividend' ||
          normalizedKind === 'fee'
            ? absoluteAmount(amount)
            : undefined,
        note: note?.trim() || undefined,
        source: 'system',
      };

      transactions.push(transaction);
    }

    if (
      fee != null &&
      fee > 0 &&
      (normalizedKind === 'buy' || normalizedKind === 'sell' || normalizedKind === 'reinvest')
    ) {
      transactions.push({
        id: createImportedId(source.toLowerCase().replace(/\s+/g, '-'), transactions.length),
        kind: 'fee',
        date,
        symbol,
        amount: fee,
        note: note ? `${note} (imported fee)` : 'Imported fee',
        source: 'system',
      });
    }
  });

  return {
    format,
    transactions,
    warnings,
  };
}
