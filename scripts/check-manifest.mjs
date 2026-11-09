import { createPublicKey } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeExtensionId } from './extension-key.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.resolve(repoRoot, 'dist');

const ALLOWED_PERMISSIONS = new Set(['storage', 'scripting', 'alarms']);
const failures = [];

function assert(name, condition, detail = '') {
  if (!condition) failures.push(`${name}${detail ? `：${detail}` : ''}`);
}

async function fileExists(relativePath) {
  try {
    await stat(path.join(distDir, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(distDir, 'manifest.json'), 'utf8'));
  } catch (error) {
    console.error(`[manifest-check] 无法读取 dist/manifest.json：${error.message}`);
    process.exit(1);
  }

  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

  assert('M1 manifest_version', manifest.manifest_version === 3, String(manifest.manifest_version));
  assert('M2 name', typeof manifest.name === 'string' && manifest.name.length > 0);
  assert('M2 description', typeof manifest.description === 'string' && manifest.description.length > 0);
  assert(
    'M2 version 与 package.json 一致',
    manifest.version === pkg.version,
    `manifest=${manifest.version} package=${pkg.version}`,
  );
  assert(
    'M3 background.service_worker',
    manifest.background?.service_worker === 'background.js' && manifest.background?.type === undefined,
    JSON.stringify(manifest.background),
  );
  assert(
    'M4 action.default_popup',
    manifest.action?.default_popup === 'popup/index.html',
    String(manifest.action?.default_popup),
  );
  assert(
    'M5 options_ui',
    manifest.options_ui?.page === 'options/index.html' && manifest.options_ui?.open_in_tab === true,
    JSON.stringify(manifest.options_ui),
  );

  const permissions = manifest.permissions ?? [];
  assert(
    'M6 permissions 白名单',
    Array.isArray(permissions) && permissions.every((item) => ALLOWED_PERMISSIONS.has(item)),
    JSON.stringify(permissions),
  );
  assert(
    'M7 host_permissions 为空',
    Array.isArray(manifest.host_permissions) && manifest.host_permissions.length === 0,
    JSON.stringify(manifest.host_permissions),
  );
  assert(
    'M8 content_scripts 为空（动态注册）',
    Array.isArray(manifest.content_scripts) && manifest.content_scripts.length === 0,
    JSON.stringify(manifest.content_scripts),
  );
  assert(
    'M9 optional_host_permissions',
    Array.isArray(manifest.optional_host_permissions) &&
      manifest.optional_host_permissions.length === 2 &&
      manifest.optional_host_permissions.includes('http://*/*') &&
      manifest.optional_host_permissions.includes('https://*/*'),
    JSON.stringify(manifest.optional_host_permissions),
  );

  const iconSizes = ['16', '32', '48', '128'];
  for (const size of iconSizes) {
    assert(`M10 图标 ${size} 声明`, typeof manifest.icons?.[size] === 'string');
    assert(`M10 图标 ${size} 文件`, await fileExists(`icons/icon-${size}.png`));
  }
  assert('M10 action 图标', typeof manifest.action?.default_icon?.['16'] === 'string');

  for (const reference of [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
  ]) {
    if (typeof reference === 'string') {
      assert(`M11 引用文件存在 ${reference}`, await fileExists(reference));
    }
  }

  assert('M12 无 web_accessible_resources', manifest.web_accessible_resources === undefined);
  assert('M12 无自定义 CSP', manifest.content_security_policy === undefined);
  assert('M12 无 sandbox', manifest.sandbox === undefined);
  assert('M13 minimum_chrome_version', manifest.minimum_chrome_version === '116');
  assert('M10 name/短名称长度', typeof manifest.name === 'string' && manifest.name.length <= 75);

  if (manifest.key !== undefined) {
    assert('M15 key 为公钥字符串', typeof manifest.key === 'string' && manifest.key.length > 0);
    try {
      createPublicKey({ key: Buffer.from(manifest.key, 'base64'), format: 'der', type: 'spki' });
      console.log(`[manifest-check] 已固定扩展 ID：${computeExtensionId(manifest.key)}`);
    } catch (error) {
      assert('M15 key 为合法 SPKI 公钥', false, error instanceof Error ? error.message : String(error));
    }
  }

  const sourceFiles = ['background.js', 'content.js'];
  for (const file of sourceFiles) {
    if (!(await fileExists(file))) {
      assert(`M14 ${file} 存在`, false);
      continue;
    }
    const content = await readFile(path.join(distDir, file), 'utf8');
    assert(`M14 ${file} 无 eval`, !content.includes('eval('));
    assert(`M14 ${file} 无 new Function`, !content.includes('new Function('));
  }

  const assetsDir = path.join(distDir, 'assets');
  const assetEntries = await readdir(assetsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of assetEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const content = await readFile(path.join(assetsDir, entry.name), 'utf8');
    assert(`M14 assets/${entry.name} 无 eval`, !content.includes('eval('));
  }

  if (failures.length > 0) {
    console.error(`[manifest-check] 失败 ${failures.length} 项：`);
    for (const item of failures) console.error(`  - ${item}`);
    process.exit(1);
  }

  console.log('[manifest-check] 全部 14 组断言通过');
}

await main();
