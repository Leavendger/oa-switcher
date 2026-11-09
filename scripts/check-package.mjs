import { execFileSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeExtensionId, readExtensionKeyBase64 } from './extension-key.mjs';
import { ALLOWED_ROOT_ENTRIES, REQUIRED_FILES, isForbiddenFile, rootEntryOf } from './release-spec.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const version = String(pkg.version);

const VARIANTS = [
  { suffix: '', label: '普通包', required: true },
  { suffix: '-pinned-id', label: '固定 ID 包', required: false },
];

const failures = [];

function assert(name, condition, detail = '') {
  if (!condition) failures.push(`${name}${detail ? `：${detail}` : ''}`);
}

function unzip(args, options = {}) {
  return execFileSync('unzip', args, { encoding: 'utf8', ...options });
}

function checkListing(label, files) {
  for (const file of REQUIRED_FILES) {
    assert(`${label} 必须包含 ${file}`, files.has(file));
  }
  for (const file of files) {
    assert(`${label} 允许的顶层入口 ${file}`, ALLOWED_ROOT_ENTRIES.has(rootEntryOf(file)), rootEntryOf(file));
    assert(`${label} 无调试残留 ${file}`, !isForbiddenFile(file));
  }
}

function checkManifest(label, manifest, files) {
  assert(`${label} manifest_version 为 3`, manifest.manifest_version === 3);
  assert(`${label} 版本与 package.json 一致`, manifest.version === version, String(manifest.version));
  assert(`${label} background 入口存在`, files.has(String(manifest.background?.service_worker)));
  assert(`${label} popup 入口存在`, files.has(String(manifest.action?.default_popup)));
  assert(`${label} options 入口存在`, files.has(String(manifest.options_ui?.page)));

  for (const size of ['16', '32', '48', '128']) {
    const icon = manifest.icons?.[size];
    assert(`${label} 声明图标 ${size}`, typeof icon === 'string' && files.has(icon));
  }
}

/** 校验 manifest.key：普通包必须没有；固定 ID 包必须是仓库当前公钥。 */
async function checkVariantKey(label, manifest) {
  if (label === '普通包') {
    assert(`${label} 不应包含 manifest.key`, manifest.key === undefined);
    return null;
  }

  if (typeof manifest.key !== 'string' || manifest.key.length === 0) {
    assert(`${label} manifest.key 必须是公钥字符串`, typeof manifest.key);
    return null;
  }

  try {
    const der = Buffer.from(manifest.key, 'base64');
    createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch (error) {
    assert(`${label} manifest.key 不是合法的 SPKI 公钥`, false, error instanceof Error ? error.message : String(error));
    return null;
  }

  const expected = await readExtensionKeyBase64().catch(() => null);
  assert(`${label} manifest.key 与 keys/extension-public-key.pem 一致`, expected !== null && manifest.key === expected);
  return computeExtensionId(manifest.key);
}

async function checkVariant(variant) {
  const releaseFolder = path.resolve(repoRoot, 'release', `oa-switcher-${version}${variant.suffix}`);
  const zipPath = path.resolve(repoRoot, 'release', `oa-switcher-${version}${variant.suffix}.zip`);
  const label = variant.label;

  const hasFolder = await stat(releaseFolder).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
  const hasZip = await stat(zipPath).then(
    () => true,
    () => false,
  );

  if (!hasFolder && !hasZip) {
    if (variant.required) {
      assert(`${label} 交付目录存在`, false, releaseFolder);
    } else {
      console.log(`[package-check] 未发现${label}，跳过（执行 npm run package -- --pin-id 可生成）`);
    }
    return null;
  }

  const folderFiles = new Set();
  let manifestFromFolder = null;

  if (hasFolder) {
    const folderListing = await collectFolderFiles(releaseFolder).catch((error) => {
      assert(`${label} 读取交付目录`, false, error instanceof Error ? error.message : String(error));
      return [];
    });
    for (const file of folderListing) folderFiles.add(file);
    if (folderListing.length > 0) {
      checkListing(label, folderFiles);
      manifestFromFolder = JSON.parse(await readFile(path.join(releaseFolder, 'manifest.json'), 'utf8'));
      checkManifest(label, manifestFromFolder, folderFiles);
    }
  } else {
    assert(`${label} 交付目录存在`, false, releaseFolder);
  }

  let zipFiles = new Set();
  if (hasZip) {
    try {
      const listing = unzip(['-Z1', zipPath])
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.endsWith('/'));
      zipFiles = new Set(listing);
    } catch (error) {
      assert(`${label} zip 归档存在且可读取`, false, error instanceof Error ? error.message : String(error));
    }
  } else {
    assert(`${label} zip 归档存在`, false, zipPath);
  }

  if (zipFiles.size > 0) {
    checkListing(label, zipFiles);
    const manifestFromZip = JSON.parse(unzip(['-p', zipPath, 'manifest.json']));
    checkManifest(label, manifestFromZip, zipFiles);
    unzip(['-t', zipPath]);

    const folderOnly = [...folderFiles].filter((file) => !zipFiles.has(file));
    const zipOnly = [...zipFiles].filter((file) => !folderFiles.has(file));
    assert(`${label} 目录与 zip 文件清单一致`, folderOnly.length === 0 && zipOnly.length === 0,
      [...folderOnly.map((f) => `仅目录 ${f}`), ...zipOnly.map((f) => `仅 zip ${f}`)].join(', '));
  }

  const id = await checkVariantKey(label, manifestFromFolder ?? {});
  if (id) console.log(`[package-check] ${label}固定扩展 ID：${id}`);

  const folderSize = hasFolder ? await sizeOf(releaseFolder) : 0;
  const zipSize = hasZip ? (await stat(zipPath).then((s) => s.size).catch(() => 0)) : 0;
  console.log(
    `[package-check] ${label}：目录 ${folderFiles.size} 个文件 / ${folderSize} bytes；zip ${zipFiles.size} 个文件 / ${zipSize} bytes`,
  );
  return { folderFiles: folderFiles.size, folderSize, zipFiles: zipFiles.size, zipSize };
}

async function main() {
  const totals = { folderFiles: 0, folderSize: 0, zipFiles: 0, zipSize: 0 };
  for (const variant of VARIANTS) {
    const result = await checkVariant(variant);
    if (!result) continue;
    for (const key of Object.keys(totals)) totals[key] += result[key];
  }

  if (failures.length > 0) {
    console.error(`[package-check] 失败 ${failures.length} 项：`);
    for (const item of failures) console.error(`  - ${item}`);
    process.exit(1);
  }

  console.log(
    `[package-check] 全部断言通过（目录 ${totals.folderFiles} 个文件 / ${totals.folderSize} bytes；zip ${totals.zipFiles} 个文件 / ${totals.zipSize} bytes）`,
  );
}

async function collectFolderFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collectFolderFiles(path.join(dir, entry.name), relative)));
    } else {
      files.push(relative);
    }
  }
  return files;
}

async function sizeOf(dir) {
  const files = await collectFolderFiles(dir);
  const sizes = await Promise.all(files.map((file) => stat(path.join(dir, file)).then((s) => s.size)));
  return sizes.reduce((total, size) => total + size, 0);
}

main().catch((error) => {
  console.error(`[package-check] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
