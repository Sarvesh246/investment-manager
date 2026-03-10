import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import {
  Panel,
  PageHeader,
  Tag,
} from './../components/ui';
import { toneForAlert } from './shared';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';

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
