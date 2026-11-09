# OA Switcher 开发总结

> 面向几周后回来接手的人，也面向想了解「这个插件到底怎么做的」的同事。
> 本文基于仓库当前代码与真实排障记录整理；文中命令、体积、耗时均来自当前构建与 `docs/testing.md`。
> 相关文档：[架构说明](./architecture.md)、[测试与真实环境记录](./testing.md)。

---

## 1. 原始需求与演进

### 1.1 起点：一天要在多个 OA 之间来回切

最初的诉求很具体：手上有多个 OA 系统（蓝凌、以及后来遇到的其它厂商），每个系统里又可能有多套账号（例如「管理员 1」「管理员 2」）。日常操作是：

1. 打开 OA；
2. 退出当前账号；
3. 在登录页手动输入另一个账号和密码；
4. 等门户加载完成；
5. 过一会儿又要切回来。

痛点不在「记不住密码」，而在**切换动作本身**：退出、等待跳转、找输入框、提交、再等跳转，一套下来十几秒到几十秒，而且容易点错。浏览器密码管理器能填表，但不会帮你先退出，也不会确认「现在到底登录的是谁」。

因此第一版的目标被限定得很清楚：**让用户在扩展里维护「系统 + 账号」，点一下完成退出与重新登录，并在结束后确认真的登录成功**。不做密码管理器替代品，不做通用 RPA。

### 1.2 演进时间线

| 阶段 | 主题 | 关键变化 |
|---|---|---|
| 阶段一 | 能切换 | 多系统、多账号、分组；Popup 内选择账号发起切换；保险库加密存储；蓝凌适配器；状态机与错误码 |
| 阶段二 | 知道「现在在哪个系统」 | 从「按最近使用的系统」改为读取**活动标签页 URL**：origin → `urlSignatures` 最长匹配 → 歧义处理；切换目标不再靠猜 |
| 阶段三 | 不离开页面也能切 | 在已授权的 OA 页面注入悬浮球（Shadow DOM）；拖动与位置记忆；Esc/Enter；站点级关闭；流程状态直接显示在球旁 |
| 阶段四 | 新环境能自助接入 | 通用「新建向导」+ 自动识别；蓝凌厂商预设改为 `{origin}` 相对规则；自检判断预设是否过期；删除系统时处理账号引用 |
| 阶段五 | 能搬家 | 数据导出/导入：完整（含密文信封）与仅配置两种模式；合并语义；保险库三分支；原子写入 |

需求演进不是一次性设计出来的，而是每次在真实站点上撞到问题后收敛：

- 一开始以为「记住上次用的系统」就够，真实使用中发现用户在多个标签页之间跳转，**必须以当前标签页为准**，否则会在错误站点上发起切换。
- 悬浮球最初只是快捷入口，后来承担了「流程状态可见」的职责——用户不想为了看进度再打开 Popup。
- 「自动识别」最初只有蓝凌硬编码选择器，遇到用户自己建的空配置系统后，才拆成「预设 + 自检 + 配置缺失明确报错」。
- 导入导出是在用户提出「换电脑要重新配一遍」之后才立项的，因此它的第一原则是**不破坏现有数据**，而不是追求功能多。

---

## 2. 插件类型与技术栈

### 2.1 为什么是 Manifest V3

这是一个典型的「需要长期驻留、按页面注入、按需申请权限」的浏览器扩展，Manifest V3 的三个特性正好对应：

- **Service Worker 后台**：不需要常驻页面，事件驱动即可；代价是会被空闲回收（后文有专门的坑）。
- **`chrome.scripting.registerContentScripts`**：可以按 origin 动态注册内容脚本，而不是在 manifest 里写死 `content_scripts`。这对「用户自己添加任意 OA 域名」是必需的。
- **`optional_host_permissions`**：安装时不索取所有站点权限，用户添加某个 OA 时才申请该 origin。审核与信任成本都更低。

没有选 MV2：MV2 的持久后台页虽然能规避 SW 回收，但 Chrome 已停止新提交，且 MV2 的 `permissions` 模型更粗，无法做到「按 origin 动态授权」。

### 2.2 技术栈与选型理由

| 用了什么 | 为什么 |
|---|---|
| TypeScript | 消息协议、适配器配置、存储结构都是跨上下文契约；用类型把 `RequestPayloadMap` / `ResponseDataMap` 锁住，改协议时编译期就能发现漏改 |
| Vite 5（三趟构建） | UI 用 React 插件，后台/内容脚本要单文件 IIFE；同一份配置按 `mode` 分派，避免维护三套构建脚本 |
| React 18 | 只有 Popup 与 Options 两个界面，组件状态简单；React 的生态与可测试性（jsdom + Testing Library 风格断言）够用 |
| Tailwind 3 | UI 只追求一致、克制的工具型外观，不需要设计系统；原子类让 Options 的大量表单不用维护额外 CSS |
| Vitest 2 + jsdom | 与 Vite 共用转换链，单测启动快；需要 DOM 的内容脚本/悬浮球测试可直接跑在 jsdom |
| ESLint 9 + typescript-eslint | 约束 `no-unused-vars`、禁止 `any` 滥用；构建前还会跑自定义脚本检查「源码里是否出现裸选择器」 |
| 无运行时依赖（除 React） | 扩展体积与供应链风险都要小；加密、下载、存储全部用浏览器原生 API |

构建产物（当前版本 `0.1.0`）：`background.js` 约 85 KB，`content.js` 约 35 KB，发布 zip 约 119 KB。测试规模：**34 个测试文件 / 299 个用例**。

---

## 3. 目录结构

