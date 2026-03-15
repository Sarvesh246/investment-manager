import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, LayoutDashboard, ListChecks, TrendingUp } from 'lucide-react';
import { HoverableChart } from './../components/HoverableChart';
import { PageJumpNav, Panel, ScorePill, SignalBar, Tag } from './../components/ui';
import { useStoredState } from './../hooks/useStoredState';
import { plainLanguageHelp } from './../lib/helpText';
import { formatCurrency, formatPercent, formatReturn } from './../lib/format';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';
import { BuyingPowerEditor } from './shared-components';
import type { DashboardRange } from './shared';
import {
  actionTimelineText,
  alertPriorityLabel,
  buildDashboardHistorySeries,
  buyBlocker,
  buyPotentialScore,
  dashboardRanges,
  freshnessText,
  homeSeries,
  potentialBuyRows,
  quickActionNarrative,
  rangeWindow,
  signedCurrency,
  toneForAction,
  toneForAlert,
  toneForConfidenceBand,
  toneForFreshness,
} from './shared';

const DASHBOARD_RANGE_KEY = 'ic-dashboard-range';
const HOME_MODE_KEY = 'ic-home-mode';
const HOME_HIDE_NOISE_KEY = 'ic-home-hide-noise';
const HOME_PANEL_PREFS_KEY = 'ic-home-panel-prefs';

const HOME_PANELS: Record<string, string> = {
  'home-actions': 'Best move',
  'home-problems': 'Problems',
  'home-review': 'Best stocks to review',
  'home-mix': 'Your mix',
  'home-knows': 'Trust check',
  'home-holdings': 'Your holdings',
};

function jumpToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function DashboardPage() {
  const location = useLocation();
  const { dataset, model, portfolioHistory, setInvestableCash } = usePortfolioWorkspace();
  const [selectedRange, setSelectedRange] = useStoredState<DashboardRange>(DASHBOARD_RANGE_KEY, '12M');
  const [homeMode, setHomeMode] = useStoredState<'simple' | 'advanced'>(HOME_MODE_KEY, 'simple');
  const [hideLowPriority, setHideLowPriority] = useStoredState(HOME_HIDE_NOISE_KEY, true);
  const [panelPrefs, setPanelPrefs] = useStoredState<Record<string, { collapsed?: boolean; pinned?: boolean }>>(
    HOME_PANEL_PREFS_KEY,
    {},
  );

  const hasPortfolioData = model.holdings.length > 0 || dataset.user.investableCash > 0;
  const candidates = potentialBuyRows(model).slice(0, 5);
  const actionableOpportunityCount = model.scorecards.filter((card) =>
    ['Buy now', 'Buy partial', 'Accumulate slowly'].includes(card.action),
  ).length;
  const leadingIdea = candidates[0];
  const filteredAlerts = hideLowPriority ? model.alerts.filter((a) => a.severity !== 'low') : model.alerts;
  const primaryAlert = filteredAlerts[0] ?? model.alerts[0];
  const displayedChanges = hideLowPriority ? model.notableChanges.slice(0, 4) : model.notableChanges;
  const holdingsRail = [...model.holdings].sort((a, b) => b.marketValue - a.marketValue).slice(0, 5);
  const persistedSeries = buildDashboardHistorySeries(portfolioHistory, selectedRange);
  const displayedSeries = persistedSeries.usesPersistedHistory
    ? persistedSeries.values
    : homeSeries(model).slice(-rangeWindow(selectedRange));
  const displayedTimestamps = persistedSeries.usesPersistedHistory ? persistedSeries.timestamps : undefined;
  const startValue = displayedSeries[0] ?? model.portfolioValue;
  const endValue = displayedSeries.at(-1) ?? model.portfolioValue;
  const rangeDelta = endValue - startValue;
  const rangeReturn = startValue > 0 ? endValue / startValue - 1 : 0;
  const heroTone = rangeDelta > 0 ? 'positive' : rangeDelta < 0 ? 'negative' : 'neutral';
  const bestMoveTitle = model.deploymentPlan.deployNow > 0 ? 'Put some money to work' : 'Wait before buying';
  const bestMoveDetail =
    model.deploymentPlan.deployNow > 0
      ? `Use ${formatCurrency(model.deploymentPlan.deployNow)} now and keep ${formatCurrency(model.deploymentPlan.holdBack)} in cash.`
      : `Keep ${formatCurrency(model.deploymentPlan.holdBack)} in cash for now while the setup is weak.`;
  const biggestIssueTitle = primaryAlert?.kind ?? model.concentrationIssues[0] ?? 'No urgent problem right now';
  const biggestIssueDetail = primaryAlert?.message ?? 'No material portfolio breach detected.';
  const pinnedPanels = Object.entries(HOME_PANELS).filter(([id]) => panelPrefs[id]?.pinned);
  const averageFundamentalAge =
    model.scorecards.length > 0
      ? Math.round(model.scorecards.reduce((sum, card) => sum + card.freshness.fundamentalsFreshnessDays, 0) / model.scorecards.length)
      : 0;
  const knows = [
    `You have ${formatCurrency(dataset.user.investableCash)} ready to invest and ${model.holdings.length} current holding${model.holdings.length === 1 ? '' : 's'}.`,
    `Held prices are ${freshnessText(model.freshnessHierarchy.quotes.ageDays, model.freshnessHierarchy.quotes.status).toLowerCase()}.`,
    primaryAlert ? `The biggest current issue is ${primaryAlert.kind.toLowerCase()}.` : 'No major portfolio issue is flagged right now.',
  ];
  const unknowns = [
    averageFundamentalAge > 45
      ? `Some company data is older: the average financial snapshot is about ${averageFundamentalAge} days old.`
      : 'Company data is reasonably current, but it still updates much more slowly than prices.',
    model.ledgerSummary.transactionCount === 0
      ? 'Without recorded buys, sells, and deposits, long-run performance is only approximate.'
      : 'Recorded transactions are helping keep cost basis and performance more honest.',
    dataset.validationReport?.pairCount
      ? `The model has validation history, but it still only has ${dataset.validationReport.pairCount} snapshot pair${dataset.validationReport.pairCount === 1 ? '' : 's'} behind it.`
      : 'There is not enough stored model history yet to strongly prove the recommendations over time.',
  ];

  function togglePanelCollapse(id: string) {
    setPanelPrefs((current) => ({
      ...current,
      [id]: { ...current[id], collapsed: !(current[id]?.collapsed ?? false) },
    }));
  }

  function togglePanelPin(id: string) {
    setPanelPrefs((current) => ({
      ...current,
      [id]: { ...current[id], pinned: !(current[id]?.pinned ?? false) },
    }));
  }

  useEffect(() => {
    const section = new URLSearchParams(location.search).get('section');
    if (section) {
      const el = document.getElementById(section);
      if (el) {
        const t = window.setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
        return () => window.clearTimeout(t);
      }
    }
  }, [location.search]);

  return (
    <div className="page page--home">
      {!hasPortfolioData ? (
        <section className="empty-state">
          <div className="empty-state__icon" aria-hidden="true"><LayoutDashboard size={48} strokeWidth={1.25} /></div>
          <div className="empty-state__eyebrow">Welcome</div>
          <h2>Start by adding your first holding or your cash balance.</h2>
          <p>This home screen becomes useful once the app knows what you own and how much money you have ready to invest.</p>
          <div className="summary-card__actions">
            <Link to="/portfolio" className="action-button">Add holdings</Link>
            <Link to="/planner" className="panel-link">Open plan page</Link>
          </div>
        </section>
      ) : null}

      <section className="home-toolbar">
        <div className="view-toggle" role="group" aria-label="Home view mode">
          <button type="button" className={homeMode === 'simple' ? 'view-toggle__button view-toggle__button--active' : 'view-toggle__button'} onClick={() => setHomeMode('simple')} aria-pressed={homeMode === 'simple'}>Simple</button>
          <button type="button" className={homeMode === 'advanced' ? 'view-toggle__button view-toggle__button--active' : 'view-toggle__button'} onClick={() => setHomeMode('advanced')} aria-pressed={homeMode === 'advanced'}>Advanced</button>
        </div>
        <label className="toggle-chip">
          <input type="checkbox" checked={hideLowPriority} onChange={(e) => setHideLowPriority(e.target.checked)} />
          <span>Hide low-priority noise</span>
        </label>
      </section>

      <section className="today-strip" aria-label="Today summary">
        <div className="today-strip__item"><span>Best move</span><strong>{bestMoveTitle}</strong><small>{bestMoveDetail}</small></div>
        <div className="today-strip__item"><span>Cash to keep</span><strong>{formatCurrency(model.deploymentPlan.holdBack)}</strong><small>Reserve the engine wants left untouched.</small></div>
        <div className="today-strip__item"><span>Biggest issue</span><strong>{biggestIssueTitle}</strong><small>{biggestIssueDetail}</small></div>
        <div className="today-strip__item"><span>Best stock to review</span><strong>{leadingIdea?.symbol ?? 'No standout right now'}</strong><small>{leadingIdea ? buyBlocker(leadingIdea) : 'Cash is winning over new buys today.'}</small></div>
      </section>

      {homeMode === 'advanced' ? (
        <>
          <PageJumpNav items={[{ href: '#home-overview', label: 'Your money', detail: 'Value, cash, and trend' }, { href: '#home-actions', label: 'Best move', detail: 'What to do right now' }, { href: '#home-problems', label: 'Problems', detail: 'What needs attention' }, { href: '#home-mix', label: 'Your mix', detail: 'Where your money is concentrated' }]} compact sticky={false} />
          {pinnedPanels.length > 0 ? (
            <section className="pinned-strip">
              <span className="pinned-strip__label">Pinned sections</span>
              <div className="pinned-strip__actions">
                {pinnedPanels.map(([id, label]) => (
                  <button key={id} type="button" className="pill-button" onClick={() => jumpToSection(id)}>{label}</button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <section id="home-overview" className="home-hero page-section">
        <div className={`home-hero__main ${homeMode === 'simple' ? 'home-hero__main--simple' : ''}`}>
          <div className="home-hero__summary">
            <div className="home-hero__eyebrow">Home</div>
            <div className="home-hero__label">Portfolio value</div>
            <div className="home-hero__value">{formatCurrency(model.portfolioValue)}</div>
            <div className={`home-hero__delta home-hero__delta--${heroTone}`}>
              <strong>{signedCurrency(rangeDelta)}</strong>
              <span>{formatReturn(rangeReturn)}</span>
              <small>{selectedRange}</small>
            </div>
            {homeMode === 'advanced' ? (
              <div className="range-switcher" role="group" aria-label="Chart time range">
                {dashboardRanges.map((range) => (
                  <button key={range} type="button" className={range === selectedRange ? 'range-switcher__button range-switcher__button--active' : 'range-switcher__button'} onClick={() => setSelectedRange(range)} aria-pressed={range === selectedRange}>{range}</button>
                ))}
              </div>
            ) : (
              <p className="home-hero__summary-note">Quick read: this is your total account value right now, including cash.</p>
            )}
          </div>
          <div className="home-hero__chart-column">
            <div className="hero-chart-shell"><HoverableChart values={displayedSeries} timestamps={displayedTimestamps} tone={heroTone} /></div>
            <div className="hero-chart-footnote">
              {persistedSeries.usesPersistedHistory ? 'This chart uses saved account history.' : 'The chart is estimating your recent path because there is not much saved history yet.'}
            </div>
          </div>
          <div className="home-hero__side">
            <div className="summary-card summary-card--primary">
              <div className="summary-card__eyebrow">Buying Power</div>
              <strong>{formatCurrency(dataset.user.investableCash)}</strong>
              <p>Deploy {formatCurrency(model.deploymentPlan.deployNow)} now. Hold back {formatCurrency(model.deploymentPlan.holdBack)} as reserve.</p>
              <BuyingPowerEditor value={dataset.user.investableCash} onChange={setInvestableCash} className="buying-power-editor buying-power-editor--compact" />
              <div className="summary-card__actions">
                <Link to="/portfolio" className="action-button">Manage portfolio</Link>
                <Link to="/planner" className="panel-link">Run planner</Link>
              </div>
            </div>
            {homeMode === 'advanced' ? (
              <div className="summary-card">
                <div className="summary-card__eyebrow">At A Glance</div>
                <div className="summary-list">
                  <div className="summary-list__item"><span>Holdings</span><strong>{model.holdings.length}</strong></div>
                  <div className="summary-list__item"><span>Market mood (regime)</span><strong>{model.regime.key}</strong></div>
                  <div className="summary-list__item"><span>Best stock to review</span><strong>{leadingIdea?.symbol ?? 'No buy candidate'}</strong></div>
                  <div className="summary-list__item"><span>Biggest issue</span><strong>{primaryAlert?.kind ?? 'No active breach'}</strong></div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className={`guide-grid ${homeMode === 'simple' ? 'guide-grid--simple' : ''}`}>
        <div className="guide-card"><div className="guide-card__eyebrow">Best move right now</div><strong>{bestMoveTitle}</strong><p>{bestMoveDetail}</p></div>
        <div className="guide-card"><div className="guide-card__eyebrow">Best stock to review</div><strong>{leadingIdea?.symbol ?? 'Nothing stands out'}</strong><p>{leadingIdea ? `${leadingIdea.symbol} is the best next stock to look at. ${buyBlocker(leadingIdea)}` : 'No stock stands out enough right now. Keeping cash is the better move.'}</p></div>
        <div className="guide-card"><div className="guide-card__eyebrow">Biggest issue</div><strong>{biggestIssueTitle}</strong><p>{biggestIssueDetail}</p></div>
      </section>

      {homeMode === 'advanced' ? (
        <div className="dashboard-grid page-section">
          <Panel id="home-review" title="Best Stocks To Review" eyebrow="Worth A Look" subtitle={actionableOpportunityCount > 0 ? 'These are the strongest new stock ideas after adjusting for your current portfolio and rules.' : 'Nothing has a full green light right now, but these are the closest matches for your portfolio.'} helpText="Why this matters: start here when you want a short list. It keeps the focus on stocks that are both interesting and relevant to what you already own." collapsible collapsed={panelPrefs['home-review']?.collapsed ?? false} onToggleCollapse={() => togglePanelCollapse('home-review')} pinned={panelPrefs['home-review']?.pinned ?? false} onTogglePin={() => togglePanelPin('home-review')}>
            {candidates.length === 0 ? <div className="empty-state empty-state--compact"><div className="empty-state__icon" aria-hidden="true"><TrendingUp size={36} strokeWidth={1.25} /></div><h2>No usable candidates right now.</h2><p>The engine does not see a stock worth tracking under your current rules, fit, and risk settings.</p></div> : <div className="home-opportunity-list">{candidates.slice(0, 4).map((card) => <Link key={card.symbol} to={`/stocks/${card.symbol}`} className="home-opportunity-row"><div><div className="home-opportunity-row__title"><strong>{card.symbol}</strong><Tag tone={toneForAction(card.action)}>{card.action}</Tag></div><p>{card.decision.why}</p><p className="home-opportunity-row__subtext">Why not buy yet: {buyBlocker(card)}</p></div><div className="home-opportunity-row__metrics"><ScorePill label="How close" score={buyPotentialScore(card)} /><ScorePill label="Confidence" score={card.confidenceBand} tone={toneForConfidenceBand(card.confidenceBand)} title={plainLanguageHelp.confidence} /><ScorePill label="Base case" score={formatReturn(card.expectedReturns[2].base)} title={plainLanguageHelp.expectedReturn} /><ScorePill label="Portfolio fit" score={card.portfolioFit.score} title={plainLanguageHelp.portfolioFit} /></div><div className="recommendation-card__meta-row"><Tag tone={toneForFreshness(card.freshness.quoteStatus)}>Price: {freshnessText(card.freshness.quoteFreshnessDays, card.freshness.quoteStatus)}</Tag><Tag tone={toneForFreshness(card.freshness.fundamentalsStatus)}>Company data: {freshnessText(card.freshness.fundamentalsFreshnessDays, card.freshness.fundamentalsStatus)}</Tag><Tag tone={card.recommendationChange.actionChanged ? 'warning' : 'neutral'}>{actionTimelineText(card)}</Tag></div></Link>)}</div>}
          </Panel>
          <Panel id="home-problems" title="Biggest Problems" eyebrow="Fix These First" subtitle="These are the things most likely to hurt your results if you ignore them." helpText="Why this matters: if you only check one risk panel, check this one. It is meant to surface the most important problem quickly, not every possible warning." collapsible collapsed={panelPrefs['home-problems']?.collapsed ?? false} onToggleCollapse={() => togglePanelCollapse('home-problems')} pinned={panelPrefs['home-problems']?.pinned ?? false} onTogglePin={() => togglePanelPin('home-problems')}>
            <div className="stack-list">{filteredAlerts.slice(0, 4).map((alert) => <Link key={alert.id} to={alert.route} className="alert-row"><div className="alert-row__icon"><AlertTriangle size={16} /></div><div><div className="alert-row__title">{alert.kind}</div><p>{alert.message}</p></div><Tag tone={toneForAlert(alert.severity)}>{alertPriorityLabel(alert.severity)}</Tag></Link>)}</div>
          </Panel>
          <Panel id="home-actions" className="dashboard-grid__wide" title="Best Move Right Now" eyebrow="Start Here" subtitle={`${bestMoveTitle}. This is the plain-English answer to what to do with your money next.`} helpText={plainLanguageHelp.bestMove} collapsible collapsed={panelPrefs['home-actions']?.collapsed ?? false} onToggleCollapse={() => togglePanelCollapse('home-actions')} pinned={panelPrefs['home-actions']?.pinned ?? false} onTogglePin={() => togglePanelPin('home-actions')}>
            <div className="advice-card"><p>{quickActionNarrative(model)}</p>{leadingIdea ? <div className="text-card"><strong>Best next-up candidate</strong><p>{leadingIdea.symbol}: {leadingIdea.decision.why} {buyBlocker(leadingIdea)}</p></div> : null}<ul className="bullet-list">{displayedChanges.map((change) => <li key={change}>{change}</li>)}</ul></div>
          </Panel>
          <Panel id="home-mix" title="Where Your Money Is" eyebrow="Portfolio Mix" subtitle="This shows where your money is concentrated across sectors, styles, and risk levels." helpText={plainLanguageHelp.diversification} collapsible collapsed={panelPrefs['home-mix']?.collapsed ?? false} onToggleCollapse={() => togglePanelCollapse('home-mix')} pinned={panelPrefs['home-mix']?.pinned ?? false} onTogglePin={() => togglePanelPin('home-mix')}>
            <div className="triple-columns"><div><h3>Sector</h3>{model.sectorExposure.map((entry) => <SignalBar key={entry.sector} label={entry.sector} value={entry.weight} tone={entry.weight > 28 ? 'negative' : 'positive'} />)}</div><div><h3>Style</h3>{model.factorExposure.map((entry) => <SignalBar key={entry.factor} label={entry.factor} value={entry.value} tone="neutral" />)}</div><div><h3>Risk level</h3>{model.riskExposure.map((entry) => <SignalBar key={entry.bucket} label={entry.bucket} value={entry.value} tone={entry.bucket === 'Aggressive' || entry.bucket === 'Fragile' ? 'negative' : 'positive'} />)}</div></div>
          </Panel>
          <Panel id="home-knows" title="What The Model Knows And Does Not Know" eyebrow="Trust Check" subtitle="This is the fast honesty check: what the app can see clearly right now, and where uncertainty is still high." helpText="This is the model's reality check. It helps you tell the difference between a strong signal and a confident-looking guess." collapsible collapsed={panelPrefs['home-knows']?.collapsed ?? false} onToggleCollapse={() => togglePanelCollapse('home-knows')} pinned={panelPrefs['home-knows']?.pinned ?? false} onTogglePin={() => togglePanelPin('home-knows')}>
            <div className="two-column-layout two-column-layout--compact"><div className="text-card"><strong>What the model knows</strong><ul className="bullet-list">{knows.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="text-card"><strong>What the model does not know</strong><ul className="bullet-list">{unknowns.map((item) => <li key={item}>{item}</li>)}</ul></div></div>
          </Panel>
          <Panel id="home-holdings" title="Your Holdings" eyebrow="Quick Rail" subtitle="This is a fast read of your biggest positions without leaving Home." helpText="This gives you a small list of your biggest holdings so you can see winners, losers, weight, and the current system view at a glance." collapsible collapsed={panelPrefs['home-holdings']?.collapsed ?? false} onToggleCollapse={() => togglePanelCollapse('home-holdings')} pinned={panelPrefs['home-holdings']?.pinned ?? false} onTogglePin={() => togglePanelPin('home-holdings')}>
            {holdingsRail.length === 0 ? <div className="empty-state empty-state--compact"><div className="empty-state__icon" aria-hidden="true"><ListChecks size={36} strokeWidth={1.25} /></div><h2>No holdings yet.</h2><p>Add your first position in Portfolio to populate this quick rail.</p><Link to="/portfolio" className="action-button">Open Portfolio</Link></div> : <div className="stack-list">{holdingsRail.map((holding) => <Link key={holding.symbol} to={`/stocks/${holding.symbol}`} className="holding-rail-row"><div><div className="holding-rail-row__title"><strong>{holding.symbol}</strong><Tag tone={toneForAction(holding.action)}>{holding.action}</Tag></div><p>Total return {formatPercent(holding.gainLossPct)} · Weight {formatPercent(holding.weight)}</p></div><div className="holding-rail-row__meta"><strong>{formatCurrency(holding.marketValue)}</strong><span>{holding.unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(holding.unrealizedPnl)}</span></div></Link>)}</div>}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
