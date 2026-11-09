import path from 'node:path';

// 交付包（release 目录 / zip）共用的文件白名单与必需文件，package 与 check:package 均以此为准。
export const REQUIRED_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup/index.html',
  'options/index.html',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
];

export const ALLOWED_ROOT_ENTRIES = new Set([
  'manifest.json',
  'background.js',
  'content.js',
  'icons',
  'popup',
  'options',
  'assets',
]);

export const SILENT_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export function isForbiddenFile(relativePath) {
  const base = path.basename(relativePath);
  return (
    relativePath.endsWith('.map') ||
    relativePath.endsWith('.ts') ||
    relativePath.endsWith('.tsx') ||
    relativePath.endsWith('.log') ||
    relativePath.endsWith('.tmp') ||
    SILENT_FILES.has(base) ||
    relativePath.includes('node_modules/') ||
    relativePath.includes('__MACOSX/')
  );
}

export function rootEntryOf(relativePath) {
  return relativePath.split('/')[0];
}
