/**
 * 只读页面探针：由 chrome.scripting.executeScript 注入页面执行。
 * 约束：
 * - 不读取任何 input.value / cookie / localStorage / 页面正文；
 * - 只采集表单结构、属性、可见性与短文本；
 * - 函数必须自包含（注入时无法访问模块作用域）。
 */

export interface PageFormFact {
  index: number;
  action: string | null;
  method: string;
  id: string;
  name: string;
}

export interface PageInputFact {
  formIndex: number | null;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  autocomplete: string;
  visible: boolean;
}

export interface PageButtonFact {
  formIndex: number | null;
  tag: string;
  type: string;
  name: string;
  id: string;
  text: string;
  visible: boolean;
}

export interface PageAlertFact {
  role: string;
  id: string;
  className: string;
  visible: boolean;
}

export interface PageLinkFact {
  href: string;
  text: string;
}

export interface PageFacts {
  url: string;
  title: string;
  readyState: string;
  forms: PageFormFact[];
  inputs: PageInputFact[];
  buttons: PageButtonFact[];
  alerts: PageAlertFact[];
  links: PageLinkFact[];
}

export function collectPageFacts(): PageFacts {
  const text = (value: string | null | undefined): string =>
    (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const isVisible = (el: Element): boolean => {
    const style = getComputedStyle(el as HTMLElement);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const formIndexOf = (el: Element): number | null => {
    const form = el.closest('form');
    if (!form) return null;
    return forms.indexOf(form);
  };

  const forms = Array.from(document.querySelectorAll('form'));
  const inputs = Array.from(document.querySelectorAll('input'));
  const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]'));

  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    forms: forms.map((form, index) => ({
      index,
      action: form.getAttribute('action'),
      method: (form.getAttribute('method') || 'get').toLowerCase(),
      id: form.id || '',
      name: form.getAttribute('name') || '',
    })),
    inputs: inputs.map((input) => ({
      formIndex: formIndexOf(input),
      type: (input.getAttribute('type') || 'text').toLowerCase(),
      name: input.getAttribute('name') || '',
      id: input.id || '',
      placeholder: text(input.getAttribute('placeholder')),
      ariaLabel: text(input.getAttribute('aria-label')),
      autocomplete: (input.getAttribute('autocomplete') || '').toLowerCase(),
      visible: isVisible(input),
    })),
    buttons: buttons.map((button) => ({
      formIndex: formIndexOf(button),
      tag: button.tagName.toLowerCase(),
      type: ((button as HTMLInputElement).type || '').toLowerCase(),
      name: button.getAttribute('name') || '',
      id: button.id || '',
      text: text((button as HTMLInputElement).value || button.textContent),
      visible: isVisible(button),
    })),
    alerts: Array.from(
      document.querySelectorAll('[role="alert"], [aria-live], .error, .tip, .message, [class*="error"], [class*="tip"]'),
    )
      .slice(0, 20)
      .map((el) => ({
        role: el.getAttribute('role') || '',
        id: el.id || '',
        className: typeof el.className === 'string' ? el.className : '',
        visible: isVisible(el),
      })),
    links: Array.from(document.querySelectorAll('a[href]'))
      .slice(0, 60)
      .map((anchor) => ({
        href: (anchor as HTMLAnchorElement).href,
        text: text(anchor.textContent),
      })),
  };
}

export interface SelectorCountFact {
  selector: string;
  count: number | null;
  error: string | null;
}

/** 自检探针：只统计选择器命中数量，不做任何点击/填写。 */
export function countSelectors(selectors: string[]): SelectorCountFact[] {
  return selectors.map((selector) => {
    try {
      return { selector, count: document.querySelectorAll(selector).length, error: null };
    } catch (cause) {
      return {
        selector,
        count: null,
        error: cause instanceof Error ? 'invalid-selector' : 'query-failed',
      };
    }
  });
}
