import { Radar } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Panel,
  PageHeader,
  PageJumpNav,
  ScorePill,
  Tag,
} from './../components/ui';
import { useStoredState } from './../hooks/useStoredState';
import { plainLanguageHelp } from './../lib/helpText';
import { formatReturn } from './../lib/format';
import {
  actionTimelineText,
  buyBlocker,
  buyPotentialScore,
  dataQualityTone,
  freshnessText,
  potentialBuyRows,
  recommendationChangeTone,
  toneForAction,
  toneForConfidenceBand,
  toneForFreshness,
  toneForThesisHealth,
} from './shared';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';

export function RecommendationsPage() {
  const { model } = usePortfolioWorkspace();
  const [actionFilter, setActionFilter] = useStoredState('ic-recommendations-action-filter', 'All');
  const [sortBy, setSortBy] = useStoredState<'readiness' | 'composite' | 'risk' | 'fit' | 'expected'>(
    'ic-recommendations-sort',
    'readiness',
  );
  const filteredCards = useMemo(() => {
    const cards = model.scorecards.filter((card) => actionFilter === 'All' || card.action === actionFilter);

    return [...cards].sort((left, right) => {
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
  }, [actionFilter, model.scorecards, sortBy]);

  const potentialCandidates = potentialBuyRows({ ...model, scorecards: filteredCards }).slice(0, 6);
  const buckets = Array.from(
    filteredCards.reduce((map, card) => {
      const list = map.get(card.action) ?? [];
      list.push(card);
      map.set(card.action, list);
      return map;
    }, new Map<string, typeof model.scorecards>()),
  );

  return (
    <div className="page">
      <PageHeader
        title="Ideas"
        summary="Every idea should answer four questions quickly: action, why, risk, and suggested role. This page keeps that spine visible even when the system is mostly holding cash."
      />

      <PageJumpNav
        items={[
          { href: '#ideas-primer', label: 'How to read', detail: 'Understand the labels' },
          { href: '#ideas-next', label: 'Next up', detail: 'Best potential buys' },
          { href: '#ideas-buckets', label: 'Buckets', detail: 'All action groups' },
        ]}
      />

      <section id="ideas-primer" className="guide-grid page-section">
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

      <Panel
        title="Filter Ideas"
        eyebrow="Controls"
        subtitle="Use these controls to focus the list on the action bucket or ranking style you care about right now."
        helpText="This keeps the page easier to scan. If you only want stronger candidates or lower-risk names, use these filters instead of reading everything."
      >
        <div className="filters">
          <label>
            Action
            <select className="filter-select" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
              {['All', ...new Set(model.scorecards.map((card) => card.action))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Sort By
            <select className="filter-select" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
              <option value="readiness">Readiness</option>
              <option value="composite">Composite</option>
              <option value="expected">12M Base Return</option>
              <option value="fit">Portfolio Fit</option>
              <option value="risk">Lowest Risk</option>
            </select>
          </label>
        </div>
      </Panel>

      <Panel
        id="ideas-next"
        title="Best Potential Buys"
        eyebrow="Next Up"
        subtitle="These are the names most worth researching next for your current portfolio, even if the system is still holding cash."
        helpText="These are not automatic buys. Think of them as the strongest near-miss ideas: good enough to review, but not necessarily ready for fresh money yet."
      >
        {potentialCandidates.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <div className="empty-state__icon" aria-hidden="true">
              <Radar size={36} strokeWidth={1.25} />
            </div>
            <h2>No promising candidates yet.</h2>
            <p>The engine is not finding a non-held stock with enough opportunity and fit to justify attention.</p>
          </div>
        ) : (
          <div className="stack-list">
            {potentialCandidates.map((card) => (
              <Link key={card.symbol} to={`/stocks/${card.symbol}`} className="recommendation-card">
                <div className="recommendation-card__header">
                  <strong>{card.symbol}</strong>
                  <Tag tone={toneForAction(card.action)}>{card.action}</Tag>
                </div>
                <p>{card.decision.why}</p>
                <p className="recommendation-card__subtext">
                  Why not buy yet: {buyBlocker(card)} Risk: {card.decision.mainRisk}
                </p>
                <div className="recommendation-card__metrics">
                  <ScorePill label="Readiness" score={buyPotentialScore(card)} />
                  <ScorePill
                    label="Confidence"
                    score={card.confidenceBand}
                    tone={toneForConfidenceBand(card.confidenceBand)}
                    title={plainLanguageHelp.confidence}
                  />
                  <ScorePill label="Base 12M" score={formatReturn(card.expectedReturns[2].base)} title={plainLanguageHelp.expectedReturn} />
                  <ScorePill label="Risk" score={card.risk.overall} title={plainLanguageHelp.fragility} />
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
                  <Tag tone={recommendationChangeTone(card)}>
                    Last changed: {actionTimelineText(card)}
                  </Tag>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Panel>

      <div id="ideas-buckets" className="recommendation-grid page-section">
        {buckets.map(([action, cards]) => (
          <Panel
            key={action}
            title={action}
            eyebrow="Action Bucket"
            subtitle={`${cards.length} names currently fall into this bucket.`}
            helpText="Each bucket groups stocks by the current recommended action. Use it to compare names with a similar role instead of treating every stock like the same kind of idea."
          >
            <div className="stack-list">
              {cards.slice(0, 5).map((card) => (
                <Link key={card.symbol} to={`/stocks/${card.symbol}`} className="recommendation-card">
                <div className="recommendation-card__header">
                  <strong>{card.symbol}</strong>
                  <Tag tone={toneForAction(card.action)}>{card.action}</Tag>
                </div>
                  <p>{card.decision.why}</p>
                  <p className="recommendation-card__subtext">
                    Risk: {card.decision.mainRisk} Size: {card.decision.sizingDiscipline}
                    {card.replacementIdea ? ` Better than what: ${card.replacementIdea}` : ''}
                  </p>
                  <div className="recommendation-card__metrics">
                    <ScorePill label="Composite" score={card.composite} />
                    <ScorePill
                      label="Confidence"
                      score={card.confidenceBand}
                      tone={toneForConfidenceBand(card.confidenceBand)}
                      title={plainLanguageHelp.confidence}
                    />
                    <ScorePill label="Risk" score={card.risk.overall} title={plainLanguageHelp.fragility} />
                    <ScorePill label="Fit" score={card.portfolioFit.score} title={plainLanguageHelp.portfolioFit} />
                    <ScorePill
                      label="Thesis"
                      score={card.thesisHealth}
                      tone={toneForThesisHealth(card.thesisHealth)}
                    />
                    <ScorePill
                      label="Freshness"
                      score={freshnessText(card.freshness.fundamentalsFreshnessDays, card.freshness.fundamentalsStatus)}
                      tone={toneForFreshness(card.freshness.fundamentalsStatus)}
                      title="Age of the last reported financial period (e.g. quarter end). Fundamentals update when the company files, not daily."
                    />
                  </div>
                  <div className="recommendation-card__meta-row">
                    <Tag tone={toneForFreshness(card.freshness.quoteStatus)}>
                      Price: {freshnessText(card.freshness.quoteFreshnessDays, card.freshness.quoteStatus)}
                    </Tag>
                    <Tag tone={toneForFreshness(card.freshness.fundamentalsStatus)}>
                      Company data: {freshnessText(card.freshness.fundamentalsFreshnessDays, card.freshness.fundamentalsStatus)}
                    </Tag>
                    <Tag tone={recommendationChangeTone(card)}>
                      Last changed: {actionTimelineText(card)}
                    </Tag>
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
