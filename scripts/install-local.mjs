import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeExtensionId } from './extension-key.mjs';
import { ALLOWED_ROOT_ENTRIES, REQUIRED_FILES, isForbiddenFile, rootEntryOf } from './release-spec.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TARGET = path.join(os.homedir(), 'oa-switcher', 'extension');

function fail(message) {
  console.error(`[install] 失败：${message}`);
  process.exit(1);
}

function readOption(name) {
  const args = process.argv.slice(2);
  const withEquals = args.find((arg) => arg.startsWith(`${name}=`));
  if (withEquals) return withEquals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) fail(`${name} 缺少路径参数`);
    return value;
  }
  return null;
}

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith(`~${path.sep}`)) return path.join(os.homedir(), value.slice(2));
  return value;
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

async function main() {
  const pinId = process.argv.includes('--pin-id');
  const version = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')).version;
  const suffix = pinId ? '-pinned-id' : '';
  const sourceDir = path.resolve(readOption('--source') ?? path.join(repoRoot, 'release', `oa-switcher-${version}${suffix}`));
  const targetDir = path.resolve(expandHome(readOption('--target') ?? DEFAULT_TARGET));

  const sourceStat = await stat(sourceDir).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    fail(`发行目录不存在：${sourceDir}\n  先执行 npm run package${pinId ? ' -- --pin-id' : ''}`);
  }

  const relativeSource = path.relative(sourceDir, targetDir);
  if (relativeSource === '' || (!relativeSource.startsWith('..') && !path.isAbsolute(relativeSource))) {
    fail('目标目录不能是发行目录本身或它的子目录');
  }

  const files = await listFiles(sourceDir);
  const relativeFiles = files.map((file) => path.relative(sourceDir, file).split(path.sep).join('/'));

  for (const file of relativeFiles) {
    if (!ALLOWED_ROOT_ENTRIES.has(rootEntryOf(file))) {
      fail(`发行目录包含白名单之外的入口：${file}`);
    }
    if (isForbiddenFile(file)) fail(`发行目录包含调试残留：${file}`);
  }
  for (const required of REQUIRED_FILES) {
    if (!relativeFiles.includes(required)) fail(`发行目录缺少必需文件：${required}`);
  }

  await mkdir(targetDir, { recursive: true });
  for (const file of relativeFiles) {
    const destination = path.join(targetDir, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(sourceDir, file), destination);
  }

  const manifest = JSON.parse(await readFile(path.join(targetDir, 'manifest.json'), 'utf8'));
  console.log(`[install] 来源：${sourceDir}`);
  console.log(`[install] 目标：${targetDir}`);
  console.log(`[install] 已写入 ${relativeFiles.length} 个文件（只覆盖扩展文件，未删除目录中的其他内容）`);
  console.log(`[install] manifest 版本：${manifest.version}${manifest.key ? `，固定扩展 ID：${computeExtensionId(manifest.key)}` : '（普通包，ID 由加载路径决定）'}`);
  console.log('[install] 下一步：打开 chrome://extensions（Edge 为 edge://extensions），找到 OA Switcher，点「重新加载」');

  if (pinId) {
    console.log('[install] 首次从普通包切换：先在旧版「设置 → 数据与迁移」导出完整包，再用本目录加载并导入');
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
