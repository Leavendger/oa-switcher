import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 仓库内只保存公钥；私钥由 scripts/make-key.mjs 写到仓库外的用户目录。
export const PUBLIC_KEY_PATH = path.resolve(repoRoot, 'keys', 'extension-public-key.pem');

export async function readExtensionKeyBase64() {
  let pem;
  try {
    pem = await readFile(PUBLIC_KEY_PATH, 'utf8');
  } catch {
    throw new Error('缺少 keys/extension-public-key.pem，请先执行 npm run key:generate');
  }
  return pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
}

// Chrome 扩展 ID：公钥 DER 的 SHA-256 前 16 字节，每个 nibble 映射到 a-p。
export function computeExtensionId(base64Key) {
  const der = Buffer.from(base64Key, 'base64');
  const digest = createHash('sha256').update(der).digest().subarray(0, 16);
  let id = '';
  for (const byte of digest) {
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 0x0f));
  }
  return id;
}
