// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { StockPage } from './StockPage';
import { TestAppProviders } from '../test/TestAppProviders';
import { renderDom, textContent } from '../test/domTestUtils';

describe('StockPage live coverage loading state', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('keeps searchable symbols in loading state while live coverage is still hydrating', () => {
    const ensureLiveSecurity = vi.fn(async () => {});

    const { container, cleanup } = renderDom(
      <TestAppProviders
        initialEntries={['/stocks/AGMB']}
        overrides={{
          symbolDirectory: [
            {
              symbol: 'AGMB',
              displaySymbol: 'AGMB',
              name: 'AGM Group Holdings Inc.',
              exchange: 'NASDAQ',
              universes: ['nasdaq'],
            },
          ],
          ensureLiveSecurity,
        }}
      >
        <Routes>
          <Route path="/stocks/:symbol" element={<StockPage />} />
        </Routes>
      </TestAppProviders>,
    );

    expect(textContent(container)).toContain('Loading Live Coverage');
    expect(textContent(container)).toContain('AGM Group Holdings Inc.');
    expect(textContent(container)).not.toContain('Stock Not Found');
    expect(ensureLiveSecurity).toHaveBeenCalledWith('AGMB');

    cleanup();
  });
});
