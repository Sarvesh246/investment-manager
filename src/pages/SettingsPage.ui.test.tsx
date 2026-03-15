// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { TestAppProviders } from '../test/TestAppProviders';
import {
  click,
  getButtonByLabel,
  getButtonByText,
  getInputByPlaceholder,
  renderDom,
  textContent,
  typeValue,
} from '../test/domTestUtils';

describe('SettingsPage watchlist interactions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('supports watchlist CRUD through the UI', () => {
    vi.stubGlobal('confirm', vi.fn(() => true));

    const { container, cleanup } = renderDom(
      <TestAppProviders overrides={{ watchlists: [] }}>
        <SettingsPage />
      </TestAppProviders>,
    );

    expect(textContent(container)).toContain('No watchlists yet');

    typeValue(getInputByPlaceholder(container, 'New watchlist name') as HTMLInputElement, 'Core Ideas');
    click(getButtonByText(container, 'Create'));

    expect(textContent(container)).toContain('Core Ideas');

    click(getButtonByText(container, 'Core Ideas'));

    const nameInput = [...container.querySelectorAll<HTMLInputElement>('input')].find(
      (input) => input.value === 'Core Ideas',
    );
    if (!nameInput) {
      throw new Error('Expected watchlist name input to appear.');
    }

    typeValue(nameInput, 'Core Compounders');
    expect(textContent(container)).toContain('Core Compounders');

    typeValue(getInputByPlaceholder(container, 'Add symbol') as HTMLInputElement, 'MSFT');
    click(getButtonByText(container, 'Add'));

    expect(textContent(container)).toContain('MSFT');

    click(getButtonByLabel(container, 'Remove MSFT'));
    expect(textContent(container)).not.toContain('MSFT');

    click(getButtonByLabel(container, 'Delete watchlist'));
    expect(textContent(container)).toContain('No watchlists yet');

    cleanup();
  });
});
