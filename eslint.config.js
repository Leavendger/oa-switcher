import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const importRules = (patterns, message) => [
  'error',
  { patterns: [{ group: patterns, message }] },
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'tests/fixtures/**', 'scripts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        chrome: 'readonly',
        crypto: 'readonly',
        document: 'readonly',
        window: 'readonly',
        location: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        Element: 'readonly',
        Event: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['src/background/**/*.ts'],
    rules: {
      'no-restricted-imports': importRules(
        [
          '../adapters/**',
          '../../adapters/**',
          '../../../adapters/**',
          '../content/**',
          '../../content/**',
          '../../../content/**',
          '../popup/**',
          '../../popup/**',
          '../options/**',
          '../../options/**',
          '../ui/**',
        ],
        'Background 不得依赖 Adapter / Content / UI 模块',
      ),
    },
  },
  {
    files: ['src/content/**/*.ts', 'src/adapters/**/*.ts'],
    rules: {
      'no-restricted-imports': importRules(
        [
          '../storage/**',
          '../../storage/**',
          '../../../storage/**',
          '../background/**',
          '../../background/**',
          '../../../background/**',
          '../crypto/**',
          '../../crypto/**',
          '../../../crypto/**',
        ],
        'Content / Adapter 不得访问存储、后台与加密模块',
      ),
    },
  },
  {
    files: ['src/storage/**/*.ts', 'src/popup/**/*.{ts,tsx}', 'src/options/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': importRules(
        ['../crypto/**', '../../crypto/**', '../../../crypto/**', '../../background/**', '../../../background/**'],
        '加密与后台模块仅允许 Background 使用',
      ),
    },
  },
);
