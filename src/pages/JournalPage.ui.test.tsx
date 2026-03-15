// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JournalPage } from './JournalPage';
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

describe('JournalPage journal CRUD', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('adds, edits, and deletes journal entries with confirmation and toasts', () => {
    vi.stubGlobal('confirm', vi.fn(() => true));

    const { container, cleanup } = renderDom(
      <TestAppProviders overrides={{ journal: [] }}>
        <JournalPage />
      </TestAppProviders>,
    );

    expect(textContent(container)).toContain('Add your first journal entry');

    click(getButtonByText(container, 'Add your first entry'));
    typeValue(getInputByPlaceholder(container, 'AAPL') as HTMLInputElement, 'MSFT');
    typeValue(
      getInputByPlaceholder(container, 'Why did you buy this?') as HTMLTextAreaElement,
      'Cloud platform durability',
    );
    click(getButtonByText(document.body, 'Add entry', 'last'));

    expect(textContent(container)).toContain('MSFT - Buy');
    expect(textContent(document.body)).toContain('Journal entry added');

    click(getButtonByLabel(container, 'Edit entry'));
    typeValue(
      getInputByPlaceholder(container, 'How did it turn out? (fill in later)') as HTMLTextAreaElement,
      'Still holding',
    );
    click(getButtonByText(document.body, 'Save changes'));

    expect(textContent(container)).toContain('Still holding');
    expect(textContent(document.body)).toContain('Journal entry updated');

    click(getButtonByLabel(container, 'Delete entry'));

    expect(textContent(container)).toContain('Add your first journal entry');
    expect(textContent(document.body)).toContain('Journal entry removed');

    cleanup();
  });
});
