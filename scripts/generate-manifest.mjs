import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readExtensionKeyBase64 } from './extension-key.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function generateManifest() {
  const template = JSON.parse(await readFile(path.join(repoRoot, 'manifest.template.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const manifest = { ...template, version: pkg.version };

  if (process.env.OA_PIN_ID === '1') {
    manifest.key = await readExtensionKeyBase64();
  }

  await mkdir(path.join(repoRoot, 'dist'), { recursive: true });
  await writeFile(
    path.join(repoRoot, 'dist', 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `[manifest] 生成 dist/manifest.json（version=${manifest.version}${manifest.key ? '，已注入 key' : ''}）`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await generateManifest();
}
