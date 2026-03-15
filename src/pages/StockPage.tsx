import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import { Skeleton, SkeletonText } from './../components/Skeleton';
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
  freshnessText,
  liveStatusText,
  liveStatusTone,
  recommendationChangeTone,
  simpleActionText,
  sourceModeLabel,
  toneForAction,
  toneForConfidenceBand,
  toneForFreshness,
  toneForThesisHealth,
} from './shared';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';

export function StockPage() {
  const {
    dataset,
    model,
    symbolDirectory,
    symbolDirectoryState,
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
  const directoryMatch = symbolDirectory.find(
    (entry) =>
      entry.symbol === normalizedSymbol || normalizeSymbol(entry.displaySymbol) === normalizedSymbol,
  );

  if (!security || !scorecard) {
    const isLoading =
      loadingSymbols.includes(normalizedSymbol) ||
      (!quoteErrors[normalizedSymbol] &&
        (symbolDirectoryState === 'loading' || Boolean(directoryMatch)));

    return (
      <div className="page">
        <PageHeader
          title={isLoading ? 'Loading Live Coverage' : 'Stock Not Found'}
          summary={
            isLoading
              ? `Fetching market coverage for ${directoryMatch?.name ?? normalizedSymbol}.`
              : quoteErrors[normalizedSymbol]
                ? `Yahoo Finance did not return usable coverage for ${normalizedSymbol}: ${quoteErrors[normalizedSymbol]}`
                : `${normalizedSymbol} is not in the current stock directory.`
          }
        />
        <nav className="page-back-links" aria-label="Back navigation">
          <Link to="/recommendations" className="panel-link action-button">Back to Ideas</Link>
          <Link to="/portfolio" className="panel-link action-button">Back to Portfolio</Link>
        </nav>
        {isLoading ? (
          <section className="page-section">
            <div className="stock-loading-skeleton">
              <SkeletonText lines={2} />
              <div className="stock-loading-skeleton__grid">
                <Skeleton className="skeleton--card" />
                <Skeleton className="skeleton--card" />
                <Skeleton className="skeleton--card" />
                <Skeleton className="skeleton--card" />
              </div>
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  const modelKnows = [
    ...scorecard.explanation.topDrivers.slice(0, 3).map((driver) => `${driver.label}: ${driver.narrative}`),
    ...scorecard.explanation.fitNotes.slice(0, 2),
  ].slice(0, 5);
  const modelUnknowns = [
    ...(security.dataQuality?.missingCoreFields.length
      ? [`Missing fields: ${security.dataQuality.missingCoreFields.join(', ')}`]
      : []),
    ...scorecard.explanation.dataQualityNotes.filter((note) => /stale|missing|inferred|coverage/i.test(note)),
    ...scorecard.signalAudit.notes.filter((note) => /double counting|correlated|crowding/i.test(note)),
  ].slice(0, 5);

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
          detail={`${scorecard.confidenceBand} - Confidence ${scorecard.confidence}/100`}
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
          label="Thesis Health"
          value={scorecard.thesisHealth}
          detail={holding?.sellDiscipline ?? 'No exit trigger currently active'}
          tone={
            scorecard.thesisHealth === 'Improving'
              ? 'positive'
              : scorecard.thesisHealth === 'Stable'
                ? 'neutral'
                : 'negative'
          }
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
        title="Decision Hierarchy"
        eyebrow="Action / Why / Risk / Size"
        subtitle="This keeps the recommendation chain explicit: attractiveness, fragility, timing, fit, then action."
      >
        <div className="detail-grid">
          <div className="text-card">
            <strong>Action</strong>
            <div className="recommendation-card__meta-row">
              <Tag tone={toneForAction(scorecard.action)}>{scorecard.action}</Tag>
              <Tag tone={toneForConfidenceBand(scorecard.confidenceBand)}>{scorecard.confidenceBand}</Tag>
            </div>
          </div>
          <div className="text-card">
            <strong>Thesis health</strong>
            <div className="recommendation-card__meta-row">
              <Tag tone={toneForThesisHealth(scorecard.thesisHealth)}>{scorecard.thesisHealth}</Tag>
              {holding?.sellDiscipline ? <Tag tone="negative">{holding.sellDiscipline}</Tag> : null}
            </div>
          </div>
          <div className="text-card">
            <strong>Why</strong>
            <p>{scorecard.decision.why}</p>
          </div>
          <div className="text-card">
            <strong>Main risk</strong>
            <p>{scorecard.decision.mainRisk}</p>
          </div>
          <div className="text-card">
            <strong>Suggested role</strong>
            <p>{scorecard.decision.suggestedRole}</p>
          </div>
          <div className="text-card">
            <strong>Sizing discipline</strong>
            <p>{scorecard.decision.sizingDiscipline}</p>
          </div>
        </div>
        {holding?.replacementIdea ? (
          <div className="settings-note">
            <strong>Replacement logic</strong>
            <p>{holding.replacementIdea}</p>
          </div>
        ) : null}
      </Panel>

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
          title="Risk Breakdown"
          eyebrow="Sub-Risks"
          subtitle="Risk is split into market, event, business, valuation, and portfolio contribution so one noisy number does not hide the source of danger."
        >
          <div className="signal-grid">
            <SignalBar label="Market" value={scorecard.risk.market} tone={scorecard.risk.market > 60 ? 'negative' : 'neutral'} />
            <SignalBar label="Event" value={scorecard.risk.event} tone={scorecard.risk.event > 60 ? 'negative' : 'neutral'} />
            <SignalBar label="Business" value={scorecard.risk.business} tone={scorecard.risk.business > 60 ? 'negative' : 'neutral'} />
            <SignalBar label="Valuation" value={scorecard.risk.valuation} tone={scorecard.risk.valuation > 60 ? 'negative' : 'neutral'} />
            <SignalBar
              label="Portfolio contribution"
              value={scorecard.risk.portfolioContribution}
              tone={scorecard.risk.portfolioContribution > 60 ? 'negative' : 'neutral'}
            />
          </div>
          <div className="mini-stack">
            <ScorePill label="Overall risk" score={`${scorecard.risk.overall}/100`} tone={scorecard.risk.overall > 60 ? 'negative' : 'neutral'} />
            <ScorePill label="Bucket" score={scorecard.risk.bucket} tone={scorecard.risk.overall > 60 ? 'negative' : 'neutral'} />
            <ScorePill label="Expected downside" score={formatPercent(scorecard.risk.expectedDownside * 100)} tone="negative" />
            <ScorePill label="Size cap" score={`${scorecard.risk.sizeCapMultiplier.toFixed(2)}x`} tone="neutral" />
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
          title="Uncertainty Transparency"
          eyebrow="What The Model Knows"
          subtitle="This separates strong observed evidence from gaps, stale inputs, or inferred signals that should temper conviction."
        >
          <div className="triple-columns">
            <div>
              <h3>What the model knows</h3>
              {modelKnows.length > 0 ? (
                <ul className="bullet-list">
                  {modelKnows.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-card">
                  <strong>Limited positive evidence</strong>
                  <p>The model does not have many strong confirmed drivers right now.</p>
                </div>
              )}
            </div>
            <div>
              <h3>What the model does not know</h3>
              {modelUnknowns.length > 0 ? (
                <ul className="bullet-list">
                  {modelUnknowns.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-card">
                  <strong>No major blind spots flagged</strong>
                  <p>Current coverage and freshness checks do not show a large missing-information penalty.</p>
                </div>
              )}
            </div>
            <div>
              <h3>Suggested sizing range</h3>
              <ul className="bullet-list">
                <li>
                  Weight: {Math.round((scorecard.allocation.suggestedWeightRange?.[0] ?? scorecard.allocation.suggestedWeight) * 1000) / 10}
                  % to {Math.round((scorecard.allocation.suggestedWeightRange?.[1] ?? scorecard.allocation.suggestedWeight) * 1000) / 10}%
                </li>
                <li>
                  Dollars: {formatCompactCurrency(scorecard.allocation.suggestedDollarRange?.[0] ?? scorecard.allocation.suggestedDollars)} to{' '}
                  {formatCompactCurrency(scorecard.allocation.suggestedDollarRange?.[1] ?? scorecard.allocation.suggestedDollars)}
                </li>
                <li>Reserve after trade: {formatCurrency(scorecard.allocation.reserveAfterTrade)}</li>
              </ul>
            </div>
          </div>
        </Panel>

        <Panel
          title="Freshness Hierarchy"
          eyebrow="Data Layers"
          subtitle="Price freshness is only one layer. Fundamentals, macro context, validation, and the model snapshot update on different cadences."
        >
          <div className="summary-list summary-list--compact">
            {[
              {
                label: 'Quote',
                age: scorecard.freshness.quoteFreshnessDays,
                status: scorecard.freshness.quoteStatus,
                asOf: scorecard.freshness.quoteAsOf,
              },
              {
                label: 'Fundamentals',
                age: scorecard.freshness.fundamentalsFreshnessDays,
                status: scorecard.freshness.fundamentalsStatus,
                asOf: scorecard.freshness.fundamentalsAsOf,
              },
              {
                label: 'Macro',
                age: scorecard.freshness.macroFreshnessDays,
                status: scorecard.freshness.macroStatus ?? 'aging',
                asOf: scorecard.freshness.macroAsOf,
              },
              {
                label: 'Validation',
                age: scorecard.freshness.validationFreshnessDays,
                status: scorecard.freshness.validationStatus ?? 'aging',
                asOf: scorecard.freshness.validationAsOf,
              },
              {
                label: 'Model snapshot',
                age: scorecard.freshness.modelFreshnessDays,
                status: scorecard.freshness.modelStatus,
                asOf: scorecard.freshness.modelAsOf,
              },
            ].map((item) => (
              <div key={item.label} className="summary-list__item">
                <div>
                  <strong>{item.label}</strong>
                  <p className="summary-list__note">{item.asOf ?? 'Not available'}</p>
                </div>
                <Tag tone={toneForFreshness(item.status)}>{freshnessText(item.age, item.status)}</Tag>
              </div>
            ))}
          </div>
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
          title="Recommendation Change Log"
          eyebrow="What Changed"
          subtitle={scorecard.recommendationChange.summary}
        >
          <div className="mini-stack">
            <ScorePill
              label="Current action"
              score={scorecard.action}
              tone={toneForAction(scorecard.action)}
            />
            <ScorePill
              label="Previous action"
              score={scorecard.recommendationChange.previousAction}
              tone={toneForAction(scorecard.recommendationChange.previousAction)}
            />
            <ScorePill
              label="Composite delta"
              score={`${scorecard.recommendationChange.compositeDelta > 0 ? '+' : ''}${scorecard.recommendationChange.compositeDelta}`}
              tone={recommendationChangeTone(scorecard)}
            />
            <ScorePill
              label="Risk delta"
              score={`${scorecard.recommendationChange.riskDelta > 0 ? '+' : ''}${scorecard.recommendationChange.riskDelta}`}
              tone={scorecard.recommendationChange.riskDelta <= 0 ? 'positive' : 'negative'}
            />
            <ScorePill
              label="Downside delta"
              score={`${scorecard.recommendationChange.downsideDelta > 0 ? '+' : ''}${scorecard.recommendationChange.downsideDelta}%`}
              tone={scorecard.recommendationChange.downsideDelta <= 0 ? 'positive' : 'negative'}
            />
          </div>
          <ul className="bullet-list">
            {scorecard.recommendationChange.factorMoves.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
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

        <Panel
          title="Signal Integrity"
          eyebrow="Anti Double-Count"
          subtitle="The engine trims confidence when several inputs are just repeating the same story."
        >
          <div className="mini-stack">
            <ScorePill
              label="Redundancy penalty"
              score={scorecard.signalAudit.redundancyPenalty}
              tone={scorecard.signalAudit.redundancyPenalty > 2 ? 'warning' : 'positive'}
            />
            <ScorePill
              label="Price crowding"
              score={scorecard.signalAudit.priceSignalCrowding}
              tone={scorecard.signalAudit.priceSignalCrowding > 30 ? 'warning' : 'neutral'}
            />
            <ScorePill
              label="Fragility crowding"
              score={scorecard.signalAudit.fragilityCrowding}
              tone={scorecard.signalAudit.fragilityCrowding > 35 ? 'warning' : 'neutral'}
            />
          </div>
          {scorecard.signalAudit.notes.length > 0 ? (
            <ul className="bullet-list">
              {scorecard.signalAudit.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : (
            <div className="text-card">
              <strong>No major signal crowding detected</strong>
              <p>The current score is not leaning too heavily on one repeated signal family.</p>
            </div>
          )}
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
