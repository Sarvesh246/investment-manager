import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

export function renderDom(element: ReactElement) {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = createRoot(container);

  act(() => {
    root?.render(element);
  });

  return {
    container,
    cleanup() {
      act(() => {
        root?.unmount();
        root = null;
      });
      container.remove();
    },
  };
}

export function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

export function typeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype = Object.getPrototypeOf(element) as HTMLInputElement | HTMLTextAreaElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

  act(() => {
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

export function selectValue(element: HTMLSelectElement, value: string) {
  act(() => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

export function textContent(container: ParentNode) {
  return container.textContent ?? '';
}

export function getButtonByText(
  container: ParentNode,
  text: string,
  occurrence: 'first' | 'last' = 'first',
) {
  const matches = [...container.querySelectorAll('button')].filter((candidate) =>
    (candidate.textContent ?? '').includes(text),
  );
  const button = occurrence === 'last' ? matches.at(-1) : matches[0];

  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }

  return button as HTMLButtonElement;
}

export function getInputByPlaceholder(container: ParentNode, placeholder: string) {
  const input = [...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].find(
    (candidate) => candidate.getAttribute('placeholder') === placeholder,
  );

  if (!input) {
    throw new Error(`Input not found for placeholder: ${placeholder}`);
  }

  return input;
}

export function getButtonByLabel(container: ParentNode, label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );

  if (!button) {
    throw new Error(`Button not found for aria-label: ${label}`);
  }

  return button;
}

export function getPanelTitles(container: ParentNode) {
  return [...container.querySelectorAll('.panel__title')].map((node) => node.textContent?.trim() ?? '');
}
