import { Link } from 'react-router-dom';
import {
  Panel,
  PageHeader,
  PageJumpNav,
  ScorePill,
  Tag,
} from './../components/ui';
import { formatReturn } from './../lib/format';
import {
  buyBlocker,
  buyPotentialScore,
  dataQualityTone,
  potentialBuyRows,
  toneForAction,
} from './shared';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';

export function RecommendationsPage() {
  const { model } = usePortfolioWorkspace();
  const buyCandidates = potentialBuyRows(model).slice(0, 6);
  const buckets = Array.from(
    model.scorecards.reduce((map, card) => {
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
        summary="This page keeps the strict action labels, but it also shows the best next-up candidates even when nothing is a clean buy today."
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
        id="ideas-next"
        title="Best Potential Buys"
        eyebrow="Next Up"
        subtitle="These are the names most worth researching next for your current portfolio, even if the system is still holding cash."
      >
        {buyCandidates.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <h2>No promising candidates yet.</h2>
            <p>The engine is not finding a non-held stock with enough opportunity and fit to justify attention.</p>
          </div>
        ) : (
          <div className="stack-list">
            {buyCandidates.map((card) => (
              <Link key={card.symbol} to={`/stocks/${card.symbol}`} className="recommendation-card">
                <div className="recommendation-card__header">
                  <strong>{card.symbol}</strong>
                  <Tag tone={toneForAction(card.action)}>{card.action}</Tag>
                </div>
                <p>
                  Buy readiness is {buyPotentialScore(card)}/100. {buyBlocker(card)}
                </p>
                <div className="recommendation-card__metrics">
                  <ScorePill label="Readiness" score={buyPotentialScore(card)} />
                  <ScorePill label="Base 12M" score={formatReturn(card.expectedReturns[2].base)} />
                  <ScorePill label="Risk" score={card.risk.overall} />
                  <ScorePill label="Fit" score={card.portfolioFit.score} />
                  <ScorePill label="Data" score={card.dataQualityScore} tone={dataQualityTone(card.dataQualityScore)} />
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