```text
src/
├── adapters/                 # 厂商适配层
│   ├── types.ts              # OaAdapter 接口、AdapterContext、超时配置
│   ├── registry.ts           # 按 vendor 创建适配器
│   ├── configValidation.ts   # adapterConfig 的形状校验
│   ├── unsupported.ts        # 未支持厂商的兜底实现
│   └── landray/
│       ├── adapter.ts        # 蓝凌登录/退出/校验的具体实现
│       ├── preset.ts         # {origin} 相对规则的厂商预设与证据
│       └── selectors.ts      # 预设字段 → 页面操作的映射
├── background/               # Service Worker
│   ├── index.ts              # 启动、安装、闹钟、自动锁定、消息入口
│   ├── router.ts             # 请求分发与用户活动标记
│   ├── contentRegistry.ts    # 权限检查 + 按 origin 动态注册 content script
│   ├── contentMessenger.ts   # 向活动标签页发 oa.* 请求、注入兜底
│   ├── keepalive.ts          # 流程期间的 SW 保活
│   ├── uiKeepAlive.ts        # Options 长连接保活端口
│   ├── discovery/            # 自动识别与自检
│   ├── flow/                 # 状态机、步骤、快照、runner
│   └── services/             # system/account/group/vault/transfer 等业务服务
├── content/                  # 内容脚本
│   ├── index.ts              # 注入入口与消息分发
│   ├── guards.ts             # 重复注入守卫
│   ├── bridge.ts             # oa.* 命令 → 适配器；runId 级取消
│   ├── pageDriver.ts         # 页面导航、等待、点击、填表等底层动作
│   ├── floatBall.ts          # 悬浮球（Shadow DOM + 拖动 + 状态）
│   └── readyReporter.ts      # 页面就绪上报
├── crypto/                   # Web Crypto 封装
│   ├── kdf.ts                # PBKDF2-HMAC-SHA256 → AES-GCM-256
│   ├── aesgcm.ts             # 加解密、AAD、随机数
│   └── vaultCrypto.ts        # 信封结构、封装/解封/重封装
├── errors/                   # 中文错误文案
├── options/                  # 设置页（系统、账号、分组、安全、数据与迁移）
├── popup/                    # 工具栏弹窗（快速切换、解锁）
├── shared/                   # 跨上下文共享
│   ├── constants.ts          # 端口名、超时、上限、默认迭代次数
│   ├── result.ts             # Result / SerializedError / detail 白名单
│   ├── systemMatch.ts        # origin + urlSignatures 识别
│   ├── transferPackage.ts    # 迁移包构建、完整性校验
│   ├── messaging/            # 协议解析、客户端、端口重连
│   └── types/                # 领域类型与消息类型
├── storage/                  # chrome.storage 封装、key、迁移、会话仓库
├── ui/                       # 通用组件与样式
scripts/                      # 构建、打包、manifest 生成与校验、fixture 服务
tests/unit/                   # 34 个测试文件，覆盖协议、加密、流程、UI 等
docs/                         # 架构、测试记录、阶段计划、本文
```

一句话职责：

- **shared**：不依赖具体运行环境（Popup / Options / SW / content 都能用），只放类型、协议、纯函数。
- **storage**：唯一允许直接拼 `storage` key 的地方；所有 key 来自 `src/storage/keys.ts`。
- **background**：权威状态所在；所有写操作、权限、保险库、流程都在这里收敛。
- **content**：只做「页面上的事」——注入、适配器调用、悬浮球；不直接读写浏览器存储。
- **adapters**：把「厂商差异」关进接口里，流程层只认 `detectLoginState / fillCredentials / verifyLogin` 等动作。
- **popup / options**：纯 UI，通过消息协议请求后台，不持有业务真相。
- **crypto**：纯函数式的加解密与信封操作，不碰存储。
- **scripts**：构建与发布；`check-manifest` 是权限红线的守门员。
- **tests**：单元测试为主，真实环境记录另见 `docs/testing.md`。

---

## 4. 核心实现逻辑

### 4.1 三趟 Vite 构建与 manifest 生成

**为什么不能一次构建。** 三类产物对模块格式的要求不同：

- Popup / Options 是普通 HTML 页面，需要 ESM + 代码分割（React、共享 chunk）。
- Service Worker 虽支持 `type: "module"`，但为了与内容脚本共用一份「无动态 import」的产物约束，这里统一打成 IIFE。
- 内容脚本**不能是 ESM**，也不能在运行时 `import()` 拆出的 chunk——`chrome.scripting` 注入的是一个普通脚本文件，没有模块加载器。

如果一次构建同时处理 UI 与 content，Rollup 会为共享模块生成 chunk，content.js 里就会出现对 chunk 的引用，注入后直接报错。因此 `vite.config.ts` 按 `mode` 分派，`scripts/build.mjs` 串行跑三趟：

```js
// scripts/build.mjs
await run('ui');
await run('background');
await run('content');
```

单文件入口的关键选项是 `inlineDynamicImports`：把所有动态 import 内联进同一个文件，保证 content/background 产物是**自包含的单文件**。

```ts
// vite.config.ts
function singleFileConfig(mode: 'background' | 'content'): UserConfig {
  return {
    ...sharedConfig(),
    build: {
      ...sharedConfig().build,
      rollupOptions: {
        input: { [mode]: path.resolve(srcRoot, mode, 'index.ts') },
        output: {
          format: 'iife',
          entryFileNames: `${mode}.js`,
          inlineDynamicImports: true,
          assetFileNames: 'assets/[name][ext]',
        },
      },
    },
  };
}
```

构建末尾还有几道硬检查：`check-no-selectors.mjs`（防止源码里出现裸选择器）、`generate-manifest.mjs`（写入版本号）、`check-manifest.mjs`（权限白名单）、以及产物存在性与「dist 中不得出现 `.ts/.tsx`」检查。

manifest 采用模板 + 脚本注入版本号，权限刻意保持最小：

- `permissions`: `storage`、`alarms`、`scripting`
- `host_permissions`: 空
- `optional_host_permissions`: `http://*/*`、`https://*/*`
- 不声明静态 `content_scripts`，全部运行时注册

`check-manifest.mjs` 会强制上述形态。这样「导出/导入」功能才不需要新增任何权限：下载用 Blob + `<a download>`，导入用 `<input type="file">`。

### 4.2 消息协议与 Result / 错误码

所有跨上下文通信都走统一信封：

```ts
// src/shared/messaging/protocol.ts（结构节选）
export interface RequestEnvelope<K extends RequestType = RequestType> {
  kind: 'req';
  id: string;
  type: K;
  payload: RequestPayloadMap[K];
  createdAt: number;
}

export interface SuccessEnvelope<T> {
  kind: 'res';
  id: string;
  ok: true;
  data: T;
  elapsedMs: number;
}

export interface FailureEnvelope {
  kind: 'res';
  id: string;
  ok: false;
  error: SerializedError;
  elapsedMs: number;
}

export type ResponseEnvelope<T = unknown> = SuccessEnvelope<T> | FailureEnvelope;
```

`parseRequest` 负责运行时校验：type 必须在白名单、必填字段必须存在、序列化后大小不能超限。上限默认 32 KB，只有数据迁移的两条消息放宽到 8 MB：

