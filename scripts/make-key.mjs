import { generateKeyPairSync } from 'node:crypto';
import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_KEY_PATH, computeExtensionId } from './extension-key.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateKeyPath = path.join(os.homedir(), '.oa-switcher', 'extension-private-key.pem');

async function exists(target) {
  return access(target).then(
    () => true,
    () => false,
  );
}

async function main() {
  if (await exists(PUBLIC_KEY_PATH)) {
    console.error(`[key] 已存在 ${path.relative(repoRoot, PUBLIC_KEY_PATH)}；为避免改变扩展 ID，不会覆盖。`);
    console.error('[key] 如确需更换，请先自行备份并删除该公钥文件后重试。');
    process.exit(1);
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  await mkdir(path.dirname(PUBLIC_KEY_PATH), { recursive: true });
  await writeFile(PUBLIC_KEY_PATH, publicKey, 'utf8');

  await mkdir(path.dirname(privateKeyPath), { recursive: true });
  await writeFile(privateKeyPath, privateKey, { mode: 0o600 });
  await chmod(privateKeyPath, 0o600);

  const base64 = publicKey
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');

  console.log(`[key] 公钥已写入 ${path.relative(repoRoot, PUBLIC_KEY_PATH)}（可提交，用于固定扩展 ID）`);
  console.log(`[key] 私钥已写入仓库外 ${privateKeyPath}（权限 600；不参与未打包安装，勿提交）`);
  console.log(`[key] 启用后预计扩展 ID：${computeExtensionId(base64)}`);
  console.log('[key] 启用方式：npm run package -- --pin-id');
}

main().catch((error) => {
  console.error(`[key] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
