import type {
  Holding,
  LedgerBaseline,
  PortfolioLedgerSummary,
  PortfolioTransaction,
} from './types';

function normalizeDate(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return new Date(0).toISOString();
  }

  return parsed.toISOString();
}

function cloneHolding(holding: Holding): Holding {
  return {
    ...holding,
    styleTags: [...holding.styleTags],
    thesisTags: [...holding.thesisTags],
  };
}

function sortTransactions(transactions: PortfolioTransaction[]) {
  return [...transactions].sort((left, right) => {
    const dateOrder = normalizeDate(left.date).localeCompare(normalizeDate(right.date));

    if (dateOrder !== 0) {
      return dateOrder;
    }

    return left.id.localeCompare(right.id);
  });
}

function transactionAmount(transaction: PortfolioTransaction) {
  if (transaction.amount != null) {
    return transaction.amount;
  }

  if (transaction.shares != null && transaction.price != null) {
    return transaction.shares * transaction.price;
  }

  return 0;
}

function getHolding(holdings: Holding[], symbol: string) {
  return holdings.find((holding) => holding.symbol === symbol);
}

function upsertHolding(holdings: Holding[], nextHolding: Holding) {
  const existingIndex = holdings.findIndex((holding) => holding.symbol === nextHolding.symbol);

  if (existingIndex === -1) {
    return [...holdings, nextHolding];
  }

  const next = [...holdings];
  next[existingIndex] = nextHolding;
  return next;
}

function removeHolding(holdings: Holding[], symbol: string) {
  return holdings.filter((holding) => holding.symbol !== symbol);
}

export function createLedgerBaseline(holdings: Holding[], investableCash: number): LedgerBaseline {
  return {
    asOf: new Date().toISOString(),
    holdings: holdings.map(cloneHolding),
    investableCash,
  };
}

export function replayTransactions(
  baseline: LedgerBaseline,
  transactions: PortfolioTransaction[],
) {
  let holdings = baseline.holdings.map(cloneHolding);
  let investableCash = baseline.investableCash;
  let realizedPnl = 0;
  let dividendsReceived = 0;
  let feesPaid = 0;
  let deposits = 0;
  let withdrawals = 0;
  const notes: string[] = [];

  for (const transaction of sortTransactions(transactions)) {
    const amount = transactionAmount(transaction);

    switch (transaction.kind) {
      case 'deposit':
        investableCash += Math.max(amount, 0);
        deposits += Math.max(amount, 0);
        break;
      case 'withdrawal':
        investableCash -= Math.max(amount, 0);
        withdrawals += Math.max(amount, 0);
        break;
      case 'dividend':
        investableCash += Math.max(amount, 0);
        dividendsReceived += Math.max(amount, 0);
        break;
      case 'fee':
        investableCash -= Math.max(amount, 0);
        feesPaid += Math.max(amount, 0);
        break;
      case 'buy': {
        if (!transaction.symbol || transaction.shares == null || transaction.price == null) {
          notes.push(`Ignored malformed buy transaction ${transaction.id}.`);
          break;
        }

        const existing = getHolding(holdings, transaction.symbol);
        const existingShares = existing?.shares ?? 0;
        const nextShares = existingShares + transaction.shares;
        const nextCostBasis =
          nextShares > 0
            ? (((existing?.costBasis ?? 0) * existingShares) +
                transaction.price * transaction.shares) /
              nextShares
            : transaction.price;

        holdings = upsertHolding(holdings, {
          symbol: transaction.symbol,
          shares: nextShares,
          costBasis: nextCostBasis,
          styleTags: existing?.styleTags ?? [],
          thesisTags: existing?.thesisTags ?? [],
          entryDate: existing?.entryDate ?? transaction.date.slice(0, 10),
        });
        investableCash -= transaction.shares * transaction.price;
        break;
      }
      case 'sell': {
        if (!transaction.symbol || transaction.shares == null || transaction.price == null) {
          notes.push(`Ignored malformed sell transaction ${transaction.id}.`);
          break;
        }

        const existing = getHolding(holdings, transaction.symbol);

        if (!existing || existing.shares <= 0) {
          notes.push(`Ignored sell for ${transaction.symbol} because no shares were available.`);
          break;
        }

        const sharesToSell = Math.min(existing.shares, transaction.shares);
        const nextShares = Math.max(existing.shares - sharesToSell, 0);
        realizedPnl += (transaction.price - existing.costBasis) * sharesToSell;
        investableCash += sharesToSell * transaction.price;

        if (nextShares === 0) {
          holdings = removeHolding(holdings, transaction.symbol);
        } else {
          holdings = upsertHolding(holdings, {
            ...existing,
            shares: nextShares,
          });
        }

        if (sharesToSell < transaction.shares) {
          notes.push(
            `Sell ${transaction.id} for ${transaction.symbol} was clipped to ${sharesToSell} shares because the ledger held fewer shares.`,
          );
        }
        break;
      }
      case 'split': {
        if (!transaction.symbol || transaction.splitRatio == null || transaction.splitRatio <= 0) {
          notes.push(`Ignored malformed split transaction ${transaction.id}.`);
          break;
        }

        const existing = getHolding(holdings, transaction.symbol);

        if (!existing) {
          notes.push(`Ignored split for ${transaction.symbol} because no holding was present.`);
          break;
        }

        holdings = upsertHolding(holdings, {
          ...existing,
          shares: existing.shares * transaction.splitRatio,
          costBasis: existing.costBasis / transaction.splitRatio,
        });
        break;
      }
      default:
        break;
    }
  }

  const summary: PortfolioLedgerSummary = {
    transactionCount: transactions.length,
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    dividendsReceived: Math.round(dividendsReceived * 100) / 100,
    feesPaid: Math.round(feesPaid * 100) / 100,
    deposits: Math.round(deposits * 100) / 100,
    withdrawals: Math.round(withdrawals * 100) / 100,
    netCashFlow: Math.round((deposits - withdrawals + dividendsReceived - feesPaid) * 100) / 100,
    lastActivityDate: sortTransactions(transactions).at(-1)?.date,
    notes,
  };

  return {
    holdings,
    investableCash: Math.round(investableCash * 100) / 100,
    summary,
  };
}
