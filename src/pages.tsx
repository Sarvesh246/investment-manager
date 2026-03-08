import {
  Activity,
  AlertTriangle,
  BookText,
  BriefcaseBusiness,
  ChartCandlestick,
  LayoutDashboard,
  Plus,
  Radar,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { Panel, MetricCard, PageHeader, ScorePill, SignalBar, Sparkline, Table, Tag } from './components/ui';
import { buildDeploymentPlan, getHolding, getScorecard, getSecurity, profileSummary } from './domain/engine';
import type {
  ActionLabel,
  AlertItem,
  PlannerInputs,
  PortfolioHistoryStore,
  SymbolDirectoryEntry,
} from './domain/types';
import {
  formatClockTime,
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatReturn,
} from './lib/format';
import { normalizeSymbol, symbolMatchesQuery } from './lib/symbols';
import { usePortfolioWorkspace } from './runtime/portfolioContext';

const navigation = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/discovery', label: 'Explore', icon: Search },
  { to: '/portfolio', label: 'Portfolio', icon: BriefcaseBusiness },
  { to: '/recommendations', label: 'Ideas', icon: Radar },
  { to: '/planner', label: 'Plan', icon: ChartCandlestick },
  { to: '/alerts', label: 'Watch', icon: ShieldAlert },
  { to: '/journal', label: 'Journal', icon: BookText },
];

const dashboardRanges = ['1M', '3M', '6M', '12M'] as const;

type DashboardRange = (typeof dashboardRanges)[number];

function toneForAction(action: ActionLabel) {
  if (action === 'Buy now' || action === 'Hold') {
    return 'positive' as const;
  }
  if (
    action === 'Buy partial' ||
    action === 'Accumulate slowly' ||
    action === 'Watch only'
  ) {
    return 'warning' as const;
  }
  return 'negative' as const;
}

function toneForAlert(severity: AlertItem['severity']) {
  if (severity === 'high') {
    return 'negative' as const;
  }
  if (severity === 'medium') {
    return 'warning' as const;
  }
  return 'positive' as const;
}

function quickActionNarrative(model: ReturnType<typeof usePortfolioWorkspace>['model']) {
  const plan = model.deploymentPlan;
  const allocations = plan.allocations
    .map((allocation) => `${allocation.symbol} (${formatCurrency(allocation.dollars)})`)
    .join(', ');

  return `You have ${formatCurrency(plan.availableCash)} available. Deploy ${formatCurrency(
    plan.deployNow,
  )} now and keep ${formatCurrency(plan.holdBack)} in reserve. Focus on ${allocations || 'no new buys'} while staying inside current sector and drawdown constraints.`;
}

function simpleActionText(action: ActionLabel) {
  switch (action) {
    case 'Buy now':
      return 'Strong fit right now';
    case 'Buy partial':
      return 'Good idea, but ease in';
    case 'Accumulate slowly':
      return 'Worth building over time';
    case 'Watch only':
      return 'Interesting, but not ready';
    case 'Avoid':
      return 'Risk is not worth it';
    case 'Hold':
      return 'Keep your current position';
    case 'Trim':
      return 'Position is too large or risky';
    case 'Reassess after earnings':
      return 'Wait until the event passes';
    case 'High-upside / high-risk only':
      return 'Only for a small speculative slice';
    case 'Not suitable for current portfolio':
      return 'Could work elsewhere, not in this portfolio';
    default:
      return action;
  }
}

function liveStatusText(
  symbol: string,
  loadingSymbols: string[],
  quoteErrors: Record<string, string>,
  livePriceSymbols: string[],
) {
  if (loadingSymbols.includes(symbol)) {
    return 'Refreshing';
  }

  if (quoteErrors[symbol]) {
    return 'Unavailable';
  }

  if (livePriceSymbols.includes(symbol)) {
    return 'Live';
  }

  return 'Snapshot';
}

function homeSeries(model: ReturnType<typeof usePortfolioWorkspace>['model']) {
  const points = Math.max(
    8,
    ...model.dataset.securities.map((security) => security.priceHistory.length),
  );

  if (model.dataset.holdings.length === 0) {
    return Array.from({ length: points }, () => model.dataset.user.investableCash);
  }

  return Array.from({ length: points }, (_, index) => {
    const holdingsValue = model.dataset.holdings.reduce((total, holding) => {
      const security = getSecurity(model, holding.symbol);

      if (!security || security.price <= 0) {
        return total;
      }

      const historyIndex = Math.max(
        0,
        security.priceHistory.length - points + index,
      );
      const historicalPrice = security.priceHistory[historyIndex] ?? security.price;
      return total + holding.shares * historicalPrice;
    }, 0);

    return holdingsValue + model.dataset.user.investableCash;
  });
}

function rangeWindow(range: DashboardRange) {
  switch (range) {
    case '1M':
      return 2;
    case '3M':
      return 3;
    case '6M':
      return 5;
    case '12M':
    default:
      return 8;
  }
}

