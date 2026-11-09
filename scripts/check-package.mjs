import { execFileSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeExtensionId } from './extension-key.mjs';
import { ALLOWED_ROOT_ENTRIES, REQUIRED_FILES, isForbiddenFile, rootEntryOf } from './release-spec.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const version = String(pkg.version);
const releaseFolder = path.resolve(repoRoot, 'release', `oa-switcher-${version}`);
const zipPath = path.resolve(repoRoot, 'release', `oa-switcher-${version}.zip`);

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

  if (manifest.key === undefined) return;
  if (typeof manifest.key !== 'string' || manifest.key.length === 0) {
    assert(`${label} manifest.key 必须是公钥字符串`, typeof manifest.key);
    return;
  }
  try {
    const der = Buffer.from(manifest.key, 'base64');
    createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch (error) {
    assert(`${label} manifest.key 不是合法的 SPKI 公钥`, error instanceof Error ? error.message : String(error));
  }
}

async function main() {
  const folderFiles = new Set();
  let manifestFromFolder = null;

  try {
    const entries = await stat(releaseFolder);
    assert('交付目录存在', entries.isDirectory(), releaseFolder);
  } catch {
    assert('交付目录存在', false, releaseFolder);
  }

  // 目录产物：本身即可被「加载已解压的扩展程序」直接选择，不需要解压。
  const folderListing = await collectFolderFiles(releaseFolder).catch((error) => {
    assert('读取交付目录', false, error instanceof Error ? error.message : String(error));
    return [];
  });
  for (const file of folderListing) folderFiles.add(file);
  if (folderListing.length > 0) {
    checkListing('交付目录', folderFiles);
    manifestFromFolder = JSON.parse(await readFile(path.join(releaseFolder, 'manifest.json'), 'utf8'));
    checkManifest('交付目录', manifestFromFolder, folderFiles);
  }

  // zip 归档：与目录内容完全一致。
  let zipFiles = new Set();
  try {
    const listing = unzip(['-Z1', zipPath])
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.endsWith('/'));
    zipFiles = new Set(listing);
  } catch (error) {
    assert('zip 归档存在且可读取', false, error instanceof Error ? error.message : String(error));
  }

  if (zipFiles.size > 0) {
    checkListing('zip', zipFiles);
    const manifestFromZip = JSON.parse(unzip(['-p', zipPath, 'manifest.json']));
    checkManifest('zip', manifestFromZip, zipFiles);
    unzip(['-t', zipPath]);

    const folderOnly = [...folderFiles].filter((file) => !zipFiles.has(file));
    const zipOnly = [...zipFiles].filter((file) => !folderFiles.has(file));
    assert('目录与 zip 文件清单一致', folderOnly.length === 0 && zipOnly.length === 0,
      [...folderOnly.map((f) => `仅目录 ${f}`), ...zipOnly.map((f) => `仅 zip ${f}`)].join(', '));
  }

  if (manifestFromFolder?.key !== undefined) {
    const id = computeExtensionId(manifestFromFolder.key);
    console.log(`[package-check] manifest.key 已设置，固定扩展 ID 预计为 ${id}`);
  } else if (manifestFromFolder) {
    console.log('[package-check] 未设置 manifest.key（默认：扩展 ID 由加载路径决定）');
  }

  const folderSize = await sizeOf(releaseFolder);
  const zipSize = await stat(zipPath).then((s) => s.size).catch(() => 0);

  if (failures.length > 0) {
    console.error(`[package-check] 失败 ${failures.length} 项：`);
    for (const item of failures) console.error(`  - ${item}`);
    process.exit(1);
  }

  console.log(
    `[package-check] 全部断言通过（目录 ${folderFiles.size} 个文件 / ${folderSize} bytes；zip ${zipFiles.size} 个文件 / ${zipSize} bytes）`,
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