```ts
const PAYLOAD_LIMITS: Partial<Record<RequestType, number>> = {
  'data.preview': TRANSFER_MAX_CONTENT_BYTES,
  'data.import': TRANSFER_MAX_CONTENT_BYTES,
};

const limit = PAYLOAD_LIMITS[type] ?? MAX_MESSAGE_BYTES;
if (size > limit) {
  return invalid({ field: 'payload', reason: 'too-large', elapsedMs: size, limit });
}
```

错误不直接抛原始 `Error`，而是归一成 `SerializedError`。这一步很重要：跨上下文传递的 message 可能包含页面文字甚至凭证片段，所以只保留错误码、分类、可重试标记和白名单里的标量 detail。

```ts
// src/shared/result.ts
export function serializeError(error: unknown): SerializedError {
  if (!isFlowError(error)) {
    return {
      code: 'E_INTERNAL',
      category: ERROR_META.E_INTERNAL.category,
      retryable: ERROR_META.E_INTERNAL.retryable,
      detail: { reason: 'unexpected-error' },
    };
  }

  const meta = errorMeta(error.code);
  const detail: Record<string, ErrorDetailValue> = {};
  for (const [key, value] of Object.entries(error.detail ?? {})) {
    if (!ALLOWED_DETAIL_KEYS.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      detail[key] = value;
    }
  }
  // ...
}
```

错误码按领域分组（`E_VALIDATION`、`E_NO_PERMISSION`、`E_VAULT_LOCKED`、`E_FLOW_BUSY`、`E_CONTENT_UNAVAILABLE`、`E_TRANSFER_INVALID` 等），每个都有中文文案与「是否可重试」。UI 只做展示与重试决策，不猜错误含义。

### 4.3 状态机、runId 单飞与中断恢复

一次切换是一个有明确阶段的状态机：`resolving → probing → loggingOut → awaitingLogin → filling → submitting → verifying → completed / failed / cancelled`。总预算 90 秒，每一步再与总截止时间取最小值。

并发保护不是靠 UI 禁用按钮，而是在 runner 里同步占位：

```ts
// src/background/flow/runner.ts
async start(input: StartFlowInput): Promise<{ runId: RunId }> {
  // 同步占位：任何 await 之前完成，保证并发第二次调用立即得到 E_FLOW_BUSY
  if (this.active && !isTerminalFlowState(this.active.state)) {
    throw new FlowError('E_FLOW_BUSY', { accountId: input.accountId });
  }

  const now = Date.now();
  const runId = newRunId();
  this.target = null;
  this.controller = new AbortController();
  this.terminalHookRunId = null;
  this.active = {
    runId,
    state: 'idle',
    accountId: input.accountId,
    systemId: input.systemId ?? null,
    step: null,
    startedAt: now,
    updatedAt: now,
    deadlineAt: now + FLOW_TIMEOUTS.totalMs,
    error: null,
  };
  // ...
}
```

快照写入 `chrome.storage.session`，供 Popup / 悬浮球在任意时刻读取。SW 被回收后，内存中的 `runId`、`AbortController` 都没了，但快照还在。恢复逻辑选择**不续跑**：

```ts
// src/background/flow/runner.ts
// 未完成的流程在 SW 重启后不允许续跑：状态不明的半途操作必须由用户重新发起
const now = Date.now();
this.active = {
  ...stored,
  state: 'failed',
  step: null,
  updatedAt: now,
  error: serializeError(new FlowError('E_INTERRUPTED', { reason: 'service-worker-restart' })),
};
await snapshotStore.set(this.active);
```

这是刻意的保守策略：如果 SW 在「已提交、等落地页」时被回收，续跑可能重复提交或误判成功；标记为 `E_INTERRUPTED` 并让用户重试，语义更清楚。

### 4.4 保险库：PBKDF2 600k + AES-GCM

保险库只有一个信封，里面是全部账号密码的映射。信封本身不加密地存在 `chrome.storage.local`，但内容是 AES-GCM 密文：

```ts
// src/crypto/vaultCrypto.ts
export interface VaultEnvelope {
  schemaVersion: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; saltB64: string };
  cipher: { name: 'AES-GCM'; ivB64: string };
  aad: string;
  ciphertextB64: string;
  createdAt: string;
  updatedAt: string;
}
```

KDF 参数：PBKDF2-HMAC-SHA256，默认 **600,000** 次，最低 100,000 次；salt 16 字节；AES-GCM 256 位，IV 12 字节。派生出的 `CryptoKey` 设置为**不可导出**，只允许 encrypt/decrypt：

```ts
// src/crypto/kdf.ts
/**
 * PBKDF2-HMAC-SHA256 → AES-GCM-256。
 * 返回的 CryptoKey 不可导出，且只允许 encrypt/decrypt。
 */
export async function deriveVaultKey(
  password: string,
  salt: Uint8Array,
  iterations: number = DEFAULT_MASTER_KEY_ITERATIONS,
): Promise<CryptoKey> {
  // ...
}
```

AAD 固定为 `oa-switcher.vault.v1`，把密文绑定到格式版本，阻止跨版本移植。每次写入都整库重加密并换新 IV，明文用完立刻清零：

```ts
// src/crypto/vaultCrypto.ts
/** 新 IV 重新加密整库，保留原 salt/iterations 与 createdAt。 */
export async function resealWithKey(
  envelope: VaultEnvelope,
  key: CryptoKey,
  plaintext: VaultPlaintext,
): Promise<VaultEnvelope> {
  const iv = newIv();
  const plaintextBytes = encodePlaintext(plaintext);
  try {
    const ciphertext = await encryptBytes(key, iv, plaintextBytes, VAULT_AAD);
    return {
      ...envelope,
      cipher: { name: 'AES-GCM', ivB64: bytesToBase64(iv) },
      aad: VAULT_AAD,
      ciphertextB64: bytesToBase64(ciphertext),
      updatedAt: new Date().toISOString(),
    };
  } finally {
    plaintextBytes.fill(0);
  }
}
```

**懒解锁**：SW 启动时只读信封判断状态（`uninitialized / locked / unlocked`），不派生 key；用户真正要读写密码时才解锁。解锁后的 key 只在 SW 内存里存活，`resetRuntime()` 会同时丢掉 key、状态和已加载标记——导入替换信封后正是靠它强制重新解锁。

### 4.5 权限模型：可选 host 权限 + 动态注册

用户添加一个 OA 域名后，扩展才对该 origin 发起 `chrome.permissions.request`。授权结果不能只看「脚本注册成功」，因为脚本注册成功并不代表拥有注入权限：

