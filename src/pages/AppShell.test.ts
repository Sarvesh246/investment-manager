import { describe, expect, it, vi } from 'vitest';
import { bindSkipLinkFocus } from './AppShell';

describe('bindSkipLinkFocus', () => {
  it('prevents default navigation and focuses main content', () => {
    let handler: ((event: Event) => void) | null = null;
    const preventDefault = vi.fn();
    const focus = vi.fn();

    const skipLink = {
      addEventListener: vi.fn((_type: string, nextHandler: EventListener) => {
        handler = nextHandler;
      }),
      removeEventListener: vi.fn(),
    };

    const cleanup = bindSkipLinkFocus(
      skipLink as unknown as HTMLAnchorElement,
      { focus } as unknown as HTMLElement,
    );

    expect(handler).not.toBeNull();

    if (!handler) {
      throw new Error('Expected skip-link handler to be registered.');
    }

    const activeHandler = handler as (event: Event) => void;
    activeHandler({ preventDefault } as unknown as Event);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);

    cleanup();
    expect(skipLink.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
