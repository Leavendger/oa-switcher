import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--oa-bg) / <alpha-value>)',
        surface: 'rgb(var(--oa-surface) / <alpha-value>)',
        border: 'rgb(var(--oa-border) / <alpha-value>)',
        text: 'rgb(var(--oa-text) / <alpha-value>)',
        muted: 'rgb(var(--oa-muted) / <alpha-value>)',
        accent: 'rgb(var(--oa-accent) / <alpha-value>)',
        danger: 'rgb(var(--oa-danger) / <alpha-value>)',
        success: 'rgb(var(--oa-success) / <alpha-value>)',
      },
      borderRadius: {
        oa: '10px',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'PingFang SC', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