function rangeDays(range: DashboardRange) {
  switch (range) {
    case '1M':
      return 31;
    case '3M':
      return 92;
    case '6M':
      return 183;
    case '12M':
    default:
      return 366;
  }
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function buildDashboardHistorySeries(history: PortfolioHistoryStore, range: DashboardRange) {
  const now = Date.now();
  const intradayBlendWindowMs = 14 * 24 * 60 * 60 * 1000;
  const rangeCutoff = now - rangeDays(range) * 24 * 60 * 60 * 1000;
  const intradayCutoff = now - intradayBlendWindowMs;
  const intradaySnapshots = history.intraday.filter(
    (snapshot) => new Date(snapshot.timestamp).getTime() >= Math.max(rangeCutoff, intradayCutoff),
  );
  const intradayDays = new Set(
    intradaySnapshots.map((snapshot) => dayKey(new Date(snapshot.timestamp))),
  );
  const dailySnapshots = history.daily.filter((snapshot) => {
    const timestamp = new Date(snapshot.timestamp).getTime();

    if (timestamp < rangeCutoff) {
      return false;
    }

    if (timestamp < intradayCutoff) {
      return true;
    }

    return !intradayDays.has(dayKey(new Date(snapshot.timestamp)));
  });
  const values = [...dailySnapshots, ...intradaySnapshots]
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    )
    .map((snapshot) => snapshot.portfolioValue);

  return {
    values,
    usesPersistedHistory: values.length >= 2,
    pointCount: values.length,
  };
}

function signedCurrency(value: number) {
  return `${value >= 0 ? '+' : '-'}${formatCurrency(Math.abs(value))}`;
}

function compareOverlap(
  model: ReturnType<typeof usePortfolioWorkspace>['model'],
  symbolLeft: string,
  symbolRight: string,
) {
  const left = getSecurity(model, symbolLeft);
  const right = getSecurity(model, symbolRight);

  if (!left || !right) {
    return 0;
  }

  const valuesLeft = Object.values(left.factors);
  const valuesRight = Object.values(right.factors);
  const shared = valuesLeft.reduce((total, value, index) => total + Math.min(value, valuesRight[index]), 0);
  const overlap = shared / 6 + (left.sector === right.sector ? 18 : 0);

  return Math.min(95, Math.round(overlap));
}

function symbolMatches(directory: SymbolDirectoryEntry[], query: string) {
  if (!query.trim()) {
    return [];
  }

  return directory.filter((entry) => symbolMatchesQuery(entry, query)).slice(0, 8);
}

