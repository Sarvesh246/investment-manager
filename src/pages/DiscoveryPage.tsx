import { useEffect } from 'react';
import { useStoredState } from './../hooks/useStoredState';
import { Link, useLocation } from 'react-router-dom';
import { Filter, Search } from 'lucide-react';
import {
  Panel,
  PageHeader,
  PageJumpNav,
  ScorePill,
  Table,
  Tag,
} from './../components/ui';
import { SaveToWatchlistButton } from './../components/SaveToWatchlistButton';
import { getSecurity } from './../domain/engine';
import { plainLanguageHelp } from './../lib/helpText';
import { formatReturn } from './../lib/format';
import {
  buyBlocker,
  buyPotentialScore,
  dataQualityTone,
  freshnessText,
  potentialBuyRows,
  symbolMatches,
  toneForAction,
  toneForFreshness,
} from './shared';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';

export function DiscoveryPage() {
  const location = useLocation();
  const {
    model,
    symbolDirectory,
    symbolDirectoryState,
    symbolDirectoryError,
    ensureLiveSecurity,
    watchlists,
    addWatchlist,
    addSymbolToWatchlist,
  } = usePortfolioWorkspace();
  const [sector, setSector] = useStoredState('ic-discovery-sector-filter', 'All');
  const [marketCap, setMarketCap] = useStoredState('ic-discovery-marketcap-filter', 'All');
  const [minRevenueGrowth, setMinRevenueGrowth] = useStoredState('ic-discovery-revenue-filter', 'All');
  const [maxRisk, setMaxRisk] = useStoredState('ic-discovery-risk-filter', 'All');
  const [sortBy, setSortBy] = useStoredState<'readiness' | 'composite' | 'risk' | 'fit' | 'expected'>(
    'ic-discovery-sort',
    'readiness',
  );
  const [action, setAction] = useStoredState('ic-discovery-action-filter', 'All');
  const [lookupQuery, setLookupQuery] = useStoredState('ic-discovery-lookup', '');
  const lookupMatches = symbolMatches(symbolDirectory, lookupQuery);
  const topMatches = potentialBuyRows(model).slice(0, 3);

  const hasActiveFilters =
    sector !== 'All' ||
    marketCap !== 'All' ||
    minRevenueGrowth !== 'All' ||
    maxRisk !== 'All' ||
    action !== 'All';

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

  function clearFilters() {
    setSector('All');
    setMarketCap('All');
    setMinRevenueGrowth('All');
    setMaxRisk('All');
    setAction('All');
    setSortBy('readiness');
  }

  const rows = [...model.scorecards]
    .filter((card) => {
      const security = getSecurity(model, card.symbol);
      if (!security) {
        return false;
      }
      const sectorMatch = sector === 'All' || security.sector === sector;
      const marketCapMatch = marketCap === 'All' || security.marketCapBucket === marketCap;
      const revenueGrowthMatch =
        minRevenueGrowth === 'All' ||
        security.metrics.revenueGrowth * 100 >= Number(minRevenueGrowth);
      const riskMatch = maxRisk === 'All' || card.risk.overall <= Number(maxRisk);
      const actionMatch = action === 'All' || card.action === action;
      return sectorMatch && marketCapMatch && revenueGrowthMatch && riskMatch && actionMatch;
    })
    .sort((left, right) => {
      if (sortBy === 'readiness') {
        return buyPotentialScore(right) - buyPotentialScore(left);
      }
      if (sortBy === 'risk') {
        return left.risk.overall - right.risk.overall;
      }
      if (sortBy === 'fit') {
        return right.portfolioFit.score - left.portfolioFit.score;
      }
      if (sortBy === 'expected') {
        return right.expectedReturns[2].base - left.expectedReturns[2].base;
      }
      return right.composite - left.composite;
    });

  return (
    <div className="page">
      <PageHeader
        title="Explore Stocks"
        summary="Use this page to compare ideas in plain language: upside, risk, timing, and how well each stock fits your current portfolio."
      />

      <PageJumpNav
        items={[
          { href: '#explore-best', label: 'Best matches', detail: 'Strongest fits first' },
          { href: '#explore-lookup', label: 'Look up', detail: 'Find any ticker' },
          { href: '#explore-filters', label: 'Filter', detail: 'Narrow the universe' },
          { href: '#explore-results', label: 'Results', detail: 'Compare the ranked list' },
        ]}
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
        id="explore-best"
        title="Best Matches For Your Portfolio"
        eyebrow="Start Here"
        subtitle="If you only review a few names, start with these. They are the strongest current or near-ready fits for your portfolio."
        helpText="This is the shortest list on the page. It favors stocks that look attractive and also make sense with what you already own."
      >
        {topMatches.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <div className="empty-state__icon" aria-hidden="true">
              <Search size={36} strokeWidth={1.25} />
            </div>
            <h2>No promising matches yet.</h2>
            <p>The engine does not currently see a non-held stock worth prioritizing for review.</p>
          </div>
        ) : (
          <div className="watchlist-grid">
            {topMatches.map((card) => (
              <div key={card.symbol} className="recommendation-card recommendation-card--with-save">
                <Link to={`/stocks/${card.symbol}`} className="recommendation-card__link">
                  <div className="recommendation-card__header">
                    <strong>{card.symbol}</strong>
                    <Tag tone={toneForAction(card.action)}>{card.action}</Tag>
                  </div>
                  <p>{card.decision.why}</p>
                  <p className="recommendation-card__subtext">Why not buy yet: {buyBlocker(card)}</p>
                  <div className="recommendation-card__metrics">
                    <ScorePill label="Readiness" score={buyPotentialScore(card)} />
                    <ScorePill label="Base 12M" score={formatReturn(card.expectedReturns[2].base)} title={plainLanguageHelp.expectedReturn} />
                    <ScorePill label="Fit" score={card.portfolioFit.score} title={plainLanguageHelp.portfolioFit} />
                    <ScorePill label="Data" score={card.dataQualityScore} tone={dataQualityTone(card.dataQualityScore)} />
                  </div>
                  <div className="recommendation-card__meta-row">
                    <Tag tone={toneForFreshness(card.freshness.quoteStatus)}>
                      Price: {freshnessText(card.freshness.quoteFreshnessDays, card.freshness.quoteStatus)}
                    </Tag>
                    <Tag tone={toneForFreshness(card.freshness.fundamentalsStatus)}>
                      Company data: {freshnessText(card.freshness.fundamentalsFreshnessDays, card.freshness.fundamentalsStatus)}
                    </Tag>
                  </div>
                </Link>
                <SaveToWatchlistButton
                  symbol={card.symbol}
                  watchlists={watchlists}
                  onAdd={addSymbolToWatchlist}
                  onCreateAndAdd={(name, sym) => addWatchlist({ name, symbols: [sym], notes: '' })}
                />
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        id="explore-lookup"
        title="Look Up Any S&P 500 Or Nasdaq Ticker"
        eyebrow="Live Coverage"
        subtitle="Search the synced Yahoo-compatible directory, then open a stock page to load live market data on demand."
        helpText="Use this when you already know the company or ticker you want. It is the fastest way to jump straight into a stock page."
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
                  <div key={entry.symbol} className="lookup-row lookup-row--with-save">
                    <Link
                      to={`/stocks/${entry.symbol}`}
                      className="lookup-row__link"
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
                    <SaveToWatchlistButton
                      symbol={entry.symbol}
                      watchlists={watchlists}
                      onAdd={addSymbolToWatchlist}
                      onCreateAndAdd={(name, sym) => addWatchlist({ name, symbols: [sym], notes: '' })}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-card">
                <strong>No directory match</strong>
                <p>Try the exact ticker symbol. The synced directory currently covers S&P 500 constituents and Nasdaq-listed stocks that Yahoo recognizes.</p>
              </div>
            )
          ) : symbolDirectoryState === 'error' ? (
            <div className="directory-error-panel" role="alert">
              <strong>Directory unavailable</strong>
              <p>The symbol directory could not be loaded: {symbolDirectoryError ?? 'unknown error'}.</p>
              <p className="directory-error-panel__hint">
                <Link to="/portfolio" className="panel-link">Use portfolio lookup</Link> to look up a stock from your holdings.
              </p>
            </div>
          ) : (
            <div className="text-card">
              <strong>
                {symbolDirectoryState === 'ready' ? 'Directory ready' : 'Loading directory'}
              </strong>
              <p>
                {symbolDirectoryState === 'ready'
                  ? `${symbolDirectory.length} current directory symbols are available for lookup and live Yahoo market data loading.`
                  : 'Fetching the latest Yahoo-verified S&P 500 and Nasdaq symbol directory.'}
              </p>
            </div>
          )}
        </div>
      </Panel>

      <Panel
        id="explore-filters"
        title="Screen Controls"
        eyebrow="Filters"
        subtitle="Start broad, then narrow by sector, sort order, and action label."
        helpText="These filters help you cut the list down without changing the model. They are there to help you focus, not to rewrite the ranking logic."
      >
        <div className="filters filters--with-actions">
          <div className="filters__meta">
            <span className="filters__count">
              Showing {rows.length} of {model.scorecards.length} ideas
            </span>
            {hasActiveFilters ? (
              <button type="button" className="panel-link action-button" onClick={clearFilters}>
                Clear filters
              </button>
            ) : null}
          </div>
          <label>
            Sector
            <select className="filter-select" value={sector} onChange={(event) => setSector(event.target.value)}>
              {['All', ...new Set(model.dataset.securities.map((security) => security.sector))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Market Cap
            <select className="filter-select" value={marketCap} onChange={(event) => setMarketCap(event.target.value)}>
              {['All', ...new Set(model.dataset.securities.map((security) => security.marketCapBucket))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Min Revenue Growth
            <select className="filter-select" value={minRevenueGrowth} onChange={(event) => setMinRevenueGrowth(event.target.value)}>
              <option value="All">All</option>
              <option value="0">Positive</option>
              <option value="10">10%+</option>
              <option value="20">20%+</option>
            </select>
          </label>
          <label>
            Max Risk
            <select className="filter-select" value={maxRisk} onChange={(event) => setMaxRisk(event.target.value)}>
              <option value="All">All</option>
              <option value="75">75 or less</option>
              <option value="65">65 or less</option>
              <option value="55">55 or less</option>
            </select>
          </label>
          <label>
            Sort By
            <select className="filter-select" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
              <option value="readiness">Best Match For Me</option>
              <option value="composite">Composite</option>
              <option value="expected">12M Expected Return</option>
              <option value="fit">Portfolio Fit</option>
              <option value="risk">Lowest Risk</option>
            </select>
          </label>
          <label>
            Action
            <select className="filter-select" value={action} onChange={(event) => setAction(event.target.value)}>
              {['All', ...new Set(model.scorecards.map((card) => card.action))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      <Panel
        id="explore-results"
        title="Ranked Universe"
        eyebrow="Screen Results"
        subtitle={`${rows.length} securities match the active filter.`}
        helpText="This is the broader ranked list. Use it when you want to compare several names quickly after filtering the universe down."
      >
        {rows.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <div className="empty-state__icon" aria-hidden="true">
              <Filter size={36} strokeWidth={1.25} />
            </div>
            <h2>No stocks match these filters.</h2>
            <p>Broaden one filter and the list will repopulate.</p>
          </div>
        ) : null}
        <Table
          columns={['Symbol', 'Sector', 'Action', 'Readiness', 'Composite', 'Opportunity', 'Fragility', 'Timing', 'Fit', 'Data', '12M Base']}
          numericColumnIndices={[3, 4, 5, 6, 7, 8, 9, 10]}
          sortColumnIndex={
            sortBy === 'readiness' ? 3 : sortBy === 'composite' ? 4 : sortBy === 'risk' ? 6 : sortBy === 'fit' ? 8 : sortBy === 'expected' ? 10 : undefined
          }
          sortDirection={
            sortBy === 'risk' ? 'asc' : sortBy ? 'desc' : undefined
          }
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
              <span key={`${card.symbol}-r`}>{buyPotentialScore(card)}</span>,
              <span key={`${card.symbol}-c`}>{card.composite}</span>,
              <span key={`${card.symbol}-o`}>{card.opportunity.score}</span>,
              <span key={`${card.symbol}-f`}>{card.fragility.score}</span>,
              <span key={`${card.symbol}-t`}>{card.timing.score}</span>,
              <span key={`${card.symbol}-pf`}>{card.portfolioFit.score}</span>,
              <span key={`${card.symbol}-dq`}>{card.dataQualityScore}</span>,
              <span key={`${card.symbol}-er`}>{formatReturn(card.expectedReturns[2].base)}</span>,
            ];
          })}
        />
      </Panel>
    </div>
  );
}
