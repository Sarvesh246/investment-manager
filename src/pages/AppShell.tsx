/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BriefcaseBusiness,
  ChartCandlestick,
  ChevronUp,
  LayoutDashboard,
  BookText,
  Menu,
  PanelLeftClose,
  Radar,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Panel,
  ScorePill,
} from './../components/ui';
import { Modal } from './../components/Modal';
import {
  currentSetupSummary,
  freshnessText,
  formatClockTime,
  formatCompactCurrency,
  formatCurrency,
  heldQuoteSessionSummary,
  navigation,
  toneForFreshness,
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

export function bindSkipLinkFocus(
  skipLink: Pick<HTMLAnchorElement, 'addEventListener' | 'removeEventListener'>,
  mainContent: Pick<HTMLElement, 'focus' | 'scrollIntoView'>,
) {
  const handleSkip = (event: Pick<MouseEvent, 'preventDefault'>) => {
    event.preventDefault();
    mainContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
    mainContent.focus();
  };

  skipLink.addEventListener('click', handleSkip as EventListener);

  return () => {
    skipLink.removeEventListener('click', handleSkip as EventListener);
  };
}

const SCROLL_THRESHOLD_PX = 400;

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const previousPathRef = useRef(location.pathname);
  useKeyboardShortcuts();
  const online = useOnline();
  const {
    dataset,
    model,
    lastQuoteRefreshAt,
    livePriceSymbols,
    liveQuotes,
    quoteErrors,
    symbolDirectory,
    symbolDirectoryState,
  } = usePortfolioWorkspace();
  const { symbol } = useParams<{ symbol: string }>();
  const liveHeldCount = model.holdings.filter(
    (holding) => livePriceSymbols.includes(holding.symbol) && !quoteErrors[holding.symbol],
  ).length;
  const liveSessionSummary = heldQuoteSessionSummary(model.holdings, liveQuotes);
  const lastUpdatedAt =
    lastQuoteRefreshAt ?? dataset.snapshotGeneratedAt ?? dataset.asOf;
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
  const quickCommands = useMemo(
    () => [
      { id: 'home', label: 'Go to Home', detail: 'Simple dashboard summary', path: '/' },
      { id: 'portfolio', label: 'Open Portfolio', detail: 'Holdings, cash, and ledger', path: '/portfolio' },
      { id: 'add-holding', label: 'Add or update a holding', detail: 'Portfolio manage form', path: '/portfolio' },
      { id: 'ideas', label: 'Review ideas', detail: 'Best stocks to review', path: '/recommendations' },
      { id: 'planner', label: 'Open planner', detail: 'Decide how much cash to deploy', path: '/planner' },
      { id: 'watch', label: 'Open Watch', detail: 'Problems and changes to review', path: '/alerts' },
      { id: 'explore', label: 'Explore stocks', detail: 'Search and compare stocks', path: '/discovery' },
      { id: 'settings', label: 'Open settings', detail: 'Rules, themes, and watchlists', path: '/settings' },
      { id: 'journal', label: 'Open journal', detail: 'Review your decisions and notes', path: '/journal' },
    ],
    [],
  );
  const normalizedCommandQuery = commandQuery.trim().toLowerCase();
  const commandResults = useMemo(() => {
    const routeMatches =
      normalizedCommandQuery.length === 0
        ? quickCommands
        : quickCommands.filter(
            (item) =>
              item.label.toLowerCase().includes(normalizedCommandQuery) ||
              item.detail.toLowerCase().includes(normalizedCommandQuery),
          );

    const holdingMatches = model.holdings
      .filter(
        (holding) =>
          normalizedCommandQuery.length > 0 &&
          holding.symbol.toLowerCase().includes(normalizedCommandQuery),
      )
      .slice(0, 4)
      .map((holding) => ({
        id: `holding-${holding.symbol}`,
        label: `Open ${holding.symbol}`,
        detail: 'Held position',
        path: `/stocks/${holding.symbol}`,
      }));

    const symbolMatches = symbolDirectory
      .filter(
        (entry) =>
          normalizedCommandQuery.length > 0 &&
          (entry.symbol.toLowerCase().includes(normalizedCommandQuery) ||
            entry.displaySymbol.toLowerCase().includes(normalizedCommandQuery) ||
            entry.name.toLowerCase().includes(normalizedCommandQuery)),
      )
      .slice(0, 6)
      .map((entry) => ({
        id: `symbol-${entry.symbol}`,
        label: `Open ${entry.displaySymbol}`,
        detail: entry.name,
        path: `/stocks/${entry.symbol}`,
      }));

    return [...routeMatches, ...holdingMatches, ...symbolMatches].slice(0, 12);
  }, [model.holdings, normalizedCommandQuery, quickCommands, symbolDirectory]);

  const breadcrumbNav = useMemo(() => {
    if (location.pathname.startsWith('/stocks/') && symbol) {
      return (
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span className="breadcrumbs__sep" aria-hidden="true">/</span>
          <Link to="/recommendations">Ideas</Link>
          <span className="breadcrumbs__sep" aria-hidden="true">/</span>
          <span className="breadcrumbs__current">{symbol}</span>
        </nav>
      );
    }

    const path = location.pathname;
    const item = path !== '/' && navigation.find((n) => n.to !== '/' && path === n.to);
    if (!item) return null;

    return (
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span className="breadcrumbs__sep" aria-hidden="true">/</span>
        <span className="breadcrumbs__current">{item.label}</span>
      </nav>
    );
  }, [location.pathname, symbol]);

  const closeCommandPalette = useCallback(() => {
    setCommandOpen(false);
    setCommandQuery('');
  }, []);

  useEffect(() => {
    const skipLink = document.querySelector<HTMLAnchorElement>('.skip-link');
    const mainContent = document.getElementById('main-content');

    if (!skipLink || !mainContent) {
      return;
    }

    return bindSkipLinkFocus(skipLink, mainContent);
  }, []);

  useEffect(() => {
    function onScroll() {
      setShowBackToTop(window.scrollY > SCROLL_THRESHOLD_PX);
    }

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }

      if (!commandOpen || isEditable || event.key !== '/') {
        return;
      }

      event.preventDefault();
      setCommandQuery('');
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandOpen]);

  useEffect(() => {
    if (previousPathRef.current === location.pathname) {
      return;
    }

    previousPathRef.current = location.pathname;

    if (!commandOpen) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCommandOpen(false);
      setCommandQuery('');
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [commandOpen, location.pathname]);

  const runCommand = useCallback((path: string) => {
    navigate(path);
    closeCommandPalette();
  }, [closeCommandPalette, navigate]);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className={sidebarOpen ? 'app-shell' : 'app-shell app-shell--sidebar-closed'}>
      <button
        type="button"
        className="sidebar__toggle sidebar__toggle--menu"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open sidebar"
        aria-expanded={sidebarOpen}
      >
        <Menu size={22} aria-hidden />
      </button>
      <aside className="sidebar" aria-hidden={!sidebarOpen}>
        <div className="sidebar__header">
          <div className="brand">
          <div className="brand__crest">ACC</div>
          <div>
            <strong>Atlas Capital Center</strong>
            <span>Guided Wealth Console</span>
          </div>
        </div>
          <button
            type="button"
            className="sidebar__close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <PanelLeftClose size={18} aria-hidden />
          </button>
        </div>

        <div className="sidebar__intro">
          <strong>Start here</strong>
          <p>Add your holdings, check today&apos;s plan, then review the ideas list for new money.</p>
          {symbolDirectoryState === 'loading' ? (
            <p className="sidebar__loading-symbols" aria-live="polite">
              Loading symbols...
            </p>
          ) : null}
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
                onClick={() => setSidebarOpen(false)}
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
      {sidebarOpen ? (
        <div
          className="sidebar__backdrop"
          role="presentation"
          aria-hidden
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <main id="main-content" className="workspace" tabIndex={-1}>
        {!online && (
          <div className="workspace__offline-sticky" role="alert">
            <div className="workspace__offline-banner">
              You are offline. Live quotes and data sync are unavailable.
            </div>
          </div>
        )}
        <div className="workspace__topbar">
          <div className="workspace__topbar-row">
          <div className="workspace__topbar-context">
            {breadcrumbNav}
            <div className="workspace__eyebrow">Market mode</div>
            <strong className="workspace__topbar-title">{model.regime.key}</strong>
            <div className="workspace__subtext">
              Last updated {formatClockTime(lastUpdatedAt)}.
              Live quote refresh is working for {liveHeldCount} of {model.holdings.length} held {model.holdings.length === 1 ? 'position' : 'positions'}.
              {liveSessionSummary ? ` ${liveSessionSummary}` : ''}
            </div>
          </div>
          <div className="workspace__meta">
            <ScorePill
              label="Data"
              score={liveStatusLabel}
              title="Live quote coverage for your holdings (Yahoo Finance). Full = all positions have recent prices."
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
            <ScorePill
              label="Model"
              score={freshnessText(
                model.freshnessHierarchy.model.ageDays,
                model.freshnessHierarchy.model.status,
              )}
              title="Age of the last reported financial period. Fundamentals update when companies file, not daily."
              tone={toneForFreshness(model.freshnessHierarchy.model.status)}
            />
            <ScorePill label="Portfolio Value" score={formatCompactCurrency(model.portfolioValue)} />
            <ScorePill label="Cash" score={formatCurrency(dataset.user.investableCash)} />
            <button
              type="button"
              className="workspace__command-button"
              onClick={() => setCommandOpen(true)}
              aria-label="Open command palette"
            >
              <Search size={14} aria-hidden />
              <span>Jump / Search</span>
              <strong>Ctrl+K</strong>
            </button>
            <Link to="/planner" className="workspace__deploy">
              <span>Deploy Now</span>
              <strong>{formatCurrency(model.deploymentPlan.deployNow)}</strong>
            </Link>
          </div>
          </div>
        </div>
        <Outlet />
      </main>

      {showBackToTop ? (
        <button
          type="button"
          className="back-to-top"
          onClick={scrollToTop}
          aria-label="Back to top"
        >
          <ChevronUp size={22} strokeWidth={2.5} />
        </button>
      ) : null}

      <Modal
        isOpen={commandOpen}
        onClose={closeCommandPalette}
        title="Jump to anything"
        className="command-palette"
      >
        <div className="command-palette__body">
          <label className="command-palette__search">
            Search pages, actions, or stock symbols
            <input
              type="text"
              autoFocus
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              placeholder="Portfolio, planner, AAPL..."
            />
          </label>
          <div className="command-palette__list" role="listbox" aria-label="Command results">
            {commandResults.length === 0 ? (
              <div className="text-card">
                <strong>No quick match</strong>
                <p>Try a page name like "portfolio" or a stock symbol like "MSFT".</p>
              </div>
            ) : (
              commandResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="command-palette__item"
                  onClick={() => runCommand(item.path)}
                >
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </div>
                  <span>Open</span>
                </button>
              ))
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