function BuyingPowerEditor({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const inputValue = value > 0 ? String(value) : '';

  return (
    <div className={className ?? 'buying-power-editor'}>
      <label className="buying-power-editor__field">
        <span>Buying power</span>
        <input
          type="number"
          min={0}
          step={0.01}
          value={inputValue}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
          placeholder="0"
        />
      </label>
      <div className="buying-power-editor__quick-actions">
        {[500, 1000, 5000].map((amount) => (
          <button
            key={amount}
            type="button"
            className="pill-button"
            onClick={() => onChange(Math.max(0, value + amount))}
          >
            +{formatCurrency(amount)}
          </button>
        ))}
      </div>
      <p>Enter the cash you can actually invest right now. Portfolio totals update immediately.</p>
    </div>
  );
}

export function AppShell() {
  const location = useLocation();
  const { dataset, model, lastQuoteRefreshAt, livePriceSymbols, quoteErrors } = usePortfolioWorkspace();
  const liveHeldCount = model.holdings.filter(
    (holding) => livePriceSymbols.includes(holding.symbol) && !quoteErrors[holding.symbol],
  ).length;
  const liveStatusLabel =
    model.holdings.length === 0
      ? dataset.dataMode ?? 'seeded'
      : liveHeldCount === model.holdings.length
        ? 'live'
        : liveHeldCount > 0
          ? 'partial'
          : 'unavailable';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__crest">IC</div>
          <div>
            <strong>Investment Center</strong>
            <span>Guided Wealth Console</span>
          </div>
        </div>

        <div className="sidebar__intro">
          <strong>Start here</strong>
          <p>Add your holdings, check today&apos;s plan, then review the ideas list for new money.</p>
        </div>

        <nav className="sidebar__nav">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                isActive || (to !== '/' && location.pathname.startsWith(to))
                  ? 'sidebar__link sidebar__link--active'
                  : 'sidebar__link'
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <Panel
          title="Your Plan"
          eyebrow="Settings Snapshot"
          subtitle={profileSummary(dataset)}
          className="sidebar__profile"
        >
          <div className="mini-stack">
            <ScorePill label="Cash reserve" score={formatCurrency(dataset.user.targetCashReserve)} />
            <ScorePill label="Risk style" score={dataset.user.riskTolerance} />
            <ScorePill label="Benchmark" score={dataset.user.benchmarkSymbol} />
          </div>
        </Panel>
      </aside>

      <main className="workspace">
        <div className="workspace__topbar">
          <div>
            <div className="workspace__eyebrow">Market mode</div>
            <strong>{model.regime.key}</strong>
            <div className="workspace__subtext">
              Prices refreshed {formatClockTime(lastQuoteRefreshAt)}. Live quote refresh is working
              for {liveHeldCount} of {model.holdings.length} held {model.holdings.length === 1 ? 'position' : 'positions'}.
            </div>
          </div>
          <div className="workspace__meta">
            <ScorePill
              label="Data"
              score={liveStatusLabel}
              tone={
                liveStatusLabel === 'live'
                  ? 'positive'
                  : liveStatusLabel === 'partial'
                    ? 'warning'
                    : liveStatusLabel === 'unavailable'
                      ? 'negative'
                      : 'neutral'
              }
            />
            <ScorePill label="Portfolio Value" score={formatCompactCurrency(model.portfolioValue)} />
            <ScorePill label="Cash" score={formatCurrency(dataset.user.investableCash)} />
            <ScorePill label="Deploy Now" score={formatCurrency(model.deploymentPlan.deployNow)} />
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}

export function DashboardPage() {
  const { dataset, model, portfolioHistory, setInvestableCash } = usePortfolioWorkspace();
  const [selectedRange, setSelectedRange] = useState<DashboardRange>('12M');
  const opportunityRows = model.scorecards
    .filter(
      (card) =>
        !dataset.holdings.some((holding) => holding.symbol === card.symbol) &&
        ['Buy now', 'Buy partial', 'Accumulate slowly'].includes(card.action),
    )
    .slice(0, 5);
  const persistedSeries = buildDashboardHistorySeries(portfolioHistory, selectedRange);
  const fallbackSeries = homeSeries(model).slice(-rangeWindow(selectedRange));
  const displayedSeries = persistedSeries.usesPersistedHistory
    ? persistedSeries.values
    : fallbackSeries;
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
  const historyFootnote = persistedSeries.usesPersistedHistory
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

      <section className="home-hero">
        <div className="home-hero__main">
          <div className="home-hero__eyebrow">Home</div>
          <div className="home-hero__label">Portfolio value</div>
          <div className="home-hero__value">{formatCurrency(model.portfolioValue)}</div>
          <div className={`home-hero__delta home-hero__delta--${heroTone}`}>
            <strong>{signedCurrency(rangeDelta)}</strong>
            <span>{formatReturn(rangeReturn)}</span>
            <small>{selectedRange}</small>
          </div>
          <div className="range-switcher">
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
              >
                {range}
              </button>
            ))}
          </div>
          <div className="hero-chart-shell">
            <Sparkline values={displayedSeries} tone={heroTone} />
          </div>
          <div className="hero-chart-footnote">{historyFootnote}</div>
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
            <p>Add or update watchlists to monitor movers here.</p>
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

      <div className="dashboard-grid">
        <Panel
          title="For You"
          eyebrow="Ranked Opportunities"
          subtitle="The best new ideas after adjusting for your current portfolio and risk rules."
        >
          {opportunityRows.length === 0 ? (
            <div className="empty-state empty-state--compact">
              <h2>No fresh ideas right now.</h2>
              <p>The engine does not see a strong new buy that fits your current rules and portfolio.</p>
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
                    <p>{simpleActionText(card.action)}. {card.explanation.summary}</p>
                  </div>
                  <div className="home-opportunity-row__metrics">
                    <ScorePill label="Base 12M" score={formatReturn(card.expectedReturns[2].base)} />
                    <ScorePill label="Fit" score={card.portfolioFit.score} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel
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
              detail={`${dataset.user.maxPortfolioDrawdownTolerance * 100}% drawdown tolerance`}
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

export function DiscoveryPage() {
  const { model, symbolDirectory, symbolDirectoryState, symbolDirectoryError, ensureLiveSecurity } =
    usePortfolioWorkspace();
  const [sector, setSector] = useState('All');
  const [sortBy, setSortBy] = useState<'composite' | 'risk' | 'fit' | 'expected'>('composite');
  const [action, setAction] = useState('All');
  const [lookupQuery, setLookupQuery] = useState('');
  const lookupMatches = symbolMatches(symbolDirectory, lookupQuery);

  const rows = [...model.scorecards]
    .filter((card) => {
      const security = getSecurity(model, card.symbol);
      if (!security) {
        return false;
      }
      const sectorMatch = sector === 'All' || security.sector === sector;
      const actionMatch = action === 'All' || card.action === action;
      return sectorMatch && actionMatch;
    })
    .sort((left, right) => {
      if (sortBy === 'risk') {
        return left.risk.overall - right.risk.overall;
      }
      if (sortBy === 'fit') {
        return right.portfolioFit.score - left.portfolioFit.score;
      }
      if (sortBy === 'expected') {
        return right.expectedReturns[2].expected - left.expectedReturns[2].expected;
      }
      return right.composite - left.composite;
    });

  return (
    <div className="page">
      <PageHeader
        title="Explore Stocks"
        summary="Use this page to compare ideas in plain language: upside, risk, timing, and how well each stock fits your current portfolio."
      />

      <section className="guide-grid">
        <div className="guide-card">
          <div className="guide-card__eyebrow">Opportunity</div>
          <strong>How attractive the stock looks on its own</strong>
          <p>Higher scores mean stronger growth, quality, valuation support, and momentum.</p>
        </div>
        <div className="guide-card">
          <div className="guide-card__eyebrow">Fragility</div>
          <strong>How easily the thesis could break</strong>
          <p>Higher fragility means more balance-sheet, earnings, or drawdown risk.</p>
        </div>
        <div className="guide-card">
          <div className="guide-card__eyebrow">Fit</div>
          <strong>How well the stock belongs in your portfolio</strong>
          <p>A strong stock can still be a poor buy if it adds too much overlap or concentration.</p>
        </div>
      </section>

      <Panel
        title="Look Up Any S&P 500 Or Nasdaq Ticker"
        eyebrow="Live Coverage"
        subtitle="Search the synced Yahoo-compatible directory, then open a stock page to load live market data on demand."
      >
        <div className="lookup-panel">
          <label className="lookup-panel__field">
            Ticker or company name
            <input
              type="text"
              value={lookupQuery}
              onChange={(event) => setLookupQuery(event.target.value)}
              placeholder="AAPL or Microsoft"
            />
          </label>
          {lookupQuery.trim() ? (
            lookupMatches.length > 0 ? (
              <div className="lookup-results">
                {lookupMatches.map((entry) => (
                  <Link
                    key={entry.symbol}
                    to={`/stocks/${entry.symbol}`}
                    className="lookup-row"
                    onClick={() => {
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
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-card">
                <strong>No directory match</strong>
                <p>Try the exact ticker symbol. The synced directory currently covers S&P 500 constituents and Nasdaq-listed stocks that Yahoo recognizes.</p>
              </div>
            )
          ) : (
            <div className="text-card">
              <strong>
                {symbolDirectoryState === 'ready'
                  ? 'Directory ready'
                  : symbolDirectoryState === 'error'
                    ? 'Directory unavailable'
                    : 'Loading directory'}
              </strong>
              <p>
                {symbolDirectoryState === 'ready'
                  ? `${symbolDirectory.length} current directory symbols are available for lookup and live Yahoo market data loading.`
                  : symbolDirectoryState === 'error'
                    ? `The symbol directory could not be loaded: ${symbolDirectoryError ?? 'unknown error'}. You can still look up a stock directly from your portfolio.`
                    : 'Fetching the latest Yahoo-verified S&P 500 and Nasdaq symbol directory.'}
              </p>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Screen Controls" eyebrow="Filters" subtitle="Start broad, then narrow by sector, sort order, and action label.">
        <div className="filters">
          <label>
            Sector
            <select value={sector} onChange={(event) => setSector(event.target.value)}>
              {['All', ...new Set(model.dataset.securities.map((security) => security.sector))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Sort By
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
              <option value="composite">Composite</option>
              <option value="expected">12M Expected Return</option>
              <option value="fit">Portfolio Fit</option>
              <option value="risk">Lowest Risk</option>
            </select>
          </label>
          <label>
            Action
            <select value={action} onChange={(event) => setAction(event.target.value)}>
              {['All', ...new Set(model.scorecards.map((card) => card.action))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      <Panel title="Ranked Universe" eyebrow="Screen Results" subtitle={`${rows.length} securities match the active filter.`}>
        {rows.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <h2>No stocks match these filters.</h2>
            <p>Broaden one filter and the list will repopulate.</p>
          </div>
        ) : null}
        <Table
          columns={['Symbol', 'Sector', 'Action', 'Composite', 'Opportunity', 'Fragility', 'Timing', 'Fit', '12M Base']}
          rows={rows.map((card) => {
            const security = getSecurity(model, card.symbol);
            return [
              <Link key={`${card.symbol}-discovery`} to={`/stocks/${card.symbol}`} className="symbol-link">
                {card.symbol}
              </Link>,
              <span key={`${card.symbol}-sector`}>{security?.sector}</span>,
              <Tag key={`${card.symbol}-tag`} tone={toneForAction(card.action)}>
                {card.action}
              </Tag>,
              <span key={`${card.symbol}-c`}>{card.composite}</span>,
              <span key={`${card.symbol}-o`}>{card.opportunity.score}</span>,
              <span key={`${card.symbol}-f`}>{card.fragility.score}</span>,
              <span key={`${card.symbol}-t`}>{card.timing.score}</span>,
              <span key={`${card.symbol}-pf`}>{card.portfolioFit.score}</span>,
              <span key={`${card.symbol}-er`}>{formatReturn(card.expectedReturns[2].base)}</span>,
            ];
          })}
        />
      </Panel>
    </div>
  );
}

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
    ensureLiveSecurity,
    loadingSymbols,
    quoteErrors,
    livePriceSymbols,
  } =
    usePortfolioWorkspace();
  const [form, setForm] = useState({
    symbol: '',
    shares: 0,
    costBasis: 0,
  });
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

      {dataset.holdings.length === 0 ? (
        <section className="empty-state empty-state--compact">
          <div className="empty-state__eyebrow">No holdings yet</div>
          <h2>Add your first stock to activate portfolio analytics.</h2>
          <p>Enter a ticker, the number of shares you own, and your average buy price below.</p>
        </section>
      ) : null}

      <div className="kpi-grid">
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
        <Panel title="Portfolio Inputs" eyebrow="Manage Positions" subtitle="Use this form whenever you add, update, or remove a position.">
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
                  <p>Fetching the latest Yahoo-verified S&P 500 and Nasdaq tickers for search and validation.</p>
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
                    score={liveStatusText(normalizedFormSymbol, loadingSymbols, quoteErrors, livePriceSymbols)}
                    tone={livePriceSymbols.includes(normalizedFormSymbol) ? 'positive' : 'neutral'}
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
            </label>
            <button
              className="action-button"
              type="button"
              onClick={() => {
                void addHolding(form);
                setForm({ symbol: '', shares: 0, costBasis: 0 });
              }}
              disabled={!form.symbol || form.shares <= 0 || form.costBasis <= 0}
            >
              <Plus size={16} />
              <span>Add or update holding</span>
            </button>
          </div>
        </Panel>

        <Panel title="Current Holdings" eyebrow="Live Book" subtitle="Current price, market value, gain/loss, and the system's view on each holding.">
          <Table
            columns={['Ticker', 'Shares', 'Last Price', 'Market Value', 'Portfolio Weight', 'Gain/Loss', 'Risk', 'System View', 'Live Data', '']}
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
              <span key={`${holding.symbol}-value`}>{formatCurrency(holding.marketValue)}</span>,
              <span key={`${holding.symbol}-weight`}>{formatPercent(holding.weight)}</span>,
              <span key={`${holding.symbol}-pl`} className={holding.gainLossPct >= 0 ? 'text-positive' : 'text-negative'}>
                {holding.gainLossPct >= 0 ? '+' : ''}
                {holding.gainLossPct}%
              </span>,
              <span key={`${holding.symbol}-risk`}>{holding.riskContribution}</span>,
              <Tag key={`${holding.symbol}-action`} tone={toneForAction(holding.action)}>
                {simpleActionText(holding.action)}
              </Tag>,
              <span key={`${holding.symbol}-market`}>
                {liveStatusText(holding.symbol, loadingSymbols, quoteErrors, livePriceSymbols)}
              </span>,
              <button
                key={`${holding.symbol}-remove`}
                type="button"
                className="icon-button"
                onClick={() => removeHolding(holding.symbol)}
                aria-label={`Remove ${holding.symbol}`}
              >
                <Trash2 size={14} />
              </button>,
            ])}
          />
        </Panel>

        <Panel title="Rebalance and Trim" eyebrow="Portfolio Actions" subtitle="These are the holdings that need attention because they may be too large or too risky.">
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

      <div className="dashboard-grid">
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

export function RecommendationsPage() {
  const { model } = usePortfolioWorkspace();
  const buckets = Array.from(
    model.scorecards.reduce((map, card) => {
      const list = map.get(card.action) ?? [];
      list.push(card);
      map.set(card.action, list);
      return map;
    }, new Map<ActionLabel, typeof model.scorecards>()),
  );

  return (
    <div className="page">
      <PageHeader
        title="Ideas"
        summary="This page turns the math into plain actions: buy now, ease in slowly, wait, or avoid."
      />

      <section className="guide-grid">
        <div className="guide-card">
          <div className="guide-card__eyebrow">Buy now</div>
          <strong>Strong setup</strong>
          <p>Good stock, good timing, acceptable risk, and it fits your portfolio today.</p>
        </div>
        <div className="guide-card">
          <div className="guide-card__eyebrow">Watch only</div>
          <strong>Interesting but not ready</strong>
          <p>The business might be good, but timing, risk, or portfolio fit still needs work.</p>
        </div>
        <div className="guide-card">
          <div className="guide-card__eyebrow">Avoid / trim</div>
          <strong>Protect capital first</strong>
          <p>These names fail the current rules or make the portfolio less balanced.</p>
        </div>
      </section>

      <div className="recommendation-grid">
        {buckets.map(([action, cards]) => (
          <Panel
            key={action}
            title={action}
            eyebrow="Action Bucket"
            subtitle={`${cards.length} names currently fall into this bucket.`}
          >
            <div className="stack-list">
              {cards.slice(0, 5).map((card) => (
                <Link key={card.symbol} to={`/stocks/${card.symbol}`} className="recommendation-card">
                  <div className="recommendation-card__header">
                    <strong>{card.symbol}</strong>
                    <Tag tone={toneForAction(card.action)}>{card.action}</Tag>
                  </div>
                  <p>{card.explanation.summary}</p>
                  <div className="recommendation-card__metrics">
                    <ScorePill label="Composite" score={card.composite} />
                    <ScorePill label="Risk" score={card.risk.overall} />
                    <ScorePill label="Fit" score={card.portfolioFit.score} />
                  </div>
                </Link>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

export function PlannerPage() {
  const { dataset, model } = usePortfolioWorkspace();
  const [inputs, setInputs] = useState<PlannerInputs>({
    availableCash: dataset.user.investableCash,
    riskTolerance: dataset.user.riskTolerance,
    horizonMonths: dataset.user.timeHorizonMonths,
    priority: 'diversification',
    deploymentStyle: 'stage-entries',
  });

  const plan = buildDeploymentPlan(
    dataset,
    model.regime,
    model.scorecards,
    model.portfolioValue,
    inputs,
  );

  return (
    <div className="page">
      <PageHeader
        title="Plan New Money"
        summary="Tell the app how much cash you want to put to work and it will suggest how much to invest now, what to keep in reserve, and which stocks deserve that cash."
      />

      <div className="two-column-layout">
        <Panel title="Planner Inputs" eyebrow="Controls" subtitle="Change these inputs to see how your plan changes.">
          <div className="filters filters--stacked">
            <label>
              Cash To Invest
              <input
                type="number"
                min={1000}
                step={500}
                value={inputs.availableCash}
                onChange={(event) =>
                  setInputs((current) => ({
                    ...current,
                    availableCash: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              Risk Style
              <select
                value={inputs.riskTolerance}
                onChange={(event) =>
                  setInputs((current) => ({
                    ...current,
                    riskTolerance: event.target.value as PlannerInputs['riskTolerance'],
                  }))
                }
              >
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="moderate-aggressive">Moderate-aggressive</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>
            <label>
              Time Horizon (months)
              <input
                type="number"
                min={3}
                max={120}
                step={3}
                value={inputs.horizonMonths}
                onChange={(event) =>
                  setInputs((current) => ({
                    ...current,
                    horizonMonths: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              Priority
              <select
                value={inputs.priority}
                onChange={(event) =>
                  setInputs((current) => ({
                    ...current,
                    priority: event.target.value as PlannerInputs['priority'],
                  }))
                }
              >
                <option value="safety">Safety</option>
                <option value="growth">Growth</option>
                <option value="diversification">Diversification</option>
                <option value="conviction">Conviction</option>
              </select>
            </label>
            <label>
              How To Enter
              <select
                value={inputs.deploymentStyle}
                onChange={(event) =>
                  setInputs((current) => ({
                    ...current,
                    deploymentStyle: event.target.value as PlannerInputs['deploymentStyle'],
                  }))
                }
              >
                <option value="deploy-all">Deploy all</option>
                <option value="stage-entries">Stage entries</option>
                <option value="hold-flexibility">Hold flexibility</option>
              </select>
            </label>
          </div>
        </Panel>

        <Panel title="Recommended Deployment" eyebrow="Output" subtitle={plan.posture}>
          <div className="planner-callout">
            <h3>
              Deploy {formatCurrency(plan.deployNow)} now and keep {formatCurrency(plan.holdBack)} back.
            </h3>
            <p>
              Reserve target: {formatCurrency(plan.reserveTarget)}. Current regime: {model.regime.key}.
            </p>
          </div>
          <ul className="bullet-list">
            {plan.rationale.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="dashboard-grid">
        <Panel title="Suggested Allocations" eyebrow="Capital Plan" subtitle="Candidates are selected and sized under fit, risk, and reserve constraints.">
          <Table
            columns={['Symbol', 'Role', 'Dollars', 'Weight', 'Entry Style']}
            rows={plan.allocations.map((allocation) => [
              <Link key={allocation.symbol} to={`/stocks/${allocation.symbol}`} className="symbol-link">
                {allocation.symbol}
              </Link>,
              <span key={`${allocation.symbol}-role`}>{allocation.role}</span>,
              <span key={`${allocation.symbol}-dollars`}>{formatCurrency(allocation.dollars)}</span>,
              <span key={`${allocation.symbol}-weight`}>{formatPercent(allocation.weight)}</span>,
              <span key={`${allocation.symbol}-entry`}>{allocation.entryStyle}</span>,
            ])}
          />
        </Panel>

        <Panel title="What Not To Buy" eyebrow="Avoid List" subtitle="Names blocked by portfolio fit, risk, sector rules, or event timing.">
          <div className="stack-list">
            {plan.avoids.map((item) => (
              <div key={item.symbol} className="text-card">
                <strong>{item.symbol}</strong>
                <p>{item.reason}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function AlertsPage() {
  const { model } = usePortfolioWorkspace();
  return (
    <div className="page">
      <PageHeader
        title="Changes To Watch"
        summary="These alerts tell you what changed and why it matters, so you do not need to monitor every stock tick."
      />

      <Panel title="Alert Feed" eyebrow="Signal Log" subtitle="The most urgent issues are shown first.">
        <div className="stack-list">
          {model.alerts.map((alert) => (
            <Link key={alert.id} to={alert.route} className="alert-row alert-row--full">
              <div className="alert-row__icon">
                <Activity size={16} />
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
    </div>
  );
}

export function JournalPage() {
  const { dataset } = usePortfolioWorkspace();
  return (
    <div className="page">
      <PageHeader
        title="Decision Journal"
        summary="Write down why you bought something, what would prove you wrong, and what the system said at the time."
      />

      <div className="stack-grid">
        {dataset.journal.map((entry) => (
          <Panel
            key={entry.id}
            title={`${entry.symbol} - ${entry.decisionType}`}
            eyebrow={entry.decisionDate}
            subtitle={entry.systemSummary}
          >
            <div className="journal-block">
              <div>
                <h3>Original thesis</h3>
                <p>{entry.userThesis}</p>
              </div>
              <div>
                <h3>Invalidation rule</h3>
                <p>{entry.invalidationRule}</p>
              </div>
              <div>
                <h3>Outcome</h3>
                <p>{entry.outcome}</p>
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

export function StockPage() {
  const { model, loadingSymbols, quoteErrors, livePriceSymbols, ensureLiveSecurity } = usePortfolioWorkspace();
  const { symbol } = useParams();
  const normalizedSymbol = symbol ? normalizeSymbol(symbol) : undefined;

  useEffect(() => {
    if (
      normalizedSymbol &&
      (!getSecurity(model, normalizedSymbol) || !getScorecard(model, normalizedSymbol)) &&
      !loadingSymbols.includes(normalizedSymbol) &&
      !quoteErrors[normalizedSymbol]
    ) {
      void ensureLiveSecurity(normalizedSymbol);
    }
  }, [ensureLiveSecurity, loadingSymbols, model, normalizedSymbol, quoteErrors]);

  if (!normalizedSymbol) {
    return null;
  }

  const security = getSecurity(model, normalizedSymbol);
  const scorecard = getScorecard(model, normalizedSymbol);
  const holding = getHolding(model, normalizedSymbol);

  if (!security || !scorecard) {
    return (
      <div className="page">
        <PageHeader
          title={loadingSymbols.includes(normalizedSymbol) ? 'Loading Live Coverage' : 'Stock Not Found'}
          summary={
            loadingSymbols.includes(normalizedSymbol)
              ? `Fetching Yahoo Finance market data for ${normalizedSymbol}.`
              : quoteErrors[normalizedSymbol]
                ? `Yahoo Finance did not return usable coverage for ${normalizedSymbol}: ${quoteErrors[normalizedSymbol]}`
                : 'The requested symbol is not available in the current dataset yet.'
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title={`${security.symbol} - ${security.name}`}
        summary={`${simpleActionText(scorecard.action)}. ${security.description}`}
        meta={<Tag tone={toneForAction(scorecard.action)}>{scorecard.action}</Tag>}
      />

      <section className="guide-grid">
        <div className="guide-card">
          <div className="guide-card__eyebrow">Overall rating</div>
          <strong>{scorecard.composite}/100</strong>
          <p>This blends upside, risk, timing, fit, and confidence into one simple summary.</p>
        </div>
        <div className="guide-card">
          <div className="guide-card__eyebrow">Risk level</div>
          <strong>{scorecard.risk.bucket}</strong>
          <p>The risk score includes drawdowns, earnings gaps, valuation pressure, and business fragility.</p>
        </div>
        <div className="guide-card">
          <div className="guide-card__eyebrow">Portfolio fit</div>
          <strong>{scorecard.portfolioFit.score}/100</strong>
          <p>This shows whether the stock improves your portfolio or simply adds more of what you already own.</p>
        </div>
      </section>

      <div className="kpi-grid">
        <MetricCard
          label="Overall Rating"
          value={`${scorecard.composite}/100`}
          detail={`Confidence ${scorecard.confidence}/100`}
          tone={scorecard.composite >= 65 ? 'positive' : 'neutral'}
        />
        <MetricCard
          label="Risk Level"
          value={`${scorecard.risk.overall}/100`}
          detail={`${scorecard.risk.bucket} bucket`}
          tone={scorecard.risk.overall > 60 ? 'negative' : 'neutral'}
        />
        <MetricCard
          label="12M Base Case"
          value={formatReturn(scorecard.expectedReturns[2].base)}
          detail={`Bull ${formatReturn(scorecard.expectedReturns[2].bull)} - Bear ${formatReturn(
            scorecard.expectedReturns[2].bear,
          )}`}
          tone="positive"
        />
        <MetricCard
          label="Suggested Position Size"
          value={formatCurrency(scorecard.allocation.suggestedDollars)}
          detail={`${formatPercent(scorecard.allocation.suggestedWeight * 100)} target weight`}
          tone="neutral"
        />
      </div>

      <Panel
        title="Active Market Data"
        eyebrow="Live Status"
        subtitle={
          loadingSymbols.includes(normalizedSymbol)
            ? 'Fetching live quote coverage for this symbol.'
            : quoteErrors[normalizedSymbol]
              ? `Yahoo Finance did not return a usable live quote: ${quoteErrors[normalizedSymbol]}`
              : livePriceSymbols.includes(normalizedSymbol)
                ? 'Live quote polling is active for this holding.'
                : 'Current view is coming from the saved research snapshot.'
        }
      >
        <div className="mini-stack">
          <ScorePill label="Current Price" score={formatPrice(security.price)} />
          <ScorePill label="1M Return" score={formatReturn(security.metrics.ret1m)} />
          <ScorePill label="3M Return" score={formatReturn(security.metrics.ret3m)} />
          <ScorePill label="Volume Signal" score={security.metrics.abnormalVolume20d.toFixed(2)} tone="neutral" />
        </div>
      </Panel>

      <div className="dashboard-grid">
        <Panel title="Quick Read" eyebrow={security.sector} subtitle={security.industry}>
          <div className="detail-grid">
            <div>
              <h3>What the company does</h3>
              <p>{security.description}</p>
            </div>
            <div>
              <h3>Market Cap</h3>
              <p>{formatCompactCurrency(security.marketCap * 1_000_000_000)}</p>
            </div>
            <div>
              <h3>Price</h3>
              <p>{formatPrice(security.price)}</p>
            </div>
            <div>
              <h3>Your current position</h3>
              <p>{holding ? `${holding.weight}% of your portfolio` : 'You do not currently own it'}</p>
            </div>
          </div>
        </Panel>

        <Panel title="Why the Rating Looks Like This" eyebrow="Subscores" subtitle="Each part below explains a different part of the decision.">
          <div className="signal-grid">
            <SignalBar label="Opportunity" value={scorecard.opportunity.score} tone="positive" />
            <SignalBar label="Fragility" value={scorecard.fragility.score} tone="negative" />
            <SignalBar label="Timing" value={scorecard.timing.score} tone="positive" />
            <SignalBar label="Portfolio Fit" value={scorecard.portfolioFit.score} tone="positive" />
          </div>
        </Panel>

        <Panel title="Expected Return Scenarios" eyebrow="Range Of Outcomes" subtitle="These are ranges, not promises. The goal is to show what could happen, not pretend we know the future.">
          <Table
            columns={['Horizon', 'Bear', 'Base', 'Bull', 'P(Up)', 'P(Outperform)', 'P(Drawdown)']}
            rows={scorecard.expectedReturns.map((scenario) => [
              <span key={`${scenario.horizon}-label`}>{scenario.horizon}</span>,
              <span key={`${scenario.horizon}-bear`}>{formatReturn(scenario.bear)}</span>,
              <span key={`${scenario.horizon}-base`}>{formatReturn(scenario.base)}</span>,
              <span key={`${scenario.horizon}-bull`}>{formatReturn(scenario.bull)}</span>,
              <span key={`${scenario.horizon}-up`}>{formatPercent(scenario.probabilityPositive * 100)}</span>,
              <span key={`${scenario.horizon}-out`}>{formatPercent(scenario.probabilityOutperform * 100)}</span>,
              <span key={`${scenario.horizon}-dd`}>{formatPercent(scenario.probabilityDrawdown * 100)}</span>,
            ])}
          />
        </Panel>

        <Panel title="Plain-English Explanation" eyebrow="Why The System Thinks This" subtitle={scorecard.explanation.summary}>
          <div className="triple-columns">
            <div>
              <h3>Top drivers</h3>
              {scorecard.explanation.topDrivers.map((driver) => (
                <div key={driver.label} className="text-card">
                  <strong>{driver.label}</strong>
                  <p>{driver.narrative}</p>
                </div>
              ))}
            </div>
            <div>
              <h3>Top penalties</h3>
              {scorecard.explanation.topPenalties.map((penalty) => (
                <div key={penalty.label} className="text-card">
                  <strong>{penalty.label}</strong>
                  <p>{penalty.narrative}</p>
                </div>
              ))}
            </div>
            <div>
              <h3>What would improve or weaken the case</h3>
              <ul className="bullet-list">
                {scorecard.explanation.changeTriggers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </Panel>

        <Panel title="Trend Context" eyebrow="Context" subtitle="These charts help you see the recent path of price and model score.">
          <div className="history-stack">
            <div>
              <div className="history-stack__label">Price history</div>
              <Sparkline values={security.priceHistory} tone="positive" />
            </div>
            <div>
              <div className="history-stack__label">Score history</div>
              <Sparkline values={security.scoreHistory} tone="neutral" />
            </div>
          </div>
        </Panel>

        <Panel title="Notes And Fit" eyebrow="Manual Layer" subtitle="Your own thesis still matters. The model should support judgment, not replace it.">
          <div className="triple-columns">
            <div>
              <h3>Thesis tags</h3>
              <ul className="bullet-list">
                {security.thesisNotes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Watch points</h3>
              <ul className="bullet-list">
                {scorecard.explanation.watchPoints.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Portfolio fit impact</h3>
              <ul className="bullet-list">
                <li>Overlap score: {scorecard.fitImpact.overlapScore}/100</li>
                <li>Sector weight after add: {scorecard.fitImpact.sectorWeightAfter}%</li>
                <li>Diversification delta: {scorecard.fitImpact.diversificationDelta}</li>
                <li>Portfolio vol delta proxy: {scorecard.fitImpact.portfolioVolDelta}</li>
              </ul>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
