import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.resolve(repoRoot, 'dist');
const configFile = path.resolve(repoRoot, 'vite.config.ts');

// npm run build -- --pin-id / npm run package -- --pin-id：由 generate-manifest 注入 manifest.key。
if (process.argv.includes('--pin-id')) process.env.OA_PIN_ID = '1';

function fail(message) {
  console.error(`[build] 失败：${message}`);
  process.exit(1);
}

async function run(target) {
  await build({ configFile, mode: target, logLevel: 'warn' });
  console.log(`[build] ${target} 完成`);
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function assertBundle(fileName) {
  const content = await readFile(path.join(distDir, fileName), 'utf8');
  if (/^\s*import\s/m.test(content)) fail(`${fileName} 含顶层 import，必须是单文件 IIFE`);
  if (/^\s*export\s/m.test(content)) fail(`${fileName} 含 export，必须是单文件 IIFE`);
  if (content.includes('import(')) fail(`${fileName} 含动态 import()`);
  if (content.includes('eval(')) fail(`${fileName} 含 eval(`);
}

async function assertHtml(relativePath) {
  const html = await readFile(path.join(distDir, relativePath), 'utf8');
  const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1] ?? '');
  if (scriptSrcs.length === 0) fail(`${relativePath} 未引用任何外部脚本`);
  for (const src of scriptSrcs) {
    if (src.startsWith('http://') || src.startsWith('https://')) {
      fail(`${relativePath} 引用了远程脚本：${src}`);
    }
    if (!src.startsWith('./') && !src.startsWith('../')) {
      fail(`${relativePath} 的脚本路径不是相对路径：${src}`);
    }
  }
}

async function main() {
  execFileSync(process.execPath, [path.resolve(repoRoot, 'scripts', 'check-no-selectors.mjs')], {
    stdio: 'inherit',
  });

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  await run('ui');
  await run('background');
  await run('content');

  await cp(path.resolve(repoRoot, 'public', 'icons'), path.resolve(distDir, 'icons'), {
    recursive: true,
  });

  execFileSync(process.execPath, [path.resolve(repoRoot, 'scripts', 'generate-manifest.mjs')], {
    stdio: 'inherit',
  });
  execFileSync(process.execPath, [path.resolve(repoRoot, 'scripts', 'check-manifest.mjs')], {
    stdio: 'inherit',
  });

  await assertBundle('background.js');
  await assertBundle('content.js');
  await assertHtml('popup/index.html');
  await assertHtml('options/index.html');

  const files = await listFiles(distDir);
  const sourceLeak = files.filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'));
  if (sourceLeak.length > 0) fail(`dist 中存在源文件：${sourceLeak.join(', ')}`);

  const css = files.filter((file) => file.endsWith('.css'));
  if (css.length === 0) fail('未产出 CSS（Tailwind 可能未生效）');
  for (const file of css) {
    const size = (await stat(file)).size;
    if (size < 3000) fail(`CSS 过小（${size} bytes），Tailwind 可能未产出样式：${file}`);
  }

  for (const required of [
    'manifest.json',
    'background.js',
    'content.js',
    'popup/index.html',
    'options/index.html',
    'icons/icon-128.png',
  ]) {
    await stat(path.join(distDir, required)).catch(() => fail(`缺少产物 ${required}`));
  }

  console.log(`[build] 产物校验通过，共 ${files.length} 个文件`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