```ts
// src/background/contentRegistry.ts
const patterns = [`${origin}/*`];

// 授权结果必须以 permissions.contains 为准，注册成功不代表能注入
let granted = false;
try {
  granted = await chrome.permissions.contains({ origins: patterns });
} catch {
  log.warn('content-script-permission-check-failed', { origin });
}

if (!granted) {
  originState.set(origin, 'denied');
  continue;
}

try {
  await chrome.scripting.registerContentScripts([
    {
      id: scriptIdForOrigin(origin),
      matches: patterns,
      js: ['content.js'],
      runAt: 'document_idle',
      allFrames: false,
      persistAcrossSessions: true,
    },
  ]);
  originState.set(origin, 'granted');
} catch {
  log.warn('content-script-register-failed', { origin });
  originState.set(origin, 'denied');
}
```

同域多系统只注册一次脚本：先按 origin 聚合，再注册一个 `oa-switcher:<origin-hash>` id。系统级 `permissionState` 由该系统的所有 origin 状态派生（全 granted 才 granted，全 denied 才 denied，否则 unknown）。

reconcile 可能被多个事件并发触发（`permissions.onAdded`、`permission.ensure`、SW 初始化），而「先注销再注册」如果交错执行，会命中 `Duplicate script ID`，被 catch 误判为未授权。所以用一条串行队列：

```ts
// src/background/contentRegistry.ts
let reconcileQueue: Promise<void> = Promise.resolve();

export async function reconcileContentScripts(): Promise<void> {
  const next = reconcileQueue.then(runReconcile, runReconcile);
  // 队列自身永远不保留拒绝状态，避免一次失败卡死后续触发
  reconcileQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
```

### 4.6 Content Script：注入守卫、bridge 与取消

内容脚本入口负责四件事：注入守卫、注册消息处理、上报就绪、在顶层 frame 按需挂载悬浮球。重复注入时靠全局标记直接返回，不重复挂监听：

```ts
// src/content/index.ts
function install(): void {
  chrome.runtime.onMessage.addListener(
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (sender.id !== chrome.runtime.id) return false;
      void handleContentRequest(message, sender, isTopFrame())
        .then((response) => {
          sendResponse(response);
        })
        .catch((error: unknown) => {
          log.error('content-dispatch-failed', error);
        });
      return true;
    },
  );
  // ...
}
```

`bridge.ts` 把 `oa.*` 命令映射到适配器方法，并按 `runId` 记录正在执行的命令。取消时先 `abort()`，等当前动作真正停下，再调用适配器的 `clearCredentials` 清理表单，避免「清理跑在填写前面」：

```ts
// src/content/bridge.ts
async function cancelAndCleanup(payload: OaRequestBase): Promise<{ cancelled: true }> {
  cancelledRunId = payload.runId;

  const active = activeCommands.get(payload.runId);
  if (active) {
    active.controller.abort();
    // 等中断真正生效后再清理，避免清理跑在填写前面
    await active.done.catch(() => undefined);
  }

  try {
    const { adapter, context } = createOaContext(payload, {});
    await adapter.clearCredentials?.(context);
  } catch {
    log.warn('content-cancel-cleanup-failed', { runId: payload.runId });
  }

  return { cancelled: true };
}
```

页面动作全部通过 `AdapterContext.driver` 执行，driver 内部每一步都检查 `signal.aborted` 并抛 `E_CANCELLED`，所以取消能穿透等待、点击、导航等长动作。

### 4.7 适配器、厂商预设与系统识别

适配器接口把「厂商差异」收敛成固定动作：检测登录页、检测登录态、检测阻塞（验证码/公告）、退出、填账号密码、提交、验证成功。流程层只调用这些方法，不关心蓝凌还是别的厂商。

```ts
// src/adapters/types.ts
export interface OaAdapter {
  readonly vendor: OaVendor;
  readonly capabilities: AdapterCapabilities;

  validateConfig(config: unknown): AdapterConfigValidation;
  detectLoginPage(context: AdapterContext): Promise<LoginPageReport>;
  detectLoginState(context: AdapterContext): Promise<LoginStateReport>;
  detectBlockers(context: AdapterContext): Promise<BlockerReport>;
  logout(context: AdapterContext): Promise<void>;
  waitForLoginPage(context: AdapterContext): Promise<void>;
  fillCredentials(context: AdapterContext, credential: CredentialInput): Promise<void>;
  submitLogin(context: AdapterContext): Promise<void>;
  verifyLogin(context: AdapterContext, options: { deadlineAt: number }): Promise<LoginVerification>;
  /** 取消后的清理：只清空已填写字段，不触发提交；未配置字段时跳过。 */
  clearCredentials?(context: AdapterContext): Promise<void>;
}
```

接口约定「只能通过 `PageDriver` 访问页面」，适配器不得读写存储、不得发消息、不知道账号库存在，这让它可以在 jsdom 单测里用假 driver 完整跑通。

蓝凌预设的硬约束是**只写相对规则**：所有 URL 都用 `{origin}` 占位，避免把某个客户的内网地址写死进代码；同一条规则必须在两个真实环境都命中才收录：

```ts
// src/adapters/landray/preset.ts
export const LANDRAY_PRESET_TEMPLATE: Record<DiscoveryFieldKey, string> = {
  loginPageUrlPattern: '{origin}/login.jsp*',
  loginFormReadySelector: 'form[action="/j_acegi_security_check"]',
  usernameFieldSelector: 'input[name="j_username"]',
  passwordFieldSelector: 'input[name="j_password"]',
  submitKind: 'click',
  submitSelector: 'input[name="btn_submit"]',
  loggedOutMarkerSelector: 'input[name="j_username"]',
  loggedInMarkerSelector: 'div.lui_single_menu_header_logout .lui_dropdown_toggle',
  authenticatedUrlPattern: '{origin}/sys/*',
  loginFailureMarkerSelector: '.lui_login_message_div.tip_message',
  logoutKind: 'click',
  logoutUrl: '',
  logoutSelector: 'div.lui_single_menu_header_logout .lui_dropdown_toggle',
  logoutConfirmSelector: 'div.lui_dialog_main .lui_widget_btn.lui_toolbar_btn_def',
  loggedOutUrlPattern: '{origin}/login.jsp*',
  urlSignatures: '{origin}/sys/*',
};
```

预设带上 `preset.id/version`，自检（selfCheck）会在当前登录态下检查「该状态必然存在」的字段；未命中就标记 `stale`，提示用户预设可能过期，而不是静默失败。

系统识别按「origin → 签名最长匹配 → 歧义处理」：

```ts
// src/shared/systemMatch.ts
const matched = originSystems.filter((candidate) => candidate.matchedPattern !== null);
if (matched.length === 0) {
  return { ...empty, origin, rememberKey, status: 'ambiguous', candidates: originSystems, originSystems };
}

