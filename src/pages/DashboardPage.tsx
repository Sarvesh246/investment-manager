import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import {
  Panel,
  MetricCard,
  PageJumpNav,
  ScorePill,
  SignalBar,
  Tag,
} from './../components/ui';
import { HoverableChart } from './../components/HoverableChart';
import { formatCurrency, formatReturn } from './../lib/format';
import {
  buildDashboardHistorySeries,
  buyBlocker,
  buyPotentialScore,
  dashboardRanges,
  homeSeries,
  potentialBuyRows,
  quickActionNarrative,
  rangeWindow,
  signedCurrency,
  simpleActionText,
  toneForAction,
  toneForAlert,
} from './shared';
import { BuyingPowerEditor } from './shared-components';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';
import type { DashboardRange } from './shared';

export function DashboardPage() {
  const { dataset, model, portfolioHistory, setInvestableCash } = usePortfolioWorkspace();
  const [selectedRange, setSelectedRange] = useState<DashboardRange>('12M');
  const opportunityRows = potentialBuyRows(model).slice(0, 5);
  const actionableOpportunityCount = opportunityRows.filter((card) =>
    ['Buy now', 'Buy partial', 'Accumulate slowly'].includes(card.action),
  ).length;
  const persistedSeries = buildDashboardHistorySeries(portfolioHistory, selectedRange);
  const fallbackSeries = homeSeries(model).slice(-rangeWindow(selectedRange));
  const displayedSeries = persistedSeries.usesPersistedHistory
    ? persistedSeries.values
    : fallbackSeries;
  const displayedTimestamps = persistedSeries.usesPersistedHistory
    ? persistedSeries.timestamps
    : undefined;
  const startValue = displayedSeries[0] ?? model.portfolioValue;
  const endValue = displayedSeries.at(-1) ?? model.portfolioValue;
  const rangeDelta = endValue - startValue;
  const rangeReturn = startValue > 0 ? endValue / startValue - 1 : 0;
  const heroTone =
    rangeDelta > 0 ? 'positive' : rangeDelta < 0 ? 'negative' : 'neutral';
  const hasHoldings = model.holdings.length > 0;
  const hasPortfolioData = hasHoldings || dataset.user.investableCash > 0;
  const leadingIdea = opportunityRows[0];
  const biggestMover = model.watchlistMovers[0];
  const quickNarrative = quickActionNarrative(model);
  const dynamicConstraint =
    model.concentrationIssues[0] ??
    model.alerts.find((alert) => alert.severity === 'high')?.message ??
    'No material portfolio breach detected.';
  const historyFootnote = persistedSeries.trimmedForContinuity
    ? ''
    : persistedSeries.usesPersistedHistory
      ? persistedSeries.pointCount < 5
        ? 'Chart is starting to build from saved portfolio snapshots. It will get more detailed as more sessions are recorded.'
        : 'Chart uses saved intraday and end-of-day portfolio snapshots, so it stays intact across restarts.'
      : hasHoldings
        ? 'Saved portfolio history is still sparse, so the chart is temporarily estimating the path from your current holdings and cash.'
        : 'Add holdings on the Portfolio page to replace the flat cash line with your live book.';

  return (
    <div className="page page--home">
      {!hasPortfolioData ? (
        <section className="empty-state">
          <div className="empty-state__eyebrow">Welcome</div>
          <h2>Start by adding your first holding or your cash balance.</h2>
          <p>
            This home screen becomes useful once the app knows what you own and how much money you
            have ready to invest.
          </p>
          <div className="summary-card__actions">
            <Link to="/portfolio" className="action-button">
              Add holdings
            </Link>
            <Link to="/planner" className="panel-link">
              Open plan page
            </Link>
          </div>
        </section>
      ) : null}

      <PageJumpNav
        items={[
          { href: '#home-overview', label: 'Overview', detail: 'Balance and trend' },
          { href: '#home-actions', label: 'Next moves', detail: 'What to do now' },
          { href: '#home-risk', label: 'Risk radar', detail: 'Problems to fix' },
          { href: '#home-exposure', label: 'Exposure', detail: 'Concentration and balance' },
        ]}
      />

      <section id="home-overview" className="home-hero page-section">
        <div className="home-hero__main">
          <div className="home-hero__summary">
            <div className="home-hero__eyebrow">Home</div>
            <div className="home-hero__label">Portfolio value</div>
            <div className="home-hero__value">{formatCurrency(model.portfolioValue)}</div>
            <div className={`home-hero__delta home-hero__delta--${heroTone}`}>
              <strong>{signedCurrency(rangeDelta)}</strong>
              <span>{formatReturn(rangeReturn)}</span>
              <small>{selectedRange}</small>
            </div>
            <div className="range-switcher" role="group" aria-label="Chart time range">
              {dashboardRanges.map((range) => (
                <button
                  key={range}
                  type="button"
                  className={
                    range === selectedRange
                      ? 'range-switcher__button range-switcher__button--active'
                      : 'range-switcher__button'
                  }
                  onClick={() => setSelectedRange(range)}
                  aria-label={`Show ${range} chart`}
                  aria-pressed={range === selectedRange}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          <div className="home-hero__chart-column">
            <div className="hero-chart-shell">
              <HoverableChart
                values={displayedSeries}
                timestamps={displayedTimestamps}
                tone={heroTone}
              />
            </div>
            {historyFootnote ? <div className="hero-chart-footnote">{historyFootnote}</div> : null}
          </div>

          <div className="home-hero__side">
            <div className="summary-card summary-card--primary">
              <div className="summary-card__eyebrow">Buying Power</div>
              <strong>{formatCurrency(dataset.user.investableCash)}</strong>
              <p>
                Deploy {formatCurrency(model.deploymentPlan.deployNow)} now. Hold back{' '}
                {formatCurrency(model.deploymentPlan.holdBack)} as reserve.
              </p>
              <BuyingPowerEditor
                value={dataset.user.investableCash}
                onChange={setInvestableCash}
                className="buying-power-editor buying-power-editor--compact"
              />
              <div className="summary-card__actions">
                <Link to="/portfolio" className="action-button">
                  Manage portfolio
                </Link>
                <Link to="/planner" className="panel-link">
                  Run planner
                </Link>
              </div>
            </div>

            <div className="summary-card">
              <div className="summary-card__eyebrow">At A Glance</div>
              <div className="summary-list">
                <div className="summary-list__item">
                  <span>Holdings</span>
                  <strong>{model.holdings.length}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Regime</span>
                  <strong>{model.regime.key}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Top idea</span>
                  <strong>{leadingIdea?.symbol ?? 'No buy candidate'}</strong>
                </div>
                <div className="summary-list__item">
                  <span>Top risk</span>
                  <strong>{model.alerts[0]?.kind ?? 'No active breach'}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="guide-grid">
        <div className="guide-card">
          <div className="guide-card__eyebrow">Step 1</div>
          <strong>Check your balance</strong>
          <p>Look at portfolio value, buying power, and whether your cash reserve is intact.</p>
        </div>
        <div className="guide-card">
          <div className="guide-card__eyebrow">Step 2</div>
          <strong>Read the next move</strong>
          <p>The "What to do now" panel tells you whether to buy, wait, or keep cash on the side.</p>
        </div>
        <div className="guide-card">
          <div className="guide-card__eyebrow">Step 3</div>
          <strong>Check risk before buying</strong>
          <p>Review the risk radar and exposure map so you do not accidentally double down on the same theme.</p>
        </div>
      </section>

      <section className="market-strip">
        {model.watchlistMovers.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <h2>No watchlist activity yet.</h2>
            <p>Create watchlists in Settings, then add symbols from Discovery or Stock pages using Save to watchlist.</p>
            <Link to="/settings#settings-watchlists" className="action-button">
              Manage watchlists
            </Link>
          </div>
        ) : (
          model.watchlistMovers.slice(0, 6).map((item) => (
            <Link
              key={`${item.watchlist}-${item.symbol}`}
              to={`/stocks/${item.symbol}`}
              className="market-pill"
            >
              <div className="market-pill__row">
                <strong>{item.symbol}</strong>
                <Tag tone={item.move >= 0 ? 'positive' : 'negative'}>
                  {item.move >= 0 ? '+' : ''}
                  {item.move}%
                </Tag>
              </div>
              <span>{item.watchlist}</span>
            </Link>
          ))
        )}
      </section>

      <div id="home-actions" className="dashboard-grid page-section">
        <Panel
          title="For You"
          eyebrow="Ranked Opportunities"
          subtitle={
            actionableOpportunityCount > 0
              ? 'The best new ideas after adjusting for your current portfolio and risk rules.'
              : 'No green light right now, but these are the strongest next-up names for your portfolio.'
          }
        >
          {opportunityRows.length === 0 ? (
            <div className="empty-state empty-state--compact">
              <h2>No usable candidates right now.</h2>
              <p>The engine does not see a stock worth tracking under your current rules, fit, and risk settings.</p>
            </div>
          ) : (
            <div className="home-opportunity-list">
              {opportunityRows.slice(0, 4).map((card) => (
                <Link key={card.symbol} to={`/stocks/${card.symbol}`} className="home-opportunity-row">
                  <div>
                    <div className="home-opportunity-row__title">
                      <strong>{card.symbol}</strong>
                      <Tag tone={toneForAction(card.action)}>{card.action}</Tag>
                    </div>
                    <p>
                      {simpleActionText(card.action)}. {buyBlocker(card)}
                    </p>
                  </div>
                  <div className="home-opportunity-row__metrics">
                    <ScorePill label="Readiness" score={buyPotentialScore(card)} />
                    <ScorePill label="Base 12M" score={formatReturn(card.expectedReturns[2].base)} />
                    <ScorePill label="Fit" score={card.portfolioFit.score} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          id="home-risk"
          title="Risk Radar"
          eyebrow="Immediate Attention"
          subtitle="These are the items most likely to hurt your results if you ignore them."
        >
          <div className="stack-list">
            {model.alerts.slice(0, 4).map((alert) => (
              <Link key={alert.id} to={alert.route} className="alert-row">
                <div className="alert-row__icon">
                  <AlertTriangle size={16} />
                </div>
                <div>
                  <div className="alert-row__title">{alert.kind}</div>
                  <p>{alert.message}</p>
                </div>
                <Tag tone={toneForAlert(alert.severity)}>{alert.severity}</Tag>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel
          title="What To Do Now"
          eyebrow="Deployment Call"
          subtitle={`${model.deploymentPlan.posture}. Plain English: ${simpleActionText(
            model.deploymentPlan.deployNow > 0 ? 'Buy partial' : 'Watch only',
          )}.`}
        >
          <div className="advice-card">
            <p>{quickNarrative}</p>
            <div className="advice-card__allocations">
              {model.deploymentPlan.allocations.length > 0 ? (
                model.deploymentPlan.allocations.map((allocation) => (
                  <div key={allocation.symbol} className="allocation-chip">
                    <strong>{allocation.symbol}</strong>
                    <span>{formatCurrency(allocation.dollars)}</span>
                    <small>{allocation.role}</small>
                  </div>
                ))
              ) : (
                <div className="text-card">
                  <strong>Hold cash</strong>
                  <p>The engine does not see a high-conviction deployment set at the current margin.</p>
                </div>
              )}
            </div>
          </div>
        </Panel>

        <Panel
          title="Portfolio Pulse"
          eyebrow="Live Snapshot"
          subtitle={biggestMover ? `${biggestMover.symbol} is the strongest watchlist mover.` : 'No recent mover logged.'}
        >
          <div className="mini-stack">
            <MetricCard
              label="Diversification"
              value={`${model.diversificationScore}/100`}
              detail={dynamicConstraint}
              tone={model.concentrationIssues.length ? 'negative' : 'neutral'}
            />
            <MetricCard
              label="Average Risk"
              value={`${Math.round(model.averageRisk)}/100`}
              detail={`${Math.round(dataset.user.maxPortfolioDrawdownTolerance * 100)}% drawdown tolerance`}
              tone={model.averageRisk > 55 ? 'negative' : 'neutral'}
            />
            <MetricCard
              label="Cash Recommendation"
              value={formatCurrency(model.deploymentPlan.holdBack)}
              detail="Reserve capital the engine wants left uncommitted."
              tone="positive"
            />
          </div>
        </Panel>

        <Panel
          id="home-exposure"
          title="Exposure Map"
          eyebrow="Portfolio Shape"
          subtitle="Sector, factor, and risk exposure across current holdings."
        >
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
              <h3>Risk Buckets</h3>
              {model.riskExposure.map((entry) => (
                <SignalBar key={entry.bucket} label={entry.bucket} value={entry.value} tone={entry.bucket === 'Aggressive' || entry.bucket === 'Fragile' ? 'negative' : 'positive'} />
              ))}
            </div>
          </div>
        </Panel>

        <Panel
          title="Watchlist Movers"
          eyebrow="Monitor"
          subtitle="Named watchlists with the most meaningful near-term movement."
        >
          <div className="watchlist-grid">
            {model.watchlistMovers.slice(0, 6).map((item) => (
              <div key={`${item.watchlist}-${item.symbol}`} className="watchlist-card">
                <div className="watchlist-card__meta">
                  <span>{item.watchlist}</span>
                  <Tag tone={item.move >= 0 ? 'positive' : 'negative'}>
                    {item.move >= 0 ? '+' : ''}
                    {item.move}%
                  </Tag>
                </div>
                <strong>{item.symbol}</strong>
                <p>{item.note}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Changes Since Yesterday"
          eyebrow="Delta View"
          subtitle="The model stores score and risk changes rather than just snapshots."
        >
          <ul className="bullet-list">
            {model.notableChanges.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
