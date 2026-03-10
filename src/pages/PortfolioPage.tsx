import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import {
  Panel,
  MetricCard,
  PageHeader,
  PageJumpNav,
  ScorePill,
  SignalBar,
  Table,
  Tag,
} from './../components/ui';
import { SkeletonText } from './../components/Skeleton';
import { getSecurity } from './../domain/engine';
import type { PortfolioTransaction } from './../domain/types';
import {
  formatCurrency,
  formatPercent,
  formatPrice,
} from './../lib/format';
import { downloadBlob, exportHoldingsCsv, exportTransactionsCsv } from './../lib/exportPortfolio';
import { actionHelp } from './../lib/helpText';
import { normalizeSymbol } from './../lib/symbols';
import {
  compareOverlap,
  defaultTransactionDraft,
  liveStatusText,
  liveStatusTone,
  simpleActionText,
  symbolMatches,
  toneForAction,
  transactionAmountLabel,
  transactionIsValid,
  transactionNeedsAmount,
  transactionNeedsSharesAndPrice,
  transactionNeedsSplitRatio,
  transactionNeedsSymbol,
} from './shared';
import { BuyingPowerEditor } from './shared-components';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';
import { useToast } from './../runtime/toastContext';

export function PortfolioPage() {
  const {
    dataset,
    model,
    symbolDirectory,
    symbolDirectoryState,
    symbolDirectoryError,
    addHolding,
    removeHolding,
    investableCash,
    setInvestableCash,
    transactions,
    addTransaction,
    removeTransaction,
    clearTransactions,
    ensureLiveSecurity,
    loadingSymbols,
    quoteErrors,
    liveQuotes,
  } = usePortfolioWorkspace();
  const { addToast } = useToast();
  const [form, setForm] = useState({
    symbol: '',
    shares: 0,
    costBasis: 0,
    createJournal: false,
    journalThesis: '',
    journalInvalidation: '',
  });
  const [transactionDraft, setTransactionDraft] = useState(defaultTransactionDraft);
  const normalizedFormSymbol = normalizeSymbol(form.symbol);
  const formMatches = symbolMatches(symbolDirectory, form.symbol);
  const selectedDirectoryEntry =
    symbolDirectory.find(
      (entry) =>
        entry.symbol === normalizedFormSymbol ||
        entry.displaySymbol === form.symbol.trim().toUpperCase(),
    ) ?? formMatches[0];
  const previewSecurity = normalizedFormSymbol ? getSecurity(model, normalizedFormSymbol) : undefined;
  const investedValue = model.holdings.reduce((total, holding) => total + holding.marketValue, 0);
  const costBasisValue = dataset.holdings.reduce(
    (total, holding) => total + holding.shares * holding.costBasis,
    0,
  );
  const unrealizedPnL = investedValue - costBasisValue;
  const pairRows = dataset.holdings
    .flatMap((left, index) =>
      dataset.holdings.slice(index + 1).map((right) => [
        `${left.symbol} / ${right.symbol}`,
        `${compareOverlap(model, left.symbol, right.symbol)}/100`,
      ]),
    )
    .slice(0, 6);
  const orderedTransactions = [...transactions].sort(
    (left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id),
  );

  useEffect(() => {
    if (!normalizedFormSymbol) {
      return;
    }

    const hasDirectoryMatch = symbolDirectory.some(
      (entry) =>
        entry.symbol === normalizedFormSymbol ||
        entry.displaySymbol === form.symbol.trim().toUpperCase(),
    );

    if (
      hasDirectoryMatch &&
      !previewSecurity &&
      !loadingSymbols.includes(normalizedFormSymbol) &&
      !quoteErrors[normalizedFormSymbol]
    ) {
      void ensureLiveSecurity(normalizedFormSymbol);
    }
  }, [
    ensureLiveSecurity,
    form.symbol,
    loadingSymbols,
    normalizedFormSymbol,
    previewSecurity,
    quoteErrors,
    symbolDirectory,
  ]);

  return (
    <div className="page">
      <PageHeader
        title="Portfolio"
        summary="This is your live portfolio view: what you own, what it is worth, and whether you are too concentrated in one stock or theme."
      />

      <PageJumpNav
        items={[
          { href: '#portfolio-summary', label: 'Summary', detail: 'Value and risk' },
          { href: '#portfolio-manage', label: 'Manage', detail: 'Add or update positions' },
          { href: '#portfolio-book', label: 'Live book', detail: 'Current holdings' },
          { href: '#portfolio-ledger', label: 'Ledger', detail: 'Transactions and P/L' },
          { href: '#portfolio-balance', label: 'Balance', detail: 'Exposure and overlap' },
        ]}
      />

      {dataset.holdings.length === 0 ? (
        <section className="empty-state empty-state--compact">
          <div className="empty-state__eyebrow">No holdings yet</div>
          <h2>Add your first stock to activate portfolio analytics.</h2>
          <p>Enter a ticker, the number of shares you own, and your average buy price below.</p>
        </section>
      ) : null}

      <div id="portfolio-summary" className="kpi-grid page-section">
        <MetricCard
          label="Holdings Value"
          value={formatCurrency(investedValue)}
          detail={`${model.holdings.length} active positions`}
          tone="neutral"
        />
        <MetricCard
          label="Unrealized P/L"
          value={formatCurrency(unrealizedPnL)}
          detail={costBasisValue > 0 ? formatPercent((unrealizedPnL / costBasisValue) * 100) : '0.0%'}
          tone={unrealizedPnL >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard
          label="Cash Available"
          value={formatCurrency(investableCash)}
          detail={`${formatCurrency(model.portfolioValue)} total portfolio value`}
          tone="positive"
        />
        <MetricCard
          label="Diversification"
          value={`${model.diversificationScore}/100`}
          detail={model.concentrationIssues[0] ?? 'No immediate concentration breach'}
          tone={model.concentrationIssues.length ? 'negative' : 'neutral'}
        />
      </div>

      <div className="two-column-layout">
        <Panel
          id="portfolio-manage"
          title="Portfolio Inputs"
          eyebrow="Manage Positions"
          subtitle="Use this form whenever you add, update, or remove a position."
        >
          <div className="filters filters--stacked">
            <BuyingPowerEditor value={investableCash} onChange={setInvestableCash} />
            <label>
              Ticker Symbol
              <input
                type="text"
                value={form.symbol}
                onChange={(event) =>
                  setForm((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))
                }
                placeholder="AAPL or BRK.B"
              />
            </label>
            {form.symbol ? (
              symbolDirectoryState === 'loading' ? (
                <div className="text-card">
                  <strong>Loading symbol directory</strong>
                  <SkeletonText lines={2} />
                </div>
              ) : symbolDirectoryState === 'error' ? (
                <div className="text-card">
                  <strong>Directory unavailable</strong>
                  <p>{symbolDirectoryError ?? 'The lookup list could not be loaded.'} You can still add a symbol manually.</p>
                </div>
              ) : formMatches.length > 0 ? (
                <div className="lookup-results lookup-results--compact">
                  {formMatches.map((entry) => (
                    <button
                      key={entry.symbol}
                      type="button"
                      className="lookup-row"
                      onClick={() => {
                        setForm((current) => ({
                          ...current,
                          symbol: entry.displaySymbol,
                        }));
                        void ensureLiveSecurity(entry.symbol);
                      }}
                    >
                      <div>
                        <strong>{entry.displaySymbol}</strong>
                        <p>{entry.name}</p>
                      </div>
                      <div className="lookup-row__meta">
                        <Tag tone="neutral">{entry.exchange}</Tag>
                        <span>{entry.universes.join(' + ')}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-card">
                  <strong>Not in the synced directory</strong>
                  <p>You can still add the symbol. If Yahoo recognizes it, live market data will load after you save the position.</p>
                </div>
              )
            ) : null}
            {normalizedFormSymbol ? (
              <div className="quote-preview">
                <div>
                  <strong>{selectedDirectoryEntry?.name ?? normalizedFormSymbol}</strong>
                  <p>
                    {selectedDirectoryEntry
                      ? `${selectedDirectoryEntry.exchange} • ${selectedDirectoryEntry.universes.join(' + ')}`
                      : 'Custom symbol'}
                  </p>
                </div>
                <div className="quote-preview__meta">
                  <ScorePill
                    label="Current Market Price"
                    score={previewSecurity ? formatPrice(previewSecurity.price) : 'Waiting'}
                    tone={previewSecurity ? 'positive' : 'neutral'}
                  />
                  <ScorePill
                    label="Data Status"
                    score={liveStatusText(normalizedFormSymbol, loadingSymbols, quoteErrors, liveQuotes)}
                    tone={liveStatusTone(normalizedFormSymbol, loadingSymbols, quoteErrors, liveQuotes)}
                  />
                </div>
              </div>
            ) : null}
            <label>
              Shares Owned
              <input
                type="number"
                min={0}
                step={0.000001}
                value={form.shares || ''}
                onChange={(event) =>
                  setForm((current) => ({ ...current, shares: Number(event.target.value) }))
                }
              />
              <span className="field-help">Fractional shares are supported. Enter the exact share count you own.</span>
            </label>
            <label>
              Average Buy Price
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.costBasis || ''}
                onChange={(event) =>
                  setForm((current) => ({ ...current, costBasis: Number(event.target.value) }))
                }
              />
              <span className="field-help">Use your blended average entry price so gain/loss is calculated correctly.</span>
            </label>
            <label className="toggle-row">
              <div>
                <strong>Also create journal entry</strong>
                <span>Record your thesis and invalidation rule for this purchase.</span>
              </div>
              <input
                type="checkbox"
                checked={form.createJournal}
                onChange={(e) =>
                  setForm((current) => ({ ...current, createJournal: e.target.checked }))
                }
              />
            </label>
            {form.createJournal ? (
              <>
                <label>
                  Thesis (why you bought)
                  <textarea
                    value={form.journalThesis}
                    onChange={(e) =>
                      setForm((current) => ({ ...current, journalThesis: e.target.value }))
                    }
                    placeholder="e.g. High-quality compounder with strong FCF"
                    rows={2}
                  />
                </label>
                <label>
                  Invalidation rule (what would prove you wrong)
                  <textarea
                    value={form.journalInvalidation}
                    onChange={(e) =>
                      setForm((current) => ({ ...current, journalInvalidation: e.target.value }))
                    }
                    placeholder="e.g. Cloud growth decelerates for 3+ quarters"
                    rows={2}
                  />
                </label>
              </>
            ) : null}
            <button
              className="action-button"
              type="button"
              onClick={() => {
                const sym = normalizeSymbol(form.symbol);
                if (!sym) {
                  addToast('Please enter a valid symbol', 'warning');
                  return;
                }
                if (form.shares <= 0 || form.costBasis <= 0) {
                  addToast('Please enter shares and cost basis', 'warning');
                  return;
                }
                void addHolding({
                  symbol: form.symbol,
                  shares: form.shares,
                  costBasis: form.costBasis,
                  journalEntry:
                    form.createJournal && form.journalThesis.trim()
                      ? {
                          userThesis: form.journalThesis,
                          invalidationRule: form.journalInvalidation,
                        }
                      : undefined,
                });
                setForm({
                  symbol: '',
                  shares: 0,
                  costBasis: 0,
                  createJournal: false,
                  journalThesis: '',
                  journalInvalidation: '',
                });
              }}
              disabled={!form.symbol || form.shares <= 0 || form.costBasis <= 0}
            >
              <Plus size={16} />
              <span>Add or update holding</span>
            </button>
          </div>
        </Panel>

        <Panel
          id="portfolio-book"
          title="Current Holdings"
          eyebrow="Live Book"
          subtitle="Current price, market value, gain/loss, and the system's view on each holding."
          action={
            <button
              type="button"
              className="pill-button"
              onClick={() => {
                const blob = exportHoldingsCsv(
                  model.holdings.map((h) => ({
                    symbol: h.symbol,
                    shares: h.shares,
                    costBasis: h.costBasis,
                    marketValue: h.marketValue,
                    weight: h.weight,
                  })),
                );
                downloadBlob(blob, `holdings-${new Date().toISOString().slice(0, 10)}.csv`);
                addToast('Holdings exported', 'success');
              }}
            >
              Export CSV
            </button>
          }
        >
          <Table
            columns={['Ticker', 'Shares', 'Last Price', 'Cost Basis', 'Market Value', 'Unrealized P/L', 'Portfolio Weight', 'Risk', 'System View', 'Live Data', '']}
            rows={model.holdings.map((holding) => [
              <Link key={`${holding.symbol}-holding`} to={`/stocks/${holding.symbol}`} className="symbol-link">
                {holding.symbol}
              </Link>,
              <span key={`${holding.symbol}-shares`}>
                {holding.shares.toLocaleString('en-US', {
                  minimumFractionDigits: holding.shares % 1 === 0 ? 0 : 2,
                  maximumFractionDigits: 6,
                })}
              </span>,
              <span key={`${holding.symbol}-price`}>
                {formatPrice(getSecurity(model, holding.symbol)?.price ?? 0)}
              </span>,
              <span key={`${holding.symbol}-cost-basis`}>
                {formatCurrency(holding.costBasis * holding.shares)}
              </span>,
              <span key={`${holding.symbol}-value`}>{formatCurrency(holding.marketValue)}</span>,
              <span key={`${holding.symbol}-pnl`} className={holding.unrealizedPnl >= 0 ? 'text-positive' : 'text-negative'}>
                {holding.unrealizedPnl >= 0 ? '+' : ''}
                {formatCurrency(holding.unrealizedPnl)}
              </span>,
              <span key={`${holding.symbol}-weight`}>{formatPercent(holding.weight)}</span>,
              <span key={`${holding.symbol}-risk`}>{holding.riskContribution}</span>,
              <Tag
                key={`${holding.symbol}-action`}
                tone={toneForAction(holding.action)}
                tooltip={actionHelp[holding.action]}
              >
                {simpleActionText(holding.action)}
              </Tag>,
              <Tag
                key={`${holding.symbol}-market`}
                tone={liveStatusTone(holding.symbol, loadingSymbols, quoteErrors, liveQuotes)}
              >
                {liveStatusText(holding.symbol, loadingSymbols, quoteErrors, liveQuotes)}
              </Tag>,
              <button
                key={`${holding.symbol}-remove`}
                type="button"
                className="icon-button"
                onClick={() => {
                  if (window.confirm(`Remove ${holding.symbol} from your portfolio?`)) {
                    removeHolding(holding.symbol);
                    addToast(`Removed ${holding.symbol} from portfolio`, 'info');
                  }
                }}
                aria-label={`Remove ${holding.symbol}`}
              >
                <Trash2 size={14} />
              </button>,
            ])}
          />
        </Panel>

        <Panel
          title="Rebalance and Trim"
          eyebrow="Portfolio Actions"
          subtitle="These are the holdings that need attention because they may be too large or too risky."
        >
          <ul className="bullet-list">
            {model.concentrationIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
            {model.holdings
              .filter((holding) => holding.action === 'Trim')
              .map((holding) => (
                <li key={`${holding.symbol}-trim`}>
                  Trim {holding.symbol}: current weight {holding.weight}% with risk contribution {holding.riskContribution}.
                </li>
              ))}
          </ul>
        </Panel>
      </div>

      <div id="portfolio-ledger" className="dashboard-grid page-section">
        <Panel
          title="Transaction Ledger"
          eyebrow="True Accounting"
          subtitle="Record deposits, buys, sells, dividends, splits, and fees so portfolio history, realized P/L, and cost basis stay honest."
        >
          <div className="settings-note">
            <strong>How it works</strong>
            <p>
              Your current holdings and buying power act as the starting baseline. Once the ledger is active,
              each recorded event is replayed on top of that baseline to calculate realized profit, net cash
              flow, and cleaner account history.
            </p>
          </div>

          <div className="kpi-grid kpi-grid--tight">
            <MetricCard
              label="Recorded Events"
              value={String(model.ledgerSummary.transactionCount)}
              detail={model.ledgerSummary.lastActivityDate ?? 'No activity yet'}
            />
            <MetricCard
              label="Realized P/L"
              value={formatCurrency(model.ledgerSummary.realizedPnl)}
              detail={`Fees ${formatCurrency(model.ledgerSummary.feesPaid)}`}
              tone={model.ledgerSummary.realizedPnl >= 0 ? 'positive' : 'negative'}
            />
            <MetricCard
              label="Cash Flows"
              value={formatCurrency(model.ledgerSummary.netCashFlow)}
              detail={`Deposits ${formatCurrency(model.ledgerSummary.deposits)} / Withdrawals ${formatCurrency(model.ledgerSummary.withdrawals)}`}
              tone={model.ledgerSummary.netCashFlow >= 0 ? 'positive' : 'neutral'}
            />
            <MetricCard
              label="Dividends"
              value={formatCurrency(model.ledgerSummary.dividendsReceived)}
              detail={transactions.length > 0 ? 'Ledger is active' : 'Waiting for first event'}
              tone="positive"
            />
          </div>

          <div className="filters filters--stacked">
            <label>
              Event type
              <select
                value={transactionDraft.kind}
                onChange={(event) =>
                  setTransactionDraft((current) => ({
                    ...current,
                    kind: event.target.value as PortfolioTransaction['kind'],
                  }))
                }
              >
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
                <option value="dividend">Dividend</option>
                <option value="split">Split</option>
                <option value="fee">Fee</option>
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                value={transactionDraft.date}
                onChange={(event) =>
                  setTransactionDraft((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
                }
              />
            </label>
            {transactionNeedsSymbol(transactionDraft.kind) ? (
              <label>
                Symbol
                <input
                  type="text"
                  value={transactionDraft.symbol}
                  onChange={(event) =>
                    setTransactionDraft((current) => ({
                      ...current,
                      symbol: event.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="AAPL"
                />
              </label>
            ) : null}
            {transactionNeedsSharesAndPrice(transactionDraft.kind) ? (
              <>
                <label>
                  Shares
                  <input
                    type="number"
                    min={0}
                    step={0.000001}
                    value={transactionDraft.shares || ''}
                    onChange={(event) =>
                      setTransactionDraft((current) => ({
                        ...current,
                        shares: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Price
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={transactionDraft.price || ''}
                    onChange={(event) =>
                      setTransactionDraft((current) => ({
                        ...current,
                        price: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </>
            ) : null}
            {transactionNeedsAmount(transactionDraft.kind) ? (
              <label>
                {transactionAmountLabel(transactionDraft.kind)}
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={transactionDraft.amount || ''}
                  onChange={(event) =>
                    setTransactionDraft((current) => ({
                      ...current,
                      amount: Number(event.target.value),
                    }))
                  }
                />
              </label>
            ) : null}
            {transactionNeedsSplitRatio(transactionDraft.kind) ? (
              <label>
                Split ratio
                <input
                  type="number"
                  min={0}
                  step={0.0001}
                  value={transactionDraft.splitRatio || ''}
                  onChange={(event) =>
                    setTransactionDraft((current) => ({
                      ...current,
                      splitRatio: Number(event.target.value),
                    }))
                  }
                />
                <span className="field-help">Use 2 for a 2-for-1 split or 0.25 for a 1-for-4 reverse split.</span>
              </label>
            ) : null}
            <label>
              Note
              <input
                type="text"
                value={transactionDraft.note}
                onChange={(event) =>
                  setTransactionDraft((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
                placeholder="Optional note"
              />
            </label>
          </div>

          <div className="summary-card__actions">
            <button
              type="button"
              className="action-button"
              disabled={!transactionIsValid(transactionDraft)}
              onClick={() => {
                addTransaction({
                  kind: transactionDraft.kind,
                  date: transactionDraft.date,
                  symbol: transactionNeedsSymbol(transactionDraft.kind)
                    ? normalizeSymbol(transactionDraft.symbol)
                    : undefined,
                  shares: transactionNeedsSharesAndPrice(transactionDraft.kind)
                    ? transactionDraft.shares
                    : undefined,
                  price: transactionNeedsSharesAndPrice(transactionDraft.kind)
                    ? transactionDraft.price
                    : undefined,
                  amount: transactionNeedsAmount(transactionDraft.kind)
                    ? transactionDraft.amount
                    : undefined,
                  splitRatio: transactionNeedsSplitRatio(transactionDraft.kind)
                    ? transactionDraft.splitRatio
                    : undefined,
                  note: transactionDraft.note.trim() || undefined,
                });
                setTransactionDraft(defaultTransactionDraft());
              }}
            >
              <Plus size={16} />
              <span>Record transaction</span>
            </button>
            {transactions.length > 0 ? (
              <>
                <button
                  type="button"
                  className="pill-button"
                  onClick={() => {
                    const blob = exportTransactionsCsv(transactions);
                    downloadBlob(blob, `ledger-${new Date().toISOString().slice(0, 10)}.csv`);
                    addToast('Ledger exported', 'success');
                  }}
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  className="pill-button"
                  onClick={() => {
                    if (window.confirm('Clear all transactions from the ledger? This cannot be undone.')) {
                      clearTransactions();
                      addToast('Ledger cleared', 'info');
                    }
                  }}
                >
                  Clear ledger
                </button>
              </>
            ) : null}
          </div>

          {model.ledgerSummary.notes.length > 0 ? (
            <ul className="bullet-list">
              {model.ledgerSummary.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel
          title="Recorded Activity"
          eyebrow="Ledger History"
          subtitle={
            transactions.length > 0
              ? 'Newest items are shown first. Delete a row if you need to correct a mistake.'
              : 'Once you record activity here, the account history and realized profit math become much more accurate.'
          }
        >
          {orderedTransactions.length === 0 ? (
            <div className="empty-state empty-state--compact">
              <h2>No transactions recorded yet.</h2>
              <p>
                Start with deposits, buys, and sells. That gives the app a truer cost basis, realized P/L,
                and performance history.
              </p>
            </div>
          ) : (
            <Table
              columns={['Date', 'Type', 'Symbol', 'Shares', 'Price', 'Amount', 'Note', '']}
              rows={orderedTransactions.map((transaction) => [
                <span key={`${transaction.id}-date`}>{transaction.date}</span>,
                <span key={`${transaction.id}-kind`}>{transaction.kind}</span>,
                <span key={`${transaction.id}-symbol`}>{transaction.symbol ?? 'Cash'}</span>,
                <span key={`${transaction.id}-shares`}>
                  {transaction.shares != null
                    ? transaction.shares.toLocaleString('en-US', {
                        minimumFractionDigits: transaction.shares % 1 === 0 ? 0 : 2,
                        maximumFractionDigits: 6,
                      })
                    : '—'}
                </span>,
                <span key={`${transaction.id}-price`}>
                  {transaction.price != null ? formatPrice(transaction.price) : '—'}
                </span>,
                <span key={`${transaction.id}-amount`}>
                  {transaction.amount != null
                    ? formatCurrency(transaction.amount)
                    : transaction.price != null && transaction.shares != null
                      ? formatCurrency(transaction.price * transaction.shares)
                      : transaction.splitRatio != null
                        ? `${transaction.splitRatio}x`
                        : '—'}
                </span>,
                <span key={`${transaction.id}-note`}>{transaction.note ?? '—'}</span>,
                <button
                  key={`${transaction.id}-remove`}
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    if (window.confirm(`Remove this ${transaction.kind} transaction?`)) {
                      removeTransaction(transaction.id);
                      addToast('Transaction removed', 'info');
                    }
                  }}
                  aria-label={`Remove ${transaction.kind} transaction`}
                >
                  <Trash2 size={14} />
                </button>,
              ])}
            />
          )}
        </Panel>
      </div>

      <div id="portfolio-balance" className="dashboard-grid page-section">
        <Panel title="Exposure Breakdown" eyebrow="Current State" subtitle="Use this to judge whether a new idea improves or worsens balance.">
          <div className="triple-columns">
            <div>
              <h3>Sector</h3>
              {model.sectorExposure.map((entry) => (
                <SignalBar key={entry.sector} label={entry.sector} value={entry.weight} tone={entry.weight > 28 ? 'negative' : 'positive'} />
              ))}
            </div>
            <div>
              <h3>Factor</h3>
              {model.factorExposure.map((entry) => (
                <SignalBar key={entry.factor} label={entry.factor} value={entry.value} tone="neutral" />
              ))}
            </div>
            <div>
              <h3>Risk Bucket</h3>
              {model.riskExposure.map((entry) => (
                <SignalBar key={entry.bucket} label={entry.bucket} value={entry.value} tone={entry.bucket === 'Aggressive' || entry.bucket === 'Fragile' ? 'negative' : 'positive'} />
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Holding Overlap" eyebrow="Correlation Proxy" subtitle="Pairwise overlap estimates derived from factor exposure and shared sector concentration.">
          <Table
            columns={['Pair', 'Overlap']}
            rows={pairRows.map(([pair, overlap]) => [<span key={pair}>{pair}</span>, <span key={`${pair}-overlap`}>{overlap}</span>])}
          />
        </Panel>
      </div>
    </div>
  );
}
