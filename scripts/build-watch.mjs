import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let timer = null;
function regenerateManifest() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    import('./generate-manifest.mjs')
      .then(({ generateManifest }) => generateManifest())
      .then(() => console.log('[watch] 已重新生成 manifest.json，请在扩展页面点击「重新加载」'))
      .catch((error) => console.warn(`[watch] manifest 生成失败：${error.message}`));
  }, 300);
}

for (const target of ['ui', 'background', 'content']) {
  const watcher = await build({
    configFile: path.resolve(repoRoot, 'vite.config.ts'),
    mode: target,
    logLevel: 'info',
    plugins: [{ name: 'oa-manifest-regen', closeBundle: regenerateManifest }],
    build: { watch: {} },
  });
  const rollup = Array.isArray(watcher) ? watcher[0] : watcher;
  rollup.on?.('event', (event) => {
    if (event.code === 'ERROR') console.error(`[watch:${target}]`, event.error);
  });
}

console.log('[watch] 三趟构建已进入 watch 模式（扩展页面需手动重新加载）');