const bestScore = Math.max(...matched.map((candidate) => candidate.score));
const top = matched.filter((candidate) => candidate.score === bestScore);

const winner = top.length === 1 ? top[0] : undefined;
if (winner) {
  return {
    ...empty,
    origin,
    rememberKey,
    status: 'matched',
    systemId: winner.systemId,
    basis: { kind: 'signature', pattern: winner.matchedPattern ?? undefined },
    candidates: top,
    originSystems,
  };
}
// 签名打平：再尝试 rememberedSystems，仍无法区分才返回 ambiguous
```

同域多系统且签名打平时，先看用户是否「记住过本次选择」；仍然无法区分就返回 `ambiguous`，UI 让用户选，并把选择结果记到 `rememberedSystems`。

### 4.8 悬浮球

悬浮球只在「当前页面确实属于已配置且启用的系统」时挂载，任何条件不满足都直接返回，不在页面上留下空容器：

```ts
// src/content/floatBall.ts
export async function mountFloatingBall(): Promise<void> {
  if (document.getElementById(HOST_ID)) return;

  const origin = location.origin;
  let prefs;
  try {
    prefs = await callBackground('ui.getFloatPrefs', {});
  } catch {
    return;
  }
  if (!prefs.enabled) return;
  if (prefs.dismissed[origin]) return;

  let system: OASystem | null = null;
  try {
    const resolution = await callBackground('system.resolveForUrl', { url: location.href });
    if (resolution.status !== 'matched' || !resolution.systemId) return;
    // ...
  } catch {
    return;
  }
  if (!system || !system.enabled) return;
  // 脚本能运行说明通常已授权；这里只排除明确记录的 denied，避免旧数据误判
  if (system.originPermissions?.[origin] === 'denied') return;
  // ...
}
```

宿主是固定 `position: fixed` 的容器，内部用 Shadow DOM 隔离页面样式。拖动用 Pointer Events，超过阈值才算拖动（否则当点击）；松手后把视口坐标写入 `float.positions[origin]`：

```ts
const endDrag = async (event: PointerEvent) => {
  if (!dragging || event.pointerId !== dragging.pointerId) return;
  const moved = dragging.moved;
  dragging = null;
  if (ball.hasPointerCapture(event.pointerId)) ball.releasePointerCapture(event.pointerId);
  if (!moved) return;

  // 拖动结束会紧跟一次 click，先标记抑制，避免误触打开面板
  suppressClick = true;
  setTimeout(() => {
    suppressClick = false;
  }, 0);
  if (open) positionPanel();
  try {
    await callBackground('ui.saveFloatPosition', { origin, point });
  } catch (error) {
    log.error('float-ball-position-save-failed', error);
  }
};

ball.addEventListener('pointerup', (event) => void endDrag(event));
ball.addEventListener('pointercancel', (event) => void endDrag(event));
```

键盘行为只做对话框语义：面板打开时 Esc 收起并回焦到球；Enter/空格切换面板。其余按键一律放行，不劫持页面快捷键：

```ts
const onKeyDown = (event: KeyboardEvent) => {
  // 面板打开期间才拦截 Esc（对话框语义）；其余按键一律放行，不劫持页面快捷键
  if (event.key !== 'Escape' || !open) return;
  event.preventDefault();
  event.stopPropagation();
  setOpen(false);
  ball.focus();
};

ball.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    setOpen(!open);
  }
});
```

站点级关闭写 `float.dismissed[origin]`，全局开关写 `float.enabled`；设置页可恢复显示。

### 4.9 导入导出

迁移包是单个 JSON，构建时对每段做条目数 + SHA-256，再对「版本 + 模式 + 段摘要」做整体 digest：

```ts
// src/shared/transferPackage.ts
async function hashSection(section: TransferSection, value: unknown): Promise<TransferSectionIntegrity> {
  return {
    count: sectionCount(section, value),
    hash: await sha256Hex(stableStringify(value ?? null)),
  };
}

const sections = {} as TransferIntegrity['sections'];
for (const section of TRANSFER_SECTIONS) {
  sections[section] = await hashSection(section, payloads[section]);
}
const digest = await sha256Hex(
  stableStringify({ version: TRANSFER_VERSION, mode: input.mode, sections }),
);
```

`stableStringify` 递归排序对象键，保证同一份数据在不同浏览器里 hash 一致。导入校验顺序是：格式 → 版本 → 段结构 → 每段 count/hash → 整体 digest；任何一步失败都在写存储之前抛出。

合并语义全部在内存计划里完成。`settings` 与悬浮球偏好采用**本机优先**：只补本机缺失字段；`activeSystemId` 与 `rememberedSystems` 按导入后的实际数据重算。同 ID 冲突时，用户可选覆盖或保留双方；保留双方会生成新 ID、重映射引用，并在预览里显示「将重命名为 X（导入）」。

保险库分支单独收敛成一个函数，且不直接落盘，只返回要写的信封：

```ts
// src/background/services/transferImport.ts
if (mode === 'auto') {
  if (state !== 'uninitialized') {
    return { vault: undefined, action: 'skipped', credentialsImported: false };
  }
  return { vault: envelope, action: 'adopted', credentialsImported: true };
}

if (mode === 'adopt') {
  if (state !== 'uninitialized') throw new FlowError('E_VALIDATION', { field: 'vault' });
  return { vault: envelope, action: 'adopted', credentialsImported: true };
}

if (mode === 'merge') {
  if (state === 'uninitialized') throw new FlowError('E_VAULT_NOT_INITIALIZED');
  if (!sourceMasterPassword) {
    throw new FlowError('E_VALIDATION', { field: 'sourceMasterPassword' });
  }
  const merged = await vaultService.prepareMergedEnvelope(
    envelope,
    sourceMasterPassword,
    accountIdMap,
  );
  return { vault: merged, action: 'merged', credentialsImported: true };
}
```

最后一次性写入全部 key；失败则什么也不写：

```ts
// src/background/services/transferImport.ts
const vaultResult = await resolveVaultWrite({ /* ... */ });

