import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  path.resolve(repoRoot, 'src', 'adapters'),
  path.resolve(repoRoot, 'src', 'content'),
];

const RULES = [
  { name: 'CSS id 选择器常量', re: /(['"`])#[\w-]+/ },
  { name: 'input[name= 选择器', re: /input\[name=/ },
  { name: '退出 URL 常量', re: /logout(?:Url|URL|_url)\s*[:=]/ },
  { name: '硬编码 http(s) URL', re: /(['"`])https?:\/\/[^'"`]+/ },
];

/**
 * 厂商预设是唯一允许写具体选择器的位置：预设的价值就在于携带站点结构特征。
 * 范围严格限定为 `src/adapters/<vendor>/preset.ts`，其余文件仍全部禁止；
 * 预设本身必须满足「相对写法（{origin} 占位）、可逐项覆盖、可自检、可判过期」。
 */
function isPresetFile(file) {
  const relative = path.relative(repoRoot, file).split(path.sep).join('/');
  return /^src\/adapters\/[^/]+\/preset\.ts$/.test(relative);
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

async function main() {
  let checked = 0;
  const findings = [];

  for (const dir of targets) {
    for (const file of await listFiles(dir)) {
      // 厂商预设是唯一豁免点，见上方 isPresetFile 说明
      if (isPresetFile(file)) continue;
      checked += 1;
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        for (const rule of RULES) {
          if (rule.re.test(line)) {
            findings.push(`${path.relative(repoRoot, file)}:${index + 1} ${rule.name}`);
          }
        }
      });
    }
  }

  if (findings.length > 0) {
    console.error('[selector-check] 发现疑似具体选择器/退出地址，阶段一禁止写入：');
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }

  console.log(`[selector-check] ${checked} 个适配器/页面脚本文件，未发现具体 OA 选择器或退出地址`);
}

main().catch((error) => {
  console.error(`[selector-check] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
