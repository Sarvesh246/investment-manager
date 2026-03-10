import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Panel,
  PageHeader,
  PageJumpNav,
  Table,
} from './../components/ui';
import { buildDeploymentPlan } from './../domain/engine';
import type { PlannerInputs } from './../domain/types';
import { formatCurrency, formatPercent, formatReturn } from './../lib/format';
import { buyBlocker, buyPotentialScore, potentialBuyRows } from './shared';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';

export function PlannerPage() {
  const { dataset, model } = usePortfolioWorkspace();
  const [inputs, setInputs] = useState<PlannerInputs>({
    availableCash: dataset.user.investableCash,
    riskTolerance: dataset.user.riskTolerance,
    horizonMonths: dataset.user.timeHorizonMonths,
    priority: 'diversification',
    deploymentStyle: 'stage-entries',
  });

  const plan = buildDeploymentPlan(
    dataset,
    model.regime,
    model.scorecards,
    model.portfolioValue,
    inputs,
  );
  const nextUpCandidates = potentialBuyRows(model).slice(0, 5);

  return (
    <div className="page">
      <PageHeader
        title="Plan New Money"
        summary="Tell the app how much cash you want to put to work and it will suggest how much to invest now, what to keep in reserve, and which stocks deserve that cash."
      />

      <PageJumpNav
        items={[
          { href: '#plan-inputs', label: 'Inputs', detail: 'Set your posture' },
          { href: '#plan-output', label: 'Deployment', detail: 'How much to invest' },
          { href: '#plan-candidates', label: 'Candidates', detail: 'Where the cash would go' },
          { href: '#plan-avoid', label: 'Avoid list', detail: 'What is blocked' },
        ]}
      />

      <div className="two-column-layout">
        <Panel
          id="plan-inputs"
          title="Planner Inputs"
          eyebrow="Controls"
          subtitle="Change these inputs to see how your plan changes."
        >
          <div className="filters filters--stacked">
            <label>
              Cash To Invest
              <input
                type="number"
                min={1000}
                step={500}
                value={inputs.availableCash}
                onChange={(event) =>
                  setInputs((current) => ({
                    ...current,
                    availableCash: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              Risk Style
              <select
                value={inputs.riskTolerance}
                onChange={(event) =>
                  setInputs((current) => ({
                    ...current,
                    riskTolerance: event.target.value as PlannerInputs['riskTolerance'],
                  }))
                }
              >
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="moderate-aggressive">Moderate-aggressive</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>
            <label>
              Time Horizon (months)
              <input
                type="number"
                min={3}
                max={120}
                step={3}
                value={inputs.horizonMonths}
                onChange={(event) =>
                  setInputs((current) => ({
                    ...current,
                    horizonMonths: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label>
              Priority
              <select
                value={inputs.priority}
                onChange={(event) =>
                  setInputs((current) => ({
                    ...current,
                    priority: event.target.value as PlannerInputs['priority'],
                  }))
                }
              >
                <option value="safety">Safety</option>
                <option value="growth">Growth</option>
                <option value="diversification">Diversification</option>
                <option value="conviction">Conviction</option>
              </select>
            </label>
            <label>
              How To Enter
              <select
                value={inputs.deploymentStyle}
                onChange={(event) =>
                  setInputs((current) => ({
                    ...current,
                    deploymentStyle: event.target.value as PlannerInputs['deploymentStyle'],
                  }))
                }
              >
                <option value="deploy-all">Deploy all</option>
                <option value="stage-entries">Stage entries</option>
                <option value="hold-flexibility">Hold flexibility</option>
              </select>
            </label>
          </div>
        </Panel>

        <Panel id="plan-output" title="Recommended Deployment" eyebrow="Output" subtitle={plan.posture}>
          <div className="planner-callout">
            <h3>
              Deploy {formatCurrency(plan.deployNow)} now and keep {formatCurrency(plan.holdBack)} back.
            </h3>
            <p>
              Reserve target: {formatCurrency(plan.reserveTarget)}. Current regime: {model.regime.key}.
            </p>
          </div>
          <ul className="bullet-list">
            {plan.rationale.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="dashboard-grid">
        <Panel
          id="plan-candidates"
          title="Suggested Allocations"
          eyebrow="Capital Plan"
          subtitle="Candidates are selected and sized under fit, risk, and reserve constraints."
        >
          {plan.allocations.length > 0 ? (
            <Table
              columns={['Symbol', 'Role', 'Dollars', 'Weight', 'Entry Style']}
              rows={plan.allocations.map((allocation) => [
                <Link key={allocation.symbol} to={`/stocks/${allocation.symbol}`} className="symbol-link">
                  {allocation.symbol}
                </Link>,
                <span key={`${allocation.symbol}-role`}>{allocation.role}</span>,
                <span key={`${allocation.symbol}-dollars`}>{formatCurrency(allocation.dollars)}</span>,
                <span key={`${allocation.symbol}-weight`}>{formatPercent(allocation.weight)}</span>,
                <span key={`${allocation.symbol}-entry`}>{allocation.entryStyle}</span>,
              ])}
            />
          ) : nextUpCandidates.length > 0 ? (
            <Table
              columns={['Symbol', 'Current Label', 'Readiness', 'Base 12M', 'Main Blocker']}
              rows={nextUpCandidates.map((card) => [
                <Link key={card.symbol} to={`/stocks/${card.symbol}`} className="symbol-link">
                  {card.symbol}
                </Link>,
                <span key={`${card.symbol}-action`}>{card.action}</span>,
                <span key={`${card.symbol}-readiness`}>{buyPotentialScore(card)}/100</span>,
                <span key={`${card.symbol}-base`}>{formatReturn(card.expectedReturns[2].base)}</span>,
                <span key={`${card.symbol}-blocker`}>{buyBlocker(card)}</span>,
              ])}
            />
          ) : (
            <div className="empty-state empty-state--compact">
              <h2>No next-up names yet.</h2>
              <p>The planner does not see any non-held stock worth moving into the candidate queue right now.</p>
            </div>
          )}
        </Panel>

        <Panel
          id="plan-avoid"
          title="What Not To Buy"
          eyebrow="Avoid List"
          subtitle="Names blocked by portfolio fit, risk, sector rules, or event timing."
        >
          <div className="stack-list">
            {plan.avoids.map((item) => (
              <div key={item.symbol} className="text-card">
                <strong>{item.symbol}</strong>
                <p>{item.reason}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