// 数据走与正常读写相同的 schema 校验/迁移路径；失败时不写业务数据。
await ensureSchema();

await writeTransferSnapshot({
  systems: plan.systems,
  accounts: plan.accounts,
  groups: plan.groups,
  settings: plan.settings,
  float: plan.float,
  vault: vaultResult.vault,
});
```

信封变化后会 `vaultService.resetRuntime()` 并广播状态，强制用户用对应的主密码重新解锁；content script 重注册失败只记 warning，不回滚已导入的数据。

---

## 5. 报错、坑点与解决方案

这一章按「症状 → 根因 → 修复 → 证据」记录真实踩过的坑。所有证据都来自当时的快照、`chrome.storage.session`、CDP 探针或单测，而不是事后推测。

### 5.1 Chrome 原生权限弹窗无法自动化点击

**症状**：自动化脚本点击「授权域名」后，长时间轮询不到 `granted`，看起来像 `chrome.permissions.request` 没有触发。

**根因**：不是手势失效，而是**点击没有落到扩展页面上**。页面探针记录 `clicks=[]`，说明 CDP 发出的点击跑到了别的标签页/窗口；而权限请求必须由扩展页面上的真实用户手势触发。

**修复**：验证流程改为「页面探针确认点击落点 → 再等待授权结果」；自动化只负责把页面置前，原生弹窗交给用户点「允许」。后续真实授权时，探针记录到 `trusted=true` 的点击，2.1 秒后返回 `granted=true`。

**证据**：授权前 `permissions.contains=false`、`getRegisteredContentScripts()` 为空；授权后 `contains=true`、origins 含目标 origin、动态注册 id 出现；`content.ping` 返回 `ready:true`。这组记录在 [testing.md](./testing.md) 第 7 节。

### 5.2 `permissions.contains` 与 `registerContentScripts` 的误判

**症状**：脚本注册表里有项，但页面完全不注入；或反过来，权限被用户撤销后系统仍显示「已授权」。

**根因**：把「注册成功」当成「有权限」。动态注册只是一条声明，真正的注入权限由 `permissions.contains` 决定；反过来，权限被撤销后旧注册项可能还在。

**修复**：reconcile 时先查 `contains`，未授权直接跳过注册并把 origin 标为 `denied`；系统级 `permissionState` 由 origin 状态派生，而不是由注册结果推断。

**证据**：未授权时 `contains=false`、注册表为空、`permission.ensure` 返回 `E_NO_PERMISSION`；授权后同一套检查全部翻转。单测覆盖「注册成功但 contains=false」与「contains=true 但注册失败」两条路径。

### 5.3 并发 reconcile 触发 `Duplicate script ID`

**症状**：三个并发的 `permission.ensure` 中有一个返回 `E_INTERNAL`；随后存储被写成 `denied`，但 `contains=true` 且注册项仍在，Options 卡片显示「权限：未授权」。

**根因**：`permissions.onAdded`、`permission.ensure`、SW 初始化可能同时触发 reconcile；「注销全部 → 再注册」交错执行时，后一次 register 命中重复 id，被 catch 当成未授权写回存储。

**修复**：reconcile 串行化（`reconcileQueue`），队列自身吞掉拒绝状态，避免一次失败卡死后续触发。

**证据**：修复前 3 并发有 1 个 `E_INTERNAL` 且状态被写坏；修复后 3 并发全部 `ok`、`permissionState=granted`、注册项唯一；`contentRegistry.test.ts` 覆盖重复注册场景。

### 5.4 SW 空闲回收导致 CryptoKey 丢失

**症状**：新建保险库后，在账号表单里填写稍久再保存，报「保险库已锁定」。

**根因**：MV3 的 Service Worker 空闲约 30 秒会被终止；保险库的 `CryptoKey` 只在 SW 内存里，SW 一死就没了。表单填写期间没有消息往来，正好触发回收。

**修复**：Options 页在配置期间建立长连接保活端口，每 20 秒发一次心跳；端口消息不计入用户活动，因此不影响自动锁定计时。Popup 侧则在端口断开后自动重连并重拉状态。

**证据**：`uiKeepAlive.test.ts` 验证心跳与断线重连；真实环境里长时间停留表单后保存不再报锁定；自动锁定仍按设置时间生效（`ui.*` 心跳不会刷新 `lastActivity`）。

### 5.5 Popup 显示陈旧的保险库状态

**症状**：在 Options 里锁定保险库后，Popup 仍显示「已解锁」；SW 被强杀后打开 Popup，状态也不刷新。

**根因**：Popup 只在首次挂载时拉一次状态，之后既没有广播，也没有在重新可见时刷新；SW 重启后端口断开，UI 没有重连。

**修复**：三管齐下：`useBootstrap` 在挂载、`focus`、`visibilitychange` 时重拉；`useFlowPort` 在端口断开/重连时重拉；后台 `notifyVaultState` 通过端口广播 `vault.state`。

**证据**：从 Options 触发锁定后，Popup 请求数从 4 增到 5，说明广播确实驱动了重拉；SW 强杀后打开 Popup，共发出 4 次后台请求，UI 保持正确状态且无控制台错误。`uiPort.test.ts` 6 例 + `popupVaultSync.test.tsx` 3 例覆盖。

### 5.6 页面跳转导致 content 响应丢失

**症状**：切换过程中偶发 `E_CONTENT_UNAVAILABLE`，提示「页面可能正在跳转」，但页面其实已经正常。

**根因**：提交登录后页面开始导航，此时发给旧页面的消息随上下文销毁而丢失，`send-failed` 被归一成 `E_CONTENT_UNAVAILABLE`；如果立即判定失败，就会把正常导航误判成故障。

**修复**：对读类、无副作用的命令做「导航容忍重试」：只有 `E_CONTENT_UNAVAILABLE` 才重试，间隔 200ms，直到流程截止时间；超时后再抛业务超时错误。写类命令（提交）不重试，避免重复提交。

**证据**：`steps.ts` 中 `retryOnContentUnavailable`；`flowSteps.test.ts` 覆盖「前两次 send-failed、第三次成功」与「截止时间耗尽后抛超时」。

### 5.7 提交选择器非法导致 14ms 失败，错误码还被改写

**症状**：切换在 14ms 内失败，面板显示「提交登录失败（E_SUBMIT_FAILED）」，但用户名密码都已填写。

**根因**：存储里的 `submitTrigger.selector` 被写成 `click/input[name="btn_submit"]`——这不是合法 CSS。`waitFor` 里 `document.querySelector` 抛 `DOMException`，本应是 `E_CONFIG_MISSING(reason=invalid-selector)`；但 `submitLogin` 的兜底 catch 把所有错误统一改写成 `E_SUBMIT_FAILED`，真实原因被掩盖。14ms 正是「第一次查询就抛错」的特征，与按钮 0×0 无关。

**修复**：`submitLogin` 保留 `E_CONFIG_MISSING` / `E_CANCELLED` 原样上抛，其余错误才转为 `E_SUBMIT_FAILED` 并附 `reason`；UI 的配置编辑器也修正为拆分 `kind` 与 `selector`。

**证据**：只读检查用户存储得到上述 selector 原文；真实按钮存在且 `type=submit`、`form.requestSubmit` 可用；修复后单测新增「非法选择器保留 E_CONFIG_MISSING」，超时用例断言 `reason=E_TIMEOUT`。详见 [testing.md](./testing.md) 第 10 节。

### 5.8 系统配置为空时 probe 白等 5 秒

**症状**：用户自己添加的系统切换失败，报「无法判断当前登录状态（E_STATE_UNKNOWN）」，耗时约 5.1 秒。

**根因**：该系统 `adapterConfig` 全空（新建入口刻意不写任何蓝凌键位）。`detectLoginState` 在没有任何判定信号时仍空转满 5 秒探测窗口，最后返回 `unknown`，runner 映射为 `E_STATE_UNKNOWN`，把真正的「配置缺失」掩盖了。

**证据链**：5127ms ≈ `stateProbeMs` 5000ms + 请求开销；`E_STATE_UNKNOWN` 只由 probe 返回 `unknown` 触发；只读存储确认 `adapterConfig={}`、`urlSignatures=[]`；真实登录页与已登录页的 DOM 都正常，排除页面/网络问题。

**修复**：当 `loggedInMarkerSelector` / `loggedOutMarkerSelector` / `loginPageUrlPattern` 全空时，`detectLoginState` 立即抛 `E_CONFIG_MISSING` 并列出缺失字段；新建系统后的提示改为「请补齐适配配置，否则切换会提示配置缺失」。

**证据**：`landrayAdapter.test.ts` 新增「无判定信号立即失败且不消耗探测窗口」，保留「有配置但无证据 → unknown」。

### 5.9 删除系统「点了没反应」

**症状**：系统有 2 个账号引用，点删除并确认后，弹窗关闭、卡片仍在；页面底部（不在视口内）出现「请求参数不合法（E_VALIDATION）」。

**根因**：服务层在有账号引用时抛通用 `E_VALIDATION`；UI 把删除失败写进新建区域的 `message` 状态，列表卡片处没有任何反馈，错误又渲染在视口外，等价于静默失败。

**修复**：新增 `E_SYSTEM_IN_USE`，detail 带 `systemId` 与 `accountCount`；`deleteSystem(id, { deleteAccounts })` 默认拒绝并返回账号数，选择连带删除时在同一 `storage.set` 中原子删除系统与账号；UI 在卡片内显示结果，并弹「无法删除：仍有 N 个账号引用 / 同时删除 N 个账号」。

**证据**：真实 UI 复现后修复，卡片内出现拒绝原因与数量；`systemDelete.test.ts` 5 例覆盖拒绝、连带删除、权限撤销失败、共享 origin 不误撤权限。详见 [testing.md](./testing.md) 第 12.1 节。

### 5.10 `ui.*` 请求类型漏加白名单，悬浮球完全不渲染

**症状**：悬浮球在真实 OA 页面完全不出现，控制台没有明显报错。

**根因**：悬浮球通过 `ui.getFloatPrefs` / `ui.dismissFloat` / `ui.saveFloatPosition` 与后台通信，但这些类型没有加进 `REQUEST_TYPES`；协议层直接以 `unknown-type` 拒绝，`mountFloatingBall` 的 catch 又静默返回，所以表现为「什么都不发生」。

**修复**：补齐三个类型与 payload 映射；回归测试 C5 专门断言这三个请求在白名单内。

**证据**：`protocol.test.ts` 的「C5 悬浮球 ui.* 请求类型在白名单内（回归：unknown-type）」；真实环境补白名单后悬浮球正常渲染。

### 5.11 浏览器重启后扩展未加载、扩展页 `ERR_BLOCKED_BY_CLIENT`、CDP 端口消失

**症状**：自动化中途重启 Chrome 后，`curl 127.0.0.1:<port>/json/list` 连接被拒；`chrome-extension://.../options/index.html` 打开报 `ERR_BLOCKED_BY_CLIENT`；扩展像是消失了。

