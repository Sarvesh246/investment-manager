// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { PlannerPage } from './PlannerPage';
import { RecommendationsPage } from './RecommendationsPage';
import { TestAppProviders } from '../test/TestAppProviders';
import { usePortfolioWorkspace } from '../runtime/portfolioContext';
import {
  click,
  getButtonByText,
  getPanelTitles,
  renderDom,
} from '../test/domTestUtils';

function PlannerMutationHarness() {
  const { setInvestableCash } = usePortfolioWorkspace();

  return (
    <>
      <button type="button" onClick={() => setInvestableCash(500)}>
        Mutate cash
      </button>
      <PlannerPage />
    </>
  );
}

function getCashInput(container: HTMLElement) {
  const cashInput = [...container.querySelectorAll<HTMLInputElement>('input')].find((input) => {
    if (input.type !== 'number') {
      return false;
    }

    const label = input.closest('label');
    return label?.textContent?.includes('Cash To Invest') ?? false;
  });

  if (!cashInput) {
    throw new Error('Expected planner cash input to be present.');
  }

  return cashInput;
}

function RecommendationsMutationHarness() {
  const { holdings, removeHolding } = usePortfolioWorkspace();

  return (
    <>
      <button type="button" onClick={() => holdings.forEach((holding) => removeHolding(holding.symbol))}>
        Clear holdings
      </button>
      <RecommendationsPage />
    </>
  );
}

describe('Planner and Recommendations react to workspace mutations', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('updates planner inputs when workspace buying power changes', () => {
    const { container, cleanup } = renderDom(
      <TestAppProviders>
        <PlannerMutationHarness />
      </TestAppProviders>,
    );

    const cashInput = getCashInput(container);

    const initialValue = Number(cashInput.value);
    expect(initialValue).not.toBe(500);

    click(getButtonByText(container, 'Mutate cash'));
    expect(Number(getCashInput(container).value)).toBe(500);

    cleanup();
  });

  it('recomputes recommendation buckets when holdings change', () => {
    const { container, cleanup } = renderDom(
      <TestAppProviders>
        <RecommendationsMutationHarness />
      </TestAppProviders>,
    );

    expect(getPanelTitles(container)).toContain('Trim');

    click(getButtonByText(container, 'Clear holdings'));

    expect(getPanelTitles(container)).not.toContain('Trim');

    cleanup();
  });
});
