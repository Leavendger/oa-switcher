import { FlowError } from '../shared/types/errors';
import type { PageDriver } from '../adapters/types';

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new FlowError('E_CANCELLED');
}

const POLL_MS = 250;

function invalidSelectorError(): FlowError {
  return new FlowError('E_CONFIG_MISSING', { field: 'adapterConfig', reason: 'invalid-selector' });
}

/** 选择器写错（CSS 语法非法）属于配置错误，映射为 E_CONFIG_MISSING 而非内部错误。 */
function query<T extends Element>(selector: string): T | null {
  try {
    return document.querySelector<T>(selector);
  } catch (error) {
    if (error instanceof DOMException) throw invalidSelectorError();
    throw error;
  }
}

function queryAll<T extends Element>(selector: string): T[] {
  try {
    return Array.from(document.querySelectorAll<T>(selector));
  } catch (error) {
    if (error instanceof DOMException) throw invalidSelectorError();
    throw error;
  }
}

async function waitFor<T extends Element>(
  selector: string,
  options: {
    timeoutMs: number;
    signal: AbortSignal;
    timeoutCode?: 'E_TIMEOUT' | 'E_LOGIN_PAGE_TIMEOUT';
  },
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  const code = options.timeoutCode ?? 'E_TIMEOUT';
  for (;;) {
    throwIfAborted(options.signal);
    const found = query<T>(selector);
    if (found) return found;
    if (Date.now() >= deadline) throw new FlowError(code, { step: 'waitFor', field: selector });
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function waitUntil(
  predicate: () => boolean,
  options: { timeoutMs: number; pollMs: number; signal: AbortSignal },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  const pollMs = Math.max(50, options.pollMs);
  for (;;) {
    throwIfAborted(options.signal);
    if (predicate()) return;
    if (Date.now() >= deadline) throw new FlowError('E_TIMEOUT', { step: 'waitUntil' });
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }
}

async function click(element: Element): Promise<void> {
  if (!(element instanceof HTMLElement)) {
    throw new FlowError('E_FORM_NOT_FOUND', { field: 'element' });
  }
  if (element instanceof HTMLButtonElement && element.disabled) {
    throw new FlowError('E_SUBMIT_FAILED', { field: 'submit' });
  }
  element.scrollIntoView?.({ block: 'center' });
  element.click();
}

/** 使用原型上的原生 value setter，保证 React/Vue 受控组件也能感知到变更。 */
async function setValue(element: Element, value: string): Promise<void> {
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
    throw new FlowError('E_FILL_FAILED', { field: 'value' });
  }
  const prototype =
    element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new FlowError('E_FILL_FAILED', { field: 'value' });

  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur'));
}

async function submitForm(element: Element): Promise<void> {
  const form = element.closest('form');
  if (form) {
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }
    throw new FlowError('E_SUBMIT_FAILED', { field: 'submit' });
  }
  await click(element);
}

async function navigate(url: string, options: { signal: AbortSignal }): Promise<void> {
  throwIfAborted(options.signal);
  location.assign(url);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Content Script 提供的 DOM 驱动。不含任何 OA 专属选择器。 */
export function createPageDriver(): PageDriver {
  return {
    url: () => location.href,
    title: () => document.title,
    query,
    queryAll,
    waitFor,
    waitUntil,
    click,
    setValue,
    submitForm,
    navigate,
    sleep,
  };
}