**根因**：命令行 `--load-extension` 加载的未打包扩展，在 Chrome 重启或 `runtime.reload()` 后可能被判定为「不支持的开发者扩展」而禁用；同时旧的 CDP 端口随进程退出而消失。

**修复/绕行**：用固定 profile 重新启动 Chrome，保持 `--load-extension=dist`；若被禁用，通过 `chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })` 恢复后再 reload。CDP 侧每次操作前重新读取 `/json/version` 与 `/json/list`，不缓存端口。

**证据**：当时 `/json/version` 连接拒绝、`chrome://extensions` 显示扩展被停用；恢复后同一扩展 ID、已授权 origin 均未丢失。该经验也写进了真实环境流程。

### 5.12 macOS 辅助功能权限导致 osascript 被拒

**症状**：用 AppleScript 操作 Finder/窗口时失败，报 `-1743`，提示「未获得授权将 Apple 事件发送给 Finder」。

**根因**：macOS 的自动化权限（辅助功能/自动化）没有授予当前终端或 IDE；这不是脚本写错，而是系统级拒绝。

**修复/绕行**：涉及界面自动化的步骤改为人工操作或改用 CDP；文件清理改用 shell 命令，不再经由 Finder 的 AppleEvent。需要长期自动化时，在「系统设置 → 隐私与安全性 → 辅助功能/自动化」里显式授权。

**证据**：本次清理测试文件时 `DeleteFile` 正是返回该错误，改用 `rm` 后成功；说明是权限问题而非文件问题。

---

## 6. 当前功能与使用方式

### 6.1 功能清单（用户视角）

