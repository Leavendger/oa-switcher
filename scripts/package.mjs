import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_ROOT_ENTRIES, REQUIRED_FILES, isForbiddenFile, rootEntryOf } from './release-spec.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.resolve(repoRoot, 'dist');
const releaseDir = path.resolve(repoRoot, 'release');

const pinId = process.argv.includes('--pin-id');

const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const version = String(pkg.version);
// 两种包并排产出：普通包与固定 ID 包，避免同名互相覆盖。
const variant = pinId ? '-pinned-id' : '';
const releaseFolder = path.resolve(releaseDir, `oa-switcher-${version}${variant}`);
const stagingDir = path.resolve(releaseDir, `.staging-${version}${variant}`);
const zipPath = path.resolve(releaseDir, `oa-switcher-${version}${variant}.zip`);

const INCLUDE = ['manifest.json', 'background.js', 'content.js', 'icons', 'popup', 'options', 'assets'];

function fail(message) {
  console.error(`[package] 失败：${message}`);
  process.exit(1);
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

async function pathExists(target) {
  return stat(target).then(
    () => true,
    () => false,
  );
}

async function cleanLegacyStaging() {
  const entries = await readdir(releaseDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.staging-') || entry.name === '.DS_Store') {
      await rm(path.join(releaseDir, entry.name), { recursive: true, force: true });
    }
  }
}

async function main() {
  // npm run package -- --pin-id 时把开关透传给构建，由 generate-manifest 注入 manifest.key。
  execFileSync(process.execPath, [path.resolve(repoRoot, 'scripts', 'build.mjs'), ...(pinId ? ['--pin-id'] : [])], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  for (const file of REQUIRED_FILES) {
    await stat(path.join(distDir, file)).catch(() => fail(`dist 缺少 ${file}，构建未产出完整产物`));
  }

  await mkdir(releaseDir, { recursive: true });
  await cleanLegacyStaging();
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  for (const entry of INCLUDE) {
    const source = path.join(distDir, entry);
    if (!(await pathExists(source))) continue;
    await cp(source, path.join(stagingDir, entry), {
      recursive: true,
      filter: (file) => !file.endsWith('.map'),
    });
  }

  const staged = await listFiles(stagingDir);
  const relativeFiles = staged.map((file) => path.relative(stagingDir, file).split(path.sep).join('/'));

  for (const file of relativeFiles) {
    if (isForbiddenFile(file)) fail(`暂存目录包含调试残留：${file}`);
    if (!ALLOWED_ROOT_ENTRIES.has(rootEntryOf(file))) fail(`暂存目录包含白名单之外的入口：${file}`);
  }

  // 目录本身就是「加载已解压的扩展程序」可直接选择的交付物；zip 仅作为归档。
  await rm(releaseFolder, { recursive: true, force: true });
  await rename(stagingDir, releaseFolder);

  await rm(zipPath, { force: true });
  const entries = INCLUDE.filter((entry) => relativeFiles.some((file) => rootEntryOf(file) === entry));
  execFileSync('zip', ['-r', '-q', zipPath, ...entries], { cwd: releaseFolder });

  const folderSize = (
    await Promise.all(relativeFiles.map((file) => stat(path.join(releaseFolder, file)).then((s) => s.size)))
  ).reduce((total, size) => total + size, 0);
  const zipSize = (await stat(zipPath)).size;
  const mode = pinId ? '已固定扩展 ID' : '未固定扩展 ID（默认）';

  console.log(`[package] 交付目录：release/oa-switcher-${version}${variant}/（${relativeFiles.length} 个文件，${folderSize} bytes）`);
  console.log(`[package] 归档 zip：release/oa-switcher-${version}${variant}.zip（${zipSize} bytes），包模式：${mode}`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
