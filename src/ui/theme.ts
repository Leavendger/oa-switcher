import type { ThemePreference } from '../shared/types/settings';

/** 把主题偏好写到 <html data-theme>；system 时交还给 prefers-color-scheme。 */
export function applyTheme(theme: ThemePreference): void {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
    return;
  }
  document.documentElement.dataset.theme = theme;
}