- **系统管理**：添加任意 OA（HTTP/HTTPS origin），选择厂商（当前内置蓝凌），自动识别或手动补齐适配配置。
- **账号管理**：一个系统下多账号，支持分组、启用/禁用、备注；账号密码存入保险库。
- **保险库**：主密码初始化、解锁/锁定、自动锁定、修改主密码；密码只在解锁后的 SW 内存中短暂存在。
- **切换**：Popup 或页面悬浮球选择账号，一键退出并登录；显示每一步状态与耗时；失败可重试/取消。
- **悬浮球**：只在已配置系统的页面出现；拖动记忆位置；Esc/Enter；站点级关闭与全局开关。
- **自检**：检查当前页面登录态、选择器命中情况、预设是否过期。
- **数据迁移**：完整/仅配置导出，导入前预览新增/覆盖/重命名与保险库处理方式。

### 6.2 从零开始

1. `npm install && npm run build`，得到 `dist/`。
2. Chrome 打开 `chrome://extensions`，开启「开发者模式」，选择「加载已解压的扩展程序」→ `dist/`（或 `release/oa-switcher-0.1.0`）。
3. 打开 Options（扩展详情 → 扩展程序选项），在「系统」里添加 OA：填名称与 origin，选择「蓝凌」，点「自动识别」；识别不全的字段按提示补齐并保存。
4. 点「授权域名」，在 Chrome 原生弹窗里点「允许」；刷新 OA 页面。
5. 在「安全与设置」里设置主密码（至少 8 位），完成解锁。
6. 在系统卡片下新建账号，填写标签、用户名、密码；保存时要求保险库处于解锁状态。
7. 打开 OA 页面，点悬浮球或工具栏图标，选择账号 → 「切换账号」。
8. 首次使用建议点一次「自检」，确认登录页/已登录标记都能命中。

### 6.3 日常流程

- 平时保持保险库锁定；需要切换时在 Popup 解锁（或依赖「切换时提示解锁」）。
- 在任意已配置的 OA 页面，悬浮球会显示当前系统的账号列表；选一个点切换。
- 切换完成后看面板的「切换成功 · 耗时 xxx ms」和落点 URL；失败时按错误码处理（权限、配置、页面三类）。
- 换电脑时：旧机导出「完整」包 → 新机安装扩展 → 导入 → 用旧机主密码解锁。

### 6.4 常见问题自查顺序

1. **悬浮球不出现**：页面 origin 是否已配置并授权？`float.enabled` 是否关闭？该站点是否被「×」关闭？当前 URL 是否命中 `urlSignatures`？
2. **点了切换没反应/立刻失败**：看面板错误码。`E_NO_PERMISSION` → 重新授权；`E_CONFIG_MISSING` → 补配置；`E_VAULT_LOCKED` → 解锁；`E_FLOW_BUSY` → 等上一次结束。
3. **提交登录失败**：先查 `submitTrigger` 是否合法（`kind` 与 `selector` 分开），再看是否命中失败标记。
4. **导入失败**：看提示的段名与原因；版本过高需要升级扩展；超过 8MB 会提示实际大小与上限。导入失败不会改动现有数据。
5. **Popup 状态不对**：关闭重开；仍不对就重新加载扩展（SW 会重建）。

---

## 7. 待优化与待扩展

| 方向 | 为什么现在还缺 | 大致怎么做 |
|---|---|---|
| SSO / 验证码 / MFA 站点 | 当前适配器只覆盖「用户名+密码+提交」；SSO 跳转、图形验证码、短信/OTP 都需要人工介入 | 在 `detectBlockers` 里识别验证码/OTP 页面，流程停在 `awaitingUser` 状态并把页面交还用户；SSO 则按跳转链匹配多个 origin |
| 真实「当前登录账号」识别 | 目前只识别「系统」，不知道当前登录的是哪个账号；切换后靠页面名称人工确认 | 适配器增加 `detectCurrentAccount`，从门户用户菜单/接口读取标识，与账号列表比对；无法读取时明确显示「未知」 |
| iframe 登录 | 部分 OA 把登录表单放在 iframe 里，content script 默认 `allFrames: false` | 对登录页按需注册 `allFrames: true`，bridge 增加 frame 路由；驱动层支持在指定 frame 内查询 |
| 其它 OA 厂商（泛微、致远、华天等） | 目前只有蓝凌预设，接口已抽象但缺实现与真实环境验证 | 按 `OaAdapter` 实现新适配器；预设沿用 `{origin}` 相对规则，两个真实环境交叉验证后才收录 |
| SPA 内部路由变化 | 悬浮球只在页面加载时判定一次；SPA 的 `pushState` 不触发内容脚本重跑 | 监听 `popstate` / 劫持 `history.pushState`，节流后重新 `system.resolveForUrl`，必要时卸载/重挂悬浮球 |
| 同域多系统权限粒度 | 权限按 origin 授予，同域多系统共享一份授权，无法单独撤销某一个系统 | 权限层保持按 origin，但 UI 明确提示「同域共享授权」；撤销时检查是否还有其它系统引用该 origin |
| Edge / Firefox 兼容 | 只在 Chrome/Chromium 验证；Firefox 的 MV3 与 `scripting` 行为有差异 | 先做 Edge（Chromium 基本可直接用）；Firefox 需要单独的 manifest 与权限适配层，并补真实环境测试 |
| 审计日志 | 存储层预留了 `audit` key，但当前没有写入与查看界面 | 在切换/导入导出等关键动作写结构化事件（不含密码），Options 增加只读列表与导出 |
| CI 与发布流程 | 目前靠本地 `npm run package` + 人工真实环境验证 | 加 GitHub Actions：typecheck/lint/test/build/check:manifest；产物签名与版本号自动写入；真实环境冒烟单独跑 |
| 主密码找回/轮换体验 | 忘记主密码等于丢失凭证；改密目前需要先解锁 | 明确「无法找回」的安全文案；提供「导出仅配置 → 重置保险库 → 重新录密码」的引导流程，避免用户误以为能找回 |

---

## 附：数字与验证口径

- 单测：**34 个文件 / 299 个用例**，`npx vitest run` 全部通过。
- 构建：`background.js` 约 85 KB，`content.js` 约 35 KB，发布 zip 约 119 KB。
- 真实导出：完整包 7,325 B，仅配置包 6,626 B（差 699 B）。
- 真实切换（导入后）：登录页 → 门户 517 ms；已登录 → 退出重登 883 ms；两次 `state=completed`、`error=null`。
- 真实/单测/未验证的划分见 [testing.md](./testing.md) 第 13.3 节。
