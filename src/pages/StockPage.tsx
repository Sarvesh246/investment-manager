import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Panel,
  MetricCard,
  PageHeader,
  PageJumpNav,
  ScorePill,
  SignalBar,
  Sparkline,
  Table,
  Tag,
} from './../components/ui';
import { SaveToWatchlistButton } from './../components/SaveToWatchlistButton';
import { getHolding, getScorecard, getSecurity } from './../domain/engine';
import {
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
  formatPrice,
  formatReturn,
} from './../lib/format';
import { actionHelp } from './../lib/helpText';
import { normalizeSymbol } from './../lib/symbols';
import {
  dataQualityTone,
  liveStatusText,
  liveStatusTone,
  simpleActionText,
  sourceModeLabel,
  toneForAction,
} from './shared';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';

export function StockPage() {
  const {
    dataset,
    model,
    loadingSymbols,
    quoteErrors,
    livePriceSymbols,
    liveQuotes,
    ensureLiveSecurity,
    watchlists,
    addWatchlist,
    addSymbolToWatchlist,
  } = usePortfolioWorkspace();
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
        meta={
          <div className="page-header__actions">
            <SaveToWatchlistButton
              symbol={security.symbol}
              watchlists={watchlists}
              onAdd={addSymbolToWatchlist}
              onCreateAndAdd={(name, sym) => addWatchlist({ name, symbols: [sym], notes: '' })}
            />
            <Tag tone={toneForAction(scorecard.action)} tooltip={actionHelp[scorecard.action]}>
              {scorecard.action}
            </Tag>
          </div>
        }
      />

      <PageJumpNav
        items={[
          { href: '#stock-snapshot', label: 'Snapshot', detail: 'Rating and live data' },
          { href: '#stock-scenarios', label: 'Scenarios', detail: 'Bull, base, bear' },
          { href: '#stock-explanation', label: 'Explanation', detail: 'Why the score looks like this' },
          { href: '#stock-trend', label: 'Trend', detail: 'Price and score context' },
        ]}
      />

      <section id="stock-snapshot" className="guide-grid page-section">
        <div className="guide-card">
          <div className="guide-card__eyebrow">Overall rating</div>
          <strong>{scorecard.composite}/100</strong>
          <p>This blends upside, risk, timing, fit, and confidence into one simple summary.</p>
        </div>
        <div className="guide-card">
          <div className="guide-card__eyebrow">Business quality</div>
          <strong>{scorecard.businessQuality}/100</strong>
          <p>This isolates whether the underlying company looks durable before timing and portfolio fit are considered.</p>
        </div>
        <div className="guide-card">
          <div className="guide-card__eyebrow">Entry quality</div>
          <strong>{scorecard.entryQuality}/100</strong>
          <p>This answers the separate question of whether the current setup is attractive enough to buy now rather than later.</p>
        </div>
        <div className="guide-card">
          <div className="guide-card__eyebrow">Data quality</div>
          <strong>{scorecard.dataQualityScore}/100</strong>
          <p>Confidence falls when the inputs are stale, inferred, thin, or missing. This helps avoid fake precision.</p>
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
          label="Portfolio Fit"
          value={`${scorecard.portfolioFit.score}/100`}
          detail={`Cluster overlap ${scorecard.fitImpact.clusterOverlap}/100`}
          tone={scorecard.portfolioFit.score >= 55 ? 'positive' : 'neutral'}
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
        id="stock-live"
        title="Active Market Data"
        eyebrow="Live Status"
        subtitle={
          loadingSymbols.includes(normalizedSymbol)
            ? 'Fetching live quote coverage for this symbol.'
            : quoteErrors[normalizedSymbol]
              ? `Yahoo Finance did not return a usable live quote: ${quoteErrors[normalizedSymbol]}`
              : livePriceSymbols.includes(normalizedSymbol)
                ? `Using the latest ${liveStatusText(normalizedSymbol, loadingSymbols, quoteErrors, liveQuotes).toLowerCase()} quote for this symbol.`
                : 'Current view is coming from the saved research snapshot.'
        }
      >
        <div className="mini-stack">
          <ScorePill label="Current Price" score={formatPrice(security.price)} />
          <ScorePill
            label="Session"
            score={liveStatusText(normalizedSymbol, loadingSymbols, quoteErrors, liveQuotes)}
            tone={liveStatusTone(normalizedSymbol, loadingSymbols, quoteErrors, liveQuotes)}
          />
          <ScorePill label="Price As Of" score={security.priceAsOf ?? dataset.asOf} tone="neutral" />
          <ScorePill
            label="Prior Close"
            score={
              liveQuotes[normalizedSymbol]
                ? formatPrice(liveQuotes[normalizedSymbol].previousClose)
                : 'Waiting'
            }
            tone="neutral"
          />
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
            <SignalBar label="Business quality" value={scorecard.businessQuality} tone="positive" />
            <SignalBar label="Entry quality" value={scorecard.entryQuality} tone="positive" />
            <SignalBar label="Opportunity" value={scorecard.opportunity.score} tone="positive" />
            <SignalBar label="Fragility" value={scorecard.fragility.score} tone="negative" />
            <SignalBar label="Timing" value={scorecard.timing.score} tone="positive" />
            <SignalBar label="Portfolio Fit" value={scorecard.portfolioFit.score} tone="positive" />
            <SignalBar label="Data quality" value={scorecard.dataQualityScore} tone={dataQualityTone(scorecard.dataQualityScore) === 'positive' ? 'positive' : dataQualityTone(scorecard.dataQualityScore) === 'warning' ? 'neutral' : 'negative'} />
          </div>
        </Panel>

        <Panel
          title="Data Quality And Integrity"
          eyebrow="Point-In-Time Inputs"
          subtitle="These checks tell you how fresh the numbers are and whether the model had to infer too much."
        >
          <div className="mini-stack">
            <ScorePill
              label="Source mode"
              score={sourceModeLabel(security.dataQuality?.sourceMode)}
              tone="neutral"
            />
            <ScorePill
              label="Coverage"
              score={`${security.dataQuality?.coverage ?? 0}%`}
              tone={dataQualityTone(scorecard.dataQualityScore)}
            />
            <ScorePill
              label="Price as of"
              score={security.priceAsOf ?? dataset.asOf}
              tone="neutral"
            />
            <ScorePill
              label="Fundamentals"
              score={security.fundamentalsLastUpdated}
              tone="neutral"
            />
            <ScorePill
              label="Inferred blocks"
              score={security.dataQuality?.inferredSignals ?? 0}
              tone={(security.dataQuality?.inferredSignals ?? 0) > 0 ? 'neutral' : 'positive'}
            />
            <ScorePill
              label="Missing fields"
              score={security.dataQuality?.missingCoreFields.length ?? 0}
              tone={(security.dataQuality?.missingCoreFields.length ?? 0) > 0 ? 'negative' : 'positive'}
            />
          </div>
          <ul className="bullet-list">
            {scorecard.explanation.dataQualityNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Panel>

        <Panel
          id="stock-scenarios"
          title="Expected Return Scenarios"
          eyebrow="Range Of Outcomes"
          subtitle="These are ranges, not promises. The goal is to show what could happen, not pretend we know the future."
        >
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

        <Panel
          id="stock-explanation"
          title="Plain-English Explanation"
          eyebrow="Why The System Thinks This"
          subtitle={scorecard.explanation.summary}
        >
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

        <Panel id="stock-trend" title="Trend Context" eyebrow="Context" subtitle="These charts help you see the recent path of price and model score.">
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
                <li>Cluster overlap: {scorecard.fitImpact.clusterOverlap}/100</li>
                <li>Sector weight after add: {scorecard.fitImpact.sectorWeightAfter}%</li>
                <li>Diversification delta: {scorecard.fitImpact.diversificationDelta}</li>
                <li>Portfolio vol delta proxy: {scorecard.fitImpact.portfolioVolDelta}</li>
                <li>Marginal risk contribution: {scorecard.fitImpact.marginalRiskContribution}</li>
                <li>Marginal drawdown impact: {scorecard.fitImpact.marginalDrawdownImpact}</li>
              </ul>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
