import type { CSSProperties } from 'react';
import {
  BriefcaseBusiness,
  ChartCandlestick,
  LayoutDashboard,
  BookText,
  Radar,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Panel,
  ScorePill,
} from './../components/ui';
import {
  currentSetupSummary,
  formatClockTime,
  formatCompactCurrency,
  formatCurrency,
  heldQuoteSessionSummary,
  navigation,
  themeOptions,
} from './shared';
import { useKeyboardShortcuts } from './../hooks/useKeyboardShortcuts';
import { useOnline } from './../hooks/useOnline';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';

const navIcons: Record<string, React.ComponentType<{ size?: number }>> = {
  '/': LayoutDashboard,
  '/discovery': Search,
  '/portfolio': BriefcaseBusiness,
  '/recommendations': Radar,
  '/planner': ChartCandlestick,
  '/alerts': ShieldAlert,
  '/settings': SlidersHorizontal,
  '/journal': BookText,
};

export function AppShell() {
  const location = useLocation();
  useKeyboardShortcuts();
  const online = useOnline();
  const { dataset, model, lastQuoteRefreshAt, livePriceSymbols, liveQuotes, quoteErrors, theme, setTheme } = usePortfolioWorkspace();
  const liveHeldCount = model.holdings.filter(
    (holding) => livePriceSymbols.includes(holding.symbol) && !quoteErrors[holding.symbol],
  ).length;
  const liveSessionSummary = heldQuoteSessionSummary(model.holdings, liveQuotes);
  const liveStatusLabel =
    model.holdings.length === 0
      ? dataset.dataMode ?? 'seeded'
      : liveHeldCount === model.holdings.length
        ? 'live'
        : liveHeldCount > 0
          ? 'partial'
          : 'unavailable';
  const actionableIdeasCount = model.scorecards.filter((card) =>
    ['Buy now', 'Buy partial', 'Accumulate slowly'].includes(card.action),
  ).length;
  const urgentAlertCount = model.alerts.filter((alert) => alert.severity === 'high').length;

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
          {navigation.map(({ to, label }) => {
            const Icon = navIcons[to];
            return (
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
                {Icon ? <Icon size={18} /> : null}
                <span>{label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar__quick-actions">
          <div className="sidebar__quick-actions-title">Common tasks</div>
          <Link to="/portfolio" className="sidebar__task-card">
            <span>Update portfolio</span>
            <strong>{model.holdings.length} holdings</strong>
          </Link>
          <Link to="/recommendations" className="sidebar__task-card">
            <span>Review candidates</span>
            <strong>{actionableIdeasCount} actionable</strong>
          </Link>
          <Link to="/alerts" className="sidebar__task-card">
            <span>Check risks</span>
            <strong>{urgentAlertCount} urgent</strong>
          </Link>
        </div>

        <div className="sidebar__theme-row">
          <span className="sidebar__theme-label">Theme</span>
          <div className="sidebar__theme-switcher">
            {themeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                title={`Switch to ${option.label} theme`}
                aria-label={`Switch to ${option.label} theme`}
                aria-pressed={theme === option.id}
                className={theme === option.id ? 'theme-swatch theme-swatch--active' : 'theme-swatch'}
                style={{ '--theme-accent': option.accent } as CSSProperties}
                onClick={() => setTheme(option.id)}
              />
            ))}
          </div>
        </div>

        <Panel
          title="Current Setup"
          eyebrow="Active Profile"
          subtitle={currentSetupSummary(dataset, model)}
          className="sidebar__profile"
        >
          <div className="mini-stack">
            <ScorePill label="Reserve now" score={formatCurrency(model.deploymentPlan.holdBack)} />
            <ScorePill label="Target reserve" score={formatCurrency(dataset.user.targetCashReserve)} />
            <ScorePill label="Risk style" score={dataset.user.riskTolerance} />
            <ScorePill
              label="Sector cap"
              score={`${Math.round(dataset.user.maxSectorWeight * 100)}%`}
            />
            <ScorePill label="Benchmark" score={dataset.user.benchmarkSymbol} />
          </div>
        </Panel>
      </aside>

      <main id="main-content" className="workspace">
        <div className="workspace__topbar">
          {!online && (
            <div className="workspace__offline-banner" role="alert">
              You are offline. Live quotes and data sync are unavailable.
            </div>
          )}
          <div className="workspace__topbar-row">
          <div>
            <div className="workspace__eyebrow">Market mode</div>
            <strong>{model.regime.key}</strong>
            <div className="workspace__subtext">
              Prices refreshed {formatClockTime(lastQuoteRefreshAt)}. Live quote refresh is working
              for {liveHeldCount} of {model.holdings.length} held {model.holdings.length === 1 ? 'position' : 'positions'}.
              {liveSessionSummary ? ` ${liveSessionSummary}` : ''}
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
            <Link to="/planner" className="workspace__deploy">
              <span>Deploy Now</span>
              <strong>{formatCurrency(model.deploymentPlan.deployNow)}</strong>
            </Link>
          </div>
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
