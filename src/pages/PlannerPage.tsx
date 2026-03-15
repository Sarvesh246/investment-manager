import { useEffect } from 'react';
import { ListTodo } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Panel,
  PageHeader,
  PageJumpNav,
  Tag,
  Table,
} from './../components/ui';
import { buildDeploymentPlan } from './../domain/engine';
import type { PlannerInputs } from './../domain/types';
import { useStoredState } from './../hooks/useStoredState';
import { formatCurrency, formatPercent, formatReturn } from './../lib/format';
import { buyBlocker, buyPotentialScore, potentialBuyRows, starterSizeLabel } from './shared';
import { usePortfolioWorkspace } from './../runtime/portfolioContext';

function PlannerPageContent() {
  const { dataset, model } = usePortfolioWorkspace();
  const [inputs, setInputs] = useStoredState<PlannerInputs>('ic-planner-inputs', {
    availableCash: dataset.user.investableCash,
    riskTolerance: dataset.user.riskTolerance,
    horizonMonths: dataset.user.timeHorizonMonths,
    priority: 'diversification',
    deploymentStyle: 'stage-entries',
  });

  useEffect(() => {
    setInputs((current) =>
      current.availableCash === dataset.user.investableCash
        ? current
        : {
            ...current,
            availableCash: dataset.user.investableCash,
          },
    );
  }, [dataset.user.investableCash, setInputs]);

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
          helpText="This is where you tell the app how cautious or aggressive you want to be with new cash right now."
        >
          <div className="filters filters--stacked">
            <label>
              Cash To Invest
              <input
                type="number"
                min={0}
                step={0.01}
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
                className="filter-select"
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
                className="filter-select"
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
                className="filter-select"
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
                <option value="safe-starter">Safe starter</option>
              </select>
            </label>
          </div>
        </Panel>

        <Panel
          id="plan-output"
          title="Recommended Deployment"
          eyebrow="Output"
          subtitle={plan.posture}
          helpText="This is the planner's plain-English answer: how much to invest now, how much to hold back, and why."
        >
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
          helpText="These are suggested starter ranges, not exact precision targets. The goal is to help you size sensibly without pretending the model knows the perfect weight."
        >
          {plan.allocations.length > 0 ? (
            <Table
              columns={['Symbol', 'Role', 'Starter Size', 'Dollars', 'Weight', 'Entry Style']}
              rows={plan.allocations.map((allocation) => [
                <Link key={allocation.symbol} to={`/stocks/${allocation.symbol}`} className="symbol-link">
                  {allocation.symbol}
                </Link>,
                <span key={`${allocation.symbol}-role`}>{allocation.role}</span>,
                <Tag key={`${allocation.symbol}-starter`} tone="neutral">
                  {starterSizeLabel(allocation.weightRange)}
                </Tag>,
                <span key={`${allocation.symbol}-dollars`}>
                  {allocation.dollarRange
                    ? `${formatCurrency(allocation.dollarRange[0])} - ${formatCurrency(allocation.dollarRange[1])}`
                    : formatCurrency(allocation.dollars)}
                </span>,
                <span key={`${allocation.symbol}-weight`}>
                  {allocation.weightRange
                    ? `${formatPercent(allocation.weightRange[0])} - ${formatPercent(allocation.weightRange[1])}`
                    : formatPercent(allocation.weight)}
                </span>,
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
              <div className="empty-state__icon" aria-hidden="true">
                <ListTodo size={36} strokeWidth={1.25} />
              </div>
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
          helpText="This is just as important as the buy list. It shows what the planner is intentionally refusing to fund right now and why."
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

export function PlannerPage() {
  const { dataset } = usePortfolioWorkspace();
  const plannerSeed = [
    dataset.user.investableCash,
    dataset.user.riskTolerance,
    dataset.user.timeHorizonMonths,
  ].join(':');

  return <PlannerPageContent key={plannerSeed} />;
}
