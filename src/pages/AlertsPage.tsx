import { useStoredState } from './../hooks/useStoredState';
import { Link } from 'react-router-dom';
import { Activity, CheckCircle, ListChecks } from 'lucide-react';
import {
  Panel,
  PageHeader,
  ScorePill,
  Tag,
} from './../components/ui';
import { actionTimelineText, alertPriorityLabel, recommendationChangeTone, toneForAlert, toneForAction } from './shared';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';

export function AlertsPage() {
  const { model } = usePortfolioWorkspace();
  const [hideLowPriority, setHideLowPriority] = useStoredState('ic-alerts-hide-low-priority', true);
  const visibleAlerts = hideLowPriority ? model.alerts.filter((alert) => alert.severity !== 'low') : model.alerts;
  const recommendationChanges = model.scorecards
    .filter((card) =>
      hideLowPriority
        ? card.recommendationChange.actionChanged || Math.abs(card.recommendationChange.compositeDelta) >= 8
        : card.recommendationChange.actionChanged || Math.abs(card.recommendationChange.compositeDelta) >= 5,
    )
    .slice(0, 8);
  return (
    <div className="page">
      <PageHeader
        title="Changes To Watch"
        summary="These alerts tell you what changed and why it matters, so you do not need to monitor every stock tick."
      />

      <Panel
        title="Alert Feed"
        eyebrow="Signal Log"
        subtitle="The most urgent issues are shown first."
        helpText="This page is meant to answer two questions quickly: what needs attention, and what changed enough to justify another look."
        action={
          <label className="toggle-chip">
            <input type="checkbox" checked={hideLowPriority} onChange={(event) => setHideLowPriority(event.target.checked)} />
            <span>Hide low-priority noise</span>
          </label>
        }
      >
        {visibleAlerts.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <div className="empty-state__icon" aria-hidden="true">
              <CheckCircle size={36} strokeWidth={1.25} />
            </div>
            <div className="empty-state__eyebrow">All clear</div>
            <h2>No alerts right now.</h2>
            <p>Portfolio and model are within normal bounds. New risks or concentration issues will show here.</p>
          </div>
        ) : (
        <div className="stack-list">
          {visibleAlerts.map((alert) => (
            <div key={alert.id} className="alert-row alert-row--full alert-row--actionable">
              <div className="alert-row__icon">
                <Activity size={16} />
              </div>
              <div>
                <div className="alert-row__title">{alert.kind}</div>
                <p>{alert.message}</p>
              </div>
              <div className="alert-row__actions">
                <Tag tone={toneForAlert(alert.severity)}>{alertPriorityLabel(alert.severity)}</Tag>
                <Link to={alert.route} className="panel-link">Go fix</Link>
              </div>
            </div>
          ))}
        </div>
        )}
      </Panel>

      <Panel
        title="Recommendation Change Log"
        eyebrow="Accountability"
        subtitle="These are the names whose recommendation meaningfully changed versus the prior snapshot."
        helpText="This helps you see when the system actually changed its mind, so you do not need to wonder whether a new label is random or supported by a real shift."
      >
        {recommendationChanges.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <div className="empty-state__icon" aria-hidden="true">
              <ListChecks size={36} strokeWidth={1.25} />
            </div>
            <div className="empty-state__eyebrow">No changes</div>
            <h2>No recommendation changes in this snapshot.</h2>
            <p>Meaningful action or composite deltas will appear here when the model updates.</p>
          </div>
        ) : (
        <div className="stack-list">
          {recommendationChanges.map((card) => (
            <Link key={card.symbol} to={`/stocks/${card.symbol}`} className="recommendation-card">
              <div className="recommendation-card__header">
                <strong>{card.symbol}</strong>
                <Tag tone={toneForAction(card.action)}>{card.action}</Tag>
              </div>
              <p>{card.recommendationChange.summary}</p>
              <p className="recommendation-card__subtext">Last changed: {actionTimelineText(card)}</p>
              <div className="recommendation-card__metrics">
                <ScorePill
                  label="Composite delta"
                  score={`${card.recommendationChange.compositeDelta > 0 ? '+' : ''}${card.recommendationChange.compositeDelta}`}
                  tone={recommendationChangeTone(card)}
                />
                <ScorePill
                  label="Risk delta"
                  score={`${card.recommendationChange.riskDelta > 0 ? '+' : ''}${card.recommendationChange.riskDelta}`}
                  tone={card.recommendationChange.riskDelta <= 0 ? 'positive' : 'negative'}
                />
                <ScorePill label="Previous" score={card.recommendationChange.previousAction} tone={toneForAction(card.recommendationChange.previousAction)} />
              </div>
            </Link>
          ))}
        </div>
        )}
      </Panel>
    </div>
  );
}
