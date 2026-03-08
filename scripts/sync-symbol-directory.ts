import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SymbolDirectoryEntry } from '../src/domain/types';
import { normalizeSymbol } from '../src/lib/symbols';
import { YahooPublicProvider } from '../src/live/yahooPublic';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const sp500SourceUrl = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
const nasdaqSourceUrl = 'https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt';

/** Major ETFs and index funds (e.g. NYSE Arca) so they are available alongside stocks. */
const majorEtfs: Array<{ symbol: string; displaySymbol: string; name: string }> = [
  { symbol: 'VTI', displaySymbol: 'VTI', name: 'Vanguard Total Stock Market ETF' },
  { symbol: 'QQQ', displaySymbol: 'QQQ', name: 'Invesco QQQ Trust' },
  { symbol: 'SPY', displaySymbol: 'SPY', name: 'SPDR S&P 500 ETF Trust' },
  { symbol: 'IVV', displaySymbol: 'IVV', name: 'iShares Core S&P 500 ETF' },
  { symbol: 'VOO', displaySymbol: 'VOO', name: 'Vanguard S&P 500 ETF' },
  { symbol: 'VEA', displaySymbol: 'VEA', name: 'Vanguard FTSE Developed Markets ETF' },
  { symbol: 'VWO', displaySymbol: 'VWO', name: 'Vanguard FTSE Emerging Markets ETF' },
  { symbol: 'BND', displaySymbol: 'BND', name: 'Vanguard Total Bond Market ETF' },
  { symbol: 'AGG', displaySymbol: 'AGG', name: 'iShares Core U.S. Aggregate Bond ETF' },
  { symbol: 'VXUS', displaySymbol: 'VXUS', name: 'Vanguard Total International Stock ETF' },
  { symbol: 'IWM', displaySymbol: 'IWM', name: 'iShares Russell 2000 ETF' },
  { symbol: 'VTV', displaySymbol: 'VTV', name: 'Vanguard Value ETF' },
  { symbol: 'VUG', displaySymbol: 'VUG', name: 'Vanguard Growth ETF' },
  { symbol: 'SCHD', displaySymbol: 'SCHD', name: 'Schwab U.S. Dividend Equity ETF' },
  { symbol: 'VGT', displaySymbol: 'VGT', name: 'Vanguard Information Technology ETF' },
  { symbol: 'XLK', displaySymbol: 'XLK', name: 'Technology Select Sector SPDR Fund' },
  { symbol: 'DIA', displaySymbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF' },
];

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function parseSp500TableRows(html: string) {
  const tableMatch = html.match(/<table[^>]*id="constituents"[\s\S]*?<\/table>/i);

  if (!tableMatch) {
    throw new Error('Unable to locate the S&P 500 constituents table.');
  }

  const rowMatches = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? [];

  return rowMatches
    .slice(1)
    .map((row) => {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
        stripTags(match[1]),
      );

      if (cells.length < 2) {
        return null;
      }

      return {
        symbol: normalizeSymbol(cells[0]),
        displaySymbol: cells[0].trim().toUpperCase(),
        name: cells[1],
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        symbol: string;
        displaySymbol: string;
        name: string;
      } => Boolean(entry?.symbol),
    );
}

function shouldIncludeNasdaqSecurity(symbol: string, name: string) {
  const securityName = name.toLowerCase();

  if (!symbol || symbol.includes('^') || symbol.includes('$')) {
    return false;
  }

  return ![
    /\bwarrants?\b/i,
    /\brights?\b/i,
    /\bunits?\b/i,
    /\bpreferred\b/i,
    /depositary share representing preferred/i,
    /senior note/i,
    /\bbond\b/i,
    /\bdebenture\b/i,
  ].some((pattern) => pattern.test(securityName));
}

function parseNasdaqListed(text: string) {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split('|'))
    .filter((columns) => columns[0] !== 'File Creation Time')
    .map((columns) => {
      const [
        rawSymbol,
        rawName,
        ,
        testIssue,
        ,
        ,
        etf,
        nextShares,
      ] = columns;
      const displaySymbol = rawSymbol.trim().toUpperCase();

      if (
        testIssue === 'Y' ||
        nextShares === 'Y' ||
        (etf !== 'Y' && !shouldIncludeNasdaqSecurity(displaySymbol, rawName))
      ) {
        return null;
      }

      return {
        symbol: normalizeSymbol(displaySymbol),
        displaySymbol,
        name: rawName.trim(),
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        symbol: string;
        displaySymbol: string;
        name: string;
      } => Boolean(entry?.symbol),
    );
}

async function writeDirectoryFile(entries: SymbolDirectoryEntry[]) {
  const targetPath = path.join(repoRoot, 'public', 'symbol-directory.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    sources: [sp500SourceUrl, nasdaqSourceUrl, 'curated major ETFs/index funds'],
    entries,
  };

  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const provider = new YahooPublicProvider();
  console.log('Fetching current S&P 500 and Nasdaq symbol sources...');

  const [sp500Html, nasdaqText] = await Promise.all([
    fetch(sp500SourceUrl).then(async (response) => {
      if (!response.ok) {
        throw new Error(`S&P 500 source failed: ${response.status} ${response.statusText}`);
      }

      return response.text();
    }),
    fetch(nasdaqSourceUrl).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Nasdaq source failed: ${response.status} ${response.statusText}`);
      }

      return response.text();
    }),
  ]);

  const sp500Entries = parseSp500TableRows(sp500Html);
  const nasdaqEntries = parseNasdaqListed(nasdaqText);
  const bySymbol = new Map<string, SymbolDirectoryEntry>();

  for (const entry of sp500Entries) {
    bySymbol.set(entry.symbol, {
      symbol: entry.symbol,
      displaySymbol: entry.displaySymbol,
      name: entry.name,
      exchange: 'S&P 500',
      universes: ['S&P 500'],
    });
  }

  for (const entry of nasdaqEntries) {
    const current = bySymbol.get(entry.symbol);

    if (current) {
      bySymbol.set(entry.symbol, {
        ...current,
        displaySymbol: current.displaySymbol || entry.displaySymbol,
        name: current.name || entry.name,
        exchange: current.exchange === 'S&P 500' ? 'NASDAQ' : current.exchange,
        universes: [...new Set([...current.universes, 'NASDAQ'])],
      });
      continue;
    }

    bySymbol.set(entry.symbol, {
      symbol: entry.symbol,
      displaySymbol: entry.displaySymbol,
      name: entry.name,
      exchange: 'NASDAQ',
      universes: ['NASDAQ'],
    });
  }

  for (const entry of majorEtfs) {
    const symbol = normalizeSymbol(entry.displaySymbol);
    if (bySymbol.has(symbol)) {
      continue;
    }
    bySymbol.set(symbol, {
      symbol,
      displaySymbol: entry.displaySymbol,
      name: entry.name,
      exchange: 'ETF',
      universes: ['ETF'],
    });
  }

  const candidateSymbols = [...bySymbol.keys()].sort((left, right) => left.localeCompare(right));
  console.log(`Verifying ${candidateSymbols.length} symbols against Yahoo Finance quote coverage...`);

  let lastLogged = 0;
  const quotes = await provider.fetchQuoteSnapshots(candidateSymbols, (verified, total) => {
    if (verified - lastLogged >= 500 || verified === total) {
      console.log(`  Verified ${verified}/${total} symbols...`);
      lastLogged = verified;
    }
  });
  const verifiedEntries = candidateSymbols
    .map((symbol) => {
      const directoryEntry = bySymbol.get(symbol);
      const quote = quotes[symbol];

      if (!directoryEntry || !quote) {
        return null;
      }

      return {
        ...directoryEntry,
        name: quote.longName ?? directoryEntry.name,
        exchange: quote.exchangeName ?? directoryEntry.exchange,
      } satisfies SymbolDirectoryEntry;
    })
    .filter((entry): entry is SymbolDirectoryEntry => Boolean(entry))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));

  if (verifiedEntries.length === 0) {
    throw new Error('No Yahoo Finance-verified symbols were generated.');
  }

  await writeDirectoryFile(verifiedEntries);

  console.log(
    `Wrote ${verifiedEntries.length} Yahoo-verified directory entries to public/symbol-directory.json`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
