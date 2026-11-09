---
title: 把切换做成一件可控的小事：OA Switcher 开发记录
date: 2026-11-06
tags: [Chrome Extension, Manifest V3, TypeScript, Vite, Web Crypto]
summary: 一个多 OA 账号切换扩展的开发过程：为什么先立边界、怎么做 Vite 三趟构建、为什么密码只以整库密文存在 Service Worker 内存里，以及阶段三为什么宁可把选择器留空。
---

## 起点：一个很小、但很容易做坏的需求

我每天要在不止一个 OA 账号之间切换。流程本身不复杂：退出当前账号，打开登录页，输入另一个账号和密码。但它重复、琐碎，而且很容易点错。

把这件事交给浏览器扩展，看起来是最自然的方案。真正开始写之后才发现，难点不在“点几个按钮”，而在边界：扩展能拿到多少权限、密码以什么形态存在、页面逻辑和账号逻辑怎么隔离、在没有真实页面信息时怎么避免瞎猜。

这篇记录按实际开发顺序写：先说我给自己定的几条线，再讲架构和构建，然后分别是已经落地的阶段一、正在进行的阶段二、刚刚进入实现但还没有真实页面验证的阶段三，最后是验证结果和当前状态。

---

## 先划边界：四条不愿意妥协的线

在写第一行代码之前，我先在 `docs/architecture.md` 里把几条边界固定下来。它们后来几乎决定了所有实现细节。

**第一，不申请全站权限。** `manifest.json` 里的 `host_permissions` 是空数组，`content_scripts` 也是空数组。manifest 里声明的是 `optional_host_permissions` 通配模式，真正的授权发生在 Options 页的用户手势里：`chrome.permissions.request({ origins })` 请求的是具体 OA 的 origin，而不是“所有网站”。扩展只在你配置过、并手动授权过的域名上注入页面脚本。

**第二，密码不以明文落盘。** 账号的展示名、用户名、分组、备注属于元数据，可以明文存在 `chrome.storage.local`；密码单独进入加密保险库，整个保险库只有一份密文。元数据和密文分离，改账号资料不需要碰密文。

**第三，Background 不碰 DOM。** Service Worker 只做消息路由、流程编排、存储和加解密，不查询页面元素，也不 `fetch` OA 页面。页面交互全部放在 Content Script 里。

**第四，没拿到真实页面信息之前，不写选择器。** 蓝凌 OA 的登录框长什么样、退出按钮在哪、登录成功的判定依据是什么，这些都不能靠猜。适配器只定义配置键位，值留空；缺项就返回 `E_CONFIG_MISSING`，而不是拿一个看起来像的选择器碰运气。

这四条线听起来像“原则”，但在这个项目里都有对应的代码或脚本去强制，后面会具体说。

---

## 架构：让每个运行上下文只做一件事

Chrome 扩展有多个互不相通的运行上下文，它们的生命周期和能力完全不同。与其把它们当成一个应用，不如当成几个小进程来设计。

| 上下文 | 生命周期 | 职责 | 明确不做 |
|---|---|---|---|
| Popup / Options | 打开即建，关闭即销毁 | React UI、发起消息、短暂持有主密码输入 | 不直接访问 OA 页面，不持有派生密钥，不读写密文 |
| Background（Service Worker） | 事件驱动，空闲可被回收 | 消息路由、流程状态机、存储、加解密、动态注册脚本、权限检查 | 不访问 DOM，不 `fetch` OA 页面 |
| Content Script | 每个匹配页面一份，随页面销毁 | 执行页面查询、填写、点击、等待 | 不读写 `chrome.storage`，不做加解密，不做流程决策 |
| Adapter（在 Content Script 内） | 同页面 | 把“登录 / 退出 / 状态判断”翻译成方法调用 | 不知道账号库存在，不 import 存储模块 |
| Shared | 跨模块契约 | 类型、消息信封、错误码、结果工具 | 不依赖任何具体上下文 |

依赖方向是单向的：

```text
popup / options ──消息──> background ──消息──> content / bridge ──> adapters ──> pageDriver ──> DOM

background ──> storage / crypto          （只有 Background 能碰密文）
popup / options / content / adapters ──> shared/types、错误码、消息信封
```

这条箭头不是写在文档里就算数的。`eslint.config.js` 里用 `no-restricted-imports` 把它变成了 lint 错误：

- `src/background/**` 不能 import `adapters`、`content`、`popup`、`options`、`ui`；
- `src/content/**` 和 `src/adapters/**` 不能 import `storage`、`background`、`crypto`；
- `src/storage/**`、`src/popup/**`、`src/options/**` 不能 import `crypto`，对 `background` 的跨层引用也在限制列表里。

这样做的直接好处是：以后想偷懒在 Background 里读一个页面元素，或者想在 Adapter 里顺手存个东西，代码会先在 lint 阶段失败，而不是等到线上才发现耦合。

### 消息不裸奔，错误不只靠文案

所有跨上下文通信都套一层信封，而不是裸 `sendMessage('someString')`：

```ts
interface RequestEnvelope<K extends RequestType> {
  kind: 'req';
  id: string;
  type: K;
  payload: RequestPayloadMap[K];
  createdAt: number;
}

type ResponseEnvelope<T = unknown> =
  | { kind: 'res'; id: string; ok: true; data: T; elapsedMs: number }
  | { kind: 'res'; id: string; ok: false; error: SerializedError; elapsedMs: number };
```

信封在两端都会校验：`kind`、`id`、`type`、`payload` 的必填字段、序列化大小都检查。超过 32KB 的请求直接拒绝，未知消息类型直接拒绝。

错误跨模块传递时只传错误码，不传文案：

```ts
interface SerializedError {
  code: ErrorCode;
  category: ErrorCategory;
  retryable: boolean;
  detail?: Record<string, string | number | boolean>;
}
```

Background 不需要知道 UI 是中文还是英文；UI 层在 `src/errors/messages.zh-CN.ts` 里做唯一一次映射。`detail` 还有白名单，只保留 `step`、`field`、`missing`、`elapsedMs`、`reason` 这类标量字段，原始 `Error.message` 不会透出，避免把页面内容或凭证带进日志。

### 状态机先于执行器

切换不是“发一个请求然后等结果”，它有一串明确的中间状态：解析配置、探测登录态、退出、等登录页、填写、提交、验证。状态机被写成一个纯函数迁移表，不依赖任何 Chrome API：

```ts
export const FLOW_TRANSITIONS: Record<FlowState, Partial<Record<FlowEvent, FlowState>>> = {
  idle: { START: 'resolving' },
  resolving: { RESOLVED: 'probing' },
  probing: {
    STATE_LOGGED_IN: 'loggingOut',
    STATE_LOGGED_OUT: 'awaitingLogin',
    STATE_UNKNOWN: 'failed',
    BLOCKED_CAPTCHA: 'failed',
    BLOCKED_MFA: 'failed',
  },
  loggingOut: { LOGGED_OUT: 'awaitingLogin' },
  awaitingLogin: { PAGE_READY: 'filling' },
  filling: { FILLED: 'submitting' },
  submitting: { SUBMITTED: 'verifying' },
  verifying: {
    VERIFIED_SUCCESS: 'completed',
    VERIFIED_FAILURE: 'failed',
    DEADLINE: 'failed',
  },
  completed: {},
  failed: {},
  cancelled: {},
};
```

几个约束也跟着定下来：

- **单飞**：同一时刻只允许一个非终态流程，重复发起返回 `E_FLOW_BUSY`；
- **runId 归属**：每次启动生成新的 `runId`，发给 Content Script 的指令都带 `runId`，迟到响应直接丢弃；
- **不自动续跑**：Service Worker 被回收后，从 `chrome.storage.session` 读到非终态快照，统一改成 `failed(E_INTERRUPTED)`，让用户手动重试；
- **关闭 Popup 不取消流程**：只有显式取消或超时才终止，避免“弹窗一关，后台就不知道自己在干什么”。

阶段一里执行器还是骨架：`flow.start` 会真的走一次迁移，然后明确失败为 `E_NOT_IMPLEMENTED`。这条看起来“什么都没做”的路径，反而比伪造一个成功状态更有价值，因为它让状态机、端口广播和快照恢复都有真实的代码路径可测，而不是只存在于设计稿里。

---

## 构建：Manifest V3 不给你“一次打包四个入口”的自由

这个项目没有用 `@crxjs/vite-plugin`，而是用 Vite 的 JS API 串行构建三趟，再由 `scripts/build.mjs` 统一收口。原因不是偏好，而是 MV3 对产物的格式要求不一样：

| 产物 | 格式要求 | 输出 |
|---|---|---|
| Popup / Options | HTML + 可分割的 ESM chunk | `dist/popup/index.html`、`dist/options/index.html` |
| Background | 单文件、classic script（IIFE） | `dist/background.js` |
| Content Script | 单文件、IIFE、无动态 import | `dist/content.js` |

Rollup 的 `inlineDynamicImports` 只能用于单入口，所以不能“一次构建四个入口”。三趟构建分别控制输出格式：

```ts
build: {
  outDir,
  emptyOutDir: false,
  target: 'es2022',
  assetsDir: 'assets',
  rollupOptions: {
    input: { [mode]: path.resolve(srcRoot, mode, 'index.ts') },
    output: {
      format: 'iife',
      entryFileNames: `${mode}.js`,
      inlineDynamicImports: true,
    },
  },
}
```

UI 那趟则把 `root` 指向 `src`，把 `base` 设为 `'./'`。前者解决的是 Vite 默认会把 HTML 输出到 `dist/src/popup/index.html` 的路径偏移；后者解决的是扩展页面不能用 `/assets/...` 这种绝对路径。

manifest 不手写。`manifest.template.json` 保留固定字段，`scripts/generate-manifest.mjs` 把 `package.json` 的版本注入进去，生成 `dist/manifest.json`。版本只在一个地方维护，避免 manifest 和包版本漂移。

### 把“不应该”变成构建失败

比“记得检查”更可靠的是让构建脚本替你检查。`build.mjs` 里有几组断言：

- `background.js`、`content.js` 不能出现顶层 `import` / `export`，不能出现动态 `import()`，不能出现 `eval(`；
- 两个 HTML 必须引用外部脚本，且脚本路径必须是相对路径；
- `dist` 里不能有 `.ts` / `.tsx` 源文件；
- 必须产出 CSS，且 CSS 不能小于 3000 字节，否则视为 Tailwind 没生效。

`check-manifest.mjs` 再做 14 组断言：manifest 版本、`service_worker` 不能带 `type: module`、`host_permissions` 必须为空、`content_scripts` 必须为空、权限只能是 `storage/scripting/alarms`、图标文件必须真实存在、不能有自定义 CSP、不能有 `web_accessible_resources`、产物里不能有 `eval` 和 `new Function`。

这些检查不优雅，但很省事。像“Content Script 被拆成了两个 chunk”这种问题，如果等到浏览器里加载失败再排查，成本会高得多。

---

## 阶段一：先让骨架可验收

阶段一的目标不是“功能可用”，而是“骨架可验证”。`docs/phase-1-plan.md` 把它拆成 T1–T10，从仓库骨架、构建管线、shared 契约层、storage 骨架、background、content、adapters、UI，一直到单测和验收。

这一阶段真正落地的东西是：

- Options 可以配置 OA 系统（名称、origin、登录页 URL、首页 URL），可以切换当前系统、修改主题和基础设置；
- Popup 可以打开并展示空态：未配置系统、没有账号、保险库未初始化；
- Background 能响应 `app.bootstrap`、`settings.get/update`、系统 CRUD、`flow.getState`、`flow.start`；
- Content Script 能按用户配置的域名动态注册，并响应 `content.ping`；
- Popup 通过长端口收到流程快照，能看到 `resolving → failed` 的真实迁移。

阶段一刻意不做的事也很明确：没有账号密码的真实写入，没有保险库加解密，没有蓝凌页面的任何操作。`flow.start` 的注释写得很直白：

```ts
// 阶段一骨架：不执行任何真实页面操作，明确标记为未实现，绝不上报成功
const error = serializeError(new FlowError('E_NOT_IMPLEMENTED', { step: 'resolve' }));
await this.fail(error);
```

为什么强调“绝不上报成功”？因为一个假的成功状态会污染后面所有验证：UI 看起来对了，状态机看起来跑通了，但真实链路一步都没走。反过来，明确的失败会把问题留在它该在的地方。

### 验证结果

阶段一收尾时，四项自动检查（`typecheck`、`build`、单测、`check:manifest`）都实际执行并通过。整理这篇文章时（2026-11-06），我又在当前工作副本上复核了一遍：

| 检查 | 当前结果 | 说明 |
|---|---|---|
| `npm run typecheck` | 时点未通过 | 3 个 `TS6133`，都在 `SystemsSection.tsx`：适配配置编辑器的三个函数还没接到 UI |
| `npm test` | 通过 | 14 个测试文件，105 个用例 |
| `npm run lint` | 时点未通过 | 与 typecheck 相同的 3 个未使用变量 |
| `npm run check:manifest` | 通过 | 14 组断言全部通过（针对现有 `dist/`） |
| `npm run build` | 阶段一验收时通过 | 当前工作副本没有重新执行构建，`dist/` 是已有产物 |
| Chrome / Edge 手动冒烟 | 未执行 | 阶段一记录里明确标注了这一项缺口 |

上表的 typecheck / lint 是整理到这一节时的时点快照：仓库里另一条实现工作线正在接 Options 的适配配置编辑器，三个新函数还没有接到界面，所以暂时报“已声明但未使用”。它不代表阶段一或阶段二的验收结果，也不应该被写成“全部通过”。

单测覆盖的不是“所有功能”，而是最容易回归的契约：信封解析、状态机合法/非法迁移、storage key 规范、设置默认值与非法值回退、日志脱敏、`PageDriver` 的原生 setter 与超时、组件禁用原因和错误文案、`FlowRunner` 的中断恢复。阶段二推进过程中又补了加密与保险库信封、主密码变更、SW 重启后的锁定状态、账号密码写入与回滚、分组唯一性等用例。测试数量会增加，但覆盖原则没变：优先测契约和状态转换，而不是测 UI 长什么样。

---

## 阶段二：把密码从“账号对象”里拿出去

阶段二是账号、系统、分组的真实 CRUD，以及加密保险库。它现在的状态是“核心链路已经落地，但还不能称为完成”。

### 数据分家

账号对象里没有密码字段。密码单独进保险库，保险库只有一个 key：

```ts
interface VaultEnvelope {
  schemaVersion: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; saltB64: string };
  cipher: { name: 'AES-GCM'; ivB64: string };
  aad: string;
  ciphertextB64: string;
  createdAt: string;
  updatedAt: string;
}
```

明文结构也很简单：

```ts
interface VaultPlaintext {
  schemaVersion: 1;
  entries: Record<string, { password: string }>;
}
```

账号的增删改只动 `oa.v1.accounts`，不需要解密；只有新增或修改密码时才解锁保险库，把整个明文重新加密成一份新密文。账目少的时候，整库重加密的成本可以忽略，换来的是原子性：不会出现“三个账号更新了、两个没更新”的中间态。

### 参数与密钥

KDF 用 PBKDF2-HMAC-SHA-256，默认 600000 次迭代，读取时允许低至 100000 次以兼容旧信封。这个 600000 是对齐 OWASP 2023 对 PBKDF2-SHA256 的建议值，不是我在本机测出来的“最优值”；架构文档里原本计划在阶段二补一次本机耗时记录，目前还没做。

对称加密是 AES-GCM-256，salt 16 字节、IV 12 字节，AAD 固定为 `oa-switcher.vault.v1`。密钥派生时把 `extractable` 设为 `false`：

```ts
const key = await subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
  material,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt'],
);
```

这个 `false` 很关键：派生出来的 `CryptoKey` 不能被导出成原始字节，只能用来加密和解密。它只存在于 Background 的内存里，不写 `storage`，不发给 UI，也不发给 Content Script。

### 懒解锁、手动锁定、被动重锁

保险库有三个状态：`uninitialized`、`locked`、`unlocked`。冷启动时只读信封是否存在，不解密；Popup 里点“切换账号”才要求解锁，这是懒解锁。

锁定有两种方式：

- 手动锁定：Popup 的保险库卡片和 Options 的安全分区都能触发；
- 自动锁定：`chrome.alarms` 每分钟检查一次最后活动时间，默认 15 分钟空闲后锁定。

还有一种不写在代码里、但一定发生的锁定：Service Worker 被回收，内存里的 `CryptoKey` 随之消失。所以“自动锁定”提供的是“最多多久”的保证，而不是“至少多久”。浏览器重启后需要重新解锁，这一点在 UI 里也如实写了。

### 写入顺序与回滚

密码类变更的顺序是“先写密文，再写元数据”：

```ts
await vaultService.writePassword(account.id, password);
try {
  await writeAccounts([...accounts, account]);
} catch (error) {
  await vaultService.removePassword(account.id).catch(() => undefined);
  throw new FlowError('E_INTERNAL', { reason: 'account-write-failed' });
}
```

如果元数据写入失败，就把刚写进保险库的条目删掉，尽量回到操作前的状态。反过来，删除账号元数据不触碰保险库密文，这是有意的取舍：删除操作不应该要求解锁，也不应该因为保险库状态而失败。

### 当前还没有的部分

阶段二已经实现的是：系统/分组/账号的 CRUD 与校验、设置读写、保险库初始化/解锁/锁定/改主密码、密码写入与读取、自动锁定、Popup 与 Options 的对应界面。

还没有完成的是：审计日志、`lockAfterSwitch` 的真实执行（目前只是设置项）、架构文档的状态标记更新。加密、保险库、账号与分组的单测在阶段二收尾过程中已经补上，但审计还没有对应实现。保险库导入/导出也没有做；按架构文档的取舍，如果将来要做，也只能是“重新加密后的密文”，并安排在阶段五。这些不应该被写成“已完成”。

### 安全边界要写清楚

这部分在 Options 的“安全边界”里也列了，但值得在文章里再说一次：

**能防的**：磁盘/备份/同步里只有密文；账号元数据里没有密码字段；只泄露账号元数据时不暴露密码；页面脚本只在用户授权过的 origin 上注入；不绕过验证码和 MFA。

**防不了的**：主密码太弱时的离线暴力破解；浏览器已解锁且本机被控（恶意扩展、远控、内存转储、键盘记录）；Content Script 与页面同处一个 DOM 世界，页面脚本能读到已经填进输入框的值；OA 服务端日志、企业 DLP 对页面内容的采集；JS 字符串在内存里的残留（`Uint8Array` 可以清零，string 不行）；扩展文件被侧载篡改。

把这些写出来，不是给实现找借口，而是避免用户以为“加密了就等于绝对安全”。

---

## 阶段三：适配器不是“写几个选择器”，而是留一套可填的骨架

阶段三原本是空的：`LandrayAdapter` 的每个页面方法都直接返回 `E_NOT_IMPLEMENTED`。在整理这份记录的过程中，仓库里的并行工作线开始把这些方法填实，所以现在的准确状态不是“尚未开始”，而是“方法已经落地，但还没有真实页面验证，也没有接进流程执行器”。

但接口和骨架已经在了。分层是：

```text
Background（不知道 DOM）
   │ oa.detectLoginState / oa.logout / oa.waitForLoginPage / oa.fillCredentials / oa.submitLogin / oa.verifyLogin
   ▼
content/bridge.ts（校验 + 路由 + 错误包装）
   ▼
adapters/registry.ts ──vendor──> adapters/landray/adapter.ts
   ▼
PageDriver（content/pageDriver.ts 提供，Adapter 只面向接口）
   ▼
真实 DOM / location
```

当前适配器里的方法已经不再是空壳，但都只做了“按配置执行”这一层：

| 方法 | 现在的行为 | 依赖的配置 |
|---|---|---|
| `detectLoginPage` | 判断当前 URL 是否匹配登录页规则，并检查登录表单是否就绪 | `loginPageUrlPattern`、`loginFormReadySelector` |
| `detectLoginState` | 用登录后/未登录标记和登录页 URL 判断状态；两个标记同时命中则返回 `unknown`；轮询到 `stateProbeMs` 截止 | `loggedInMarkerSelector`、`loggedOutMarkerSelector`、`loginPageUrlPattern` |
| `detectBlockers` | 检查验证码、MFA 标记，命中就阻断 | `captchaMarkerSelector`、`mfaMarkerSelector` |
| `logout` | 按配置走退出 URL，或点击退出入口（可选二次确认），再等待退出证据 | `logoutTrigger`、`loggedOutUrlPattern`、`loggedOutMarkerSelector` |
| `waitForLoginPage` | 等 URL 匹配且登录表单出现，超时返回 `E_LOGIN_PAGE_TIMEOUT` | `loginPageUrlPattern`、`loginFormReadySelector` |
| `fillCredentials` | 等两个输入框出现，再用原生 setter 写入用户名和密码，失败按字段返回错误 | `usernameFieldSelector`、`passwordFieldSelector` |
| `submitLogin` | 等提交触发器出现，按配置走 `formSubmit` 或点击 | `submitTrigger` |
| `verifyLogin` | 先看失败标记，再看登录后 URL 或登录后元素；到 deadline 仍未命中则返回 `unknown` | `loginFailureMarkerSelector`、`authenticatedUrlPattern`、`loggedInMarkerSelector` |

这些方法都从配置里读选择器，缺键时抛 `E_CONFIG_MISSING`。`content/bridge.ts` 也已经把 `oa.*` 请求路由到对应适配器方法。但 `FlowRunner` 仍然是阶段一的 stub，不会真正发起这些调用，所以端到端切换依然不可用；适配器本身也还没有单测和真实页面验证。

`PageDriver` 不是简单的 `querySelector` 封装，它要处理几件真实页面里一定会遇到的事：

- `setValue` 使用原型上的原生 value setter，然后再派发 `input`、`change`、`blur`，否则 React/Vue 的受控组件可能感知不到值变化；
- `submitForm` 优先用 `form.requestSubmit()`，没有 form 才退回点击；
- `waitFor` / `waitUntil` 都接收 `AbortSignal`，取消时抛 `E_CANCELLED`；
- 轮询有明确的 deadline，`pollMs` 只控制轮询频率，不用“固定 sleep 三秒然后当作成功”这种方式。

蓝凌的配置键位全部是可选、默认 `undefined`：

```ts
export interface LandrayAdapterConfig {
  schemaVersion?: 1;
  loginPageUrlPattern?: string;
  loginFormReadySelector?: string;
  usernameFieldSelector?: string;
  passwordFieldSelector?: string;
  submitTrigger?: { kind: 'formSubmit' | 'click'; selector: string };
  loggedInMarkerSelector?: string;
  loggedOutMarkerSelector?: string;
  authenticatedUrlPattern?: string;
  loginFailureMarkerSelector?: string;
  logoutTrigger?: { kind: 'url'; url: string } | { kind: 'click'; selector: string; confirmSelector?: string };
  loggedOutUrlPattern?: string;
  captchaMarkerSelector?: string;
  mfaMarkerSelector?: string;
  currentAccountMarker?: string | null;
  timeouts?: Partial<AdapterTimeouts>;
  notes?: string | null;
}
```

必填键检查只判断“键是否存在、是否为空字符串”，不解释语义：

```ts
export function checkRequiredKeys(
  config: unknown,
  requiredKeys: readonly string[],
): AdapterConfigValidation {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { ok: false, missing: [...requiredKeys] };
  }

  const record = config as Record<string, unknown>;
  const missing = requiredKeys.filter((key) => {
    const value = record[key];
    if (value === undefined || value === null) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    return false;
  });

  return missing.length === 0 ? { ok: true, missing: [] } : { ok: false, missing };
}
```

缺项时返回缺失键名列表，调用方可以据此精确提示“还差哪几个键”，而不是笼统地说“配置不完整”。

### 为什么宁可留空

因为猜错选择器的代价，比留空高得多。留空时，适配器会明确失败为 `E_CONFIG_MISSING`，用户知道是配置没填；猜错时，可能表现为“找不到表单”“填写了但没提交”“以为登录成功其实停在错误页”，排查时要同时怀疑页面、网络、Cookie 和代码。

仓库里还有一个 `scripts/check-no-selectors.mjs`，在 `build` 开始前扫描 `src/adapters` 和 `src/content`，禁止出现：

- CSS id 选择器常量（如 `'#login'`）；
- `input[name=`；
- `logoutUrl` / `logout_url` 之类的退出地址常量；
- 硬编码的 `http(s)://` URL。

这条脚本让“阶段一不写具体选择器”从一句口头约定变成了构建失败。

方法实现不等于适配完成。阶段三真正需要的输入，不是“再写几个函数”，而是真实页面信息：登录页 URL 与表单选择器、成功后 URL 或仅登录后存在的元素、失败提示元素、退出入口（按钮还是独立 URL、有没有二次确认）、是否有 SSO / 验证码 / MFA、登录表单是否在 iframe 里、测试环境是不是 http、以及是否存在多套环境共享同一域名。这些在 `docs/architecture.md` 的待确认清单里列了 20 项，其中前 8 项是阻塞阶段三的。

---

## 那些真正花时间的地方

下面这些不是事后想出来的“踩坑故事”，而是能从脚本、配置和代码里直接看到的处理方式。

### 1. Vite 的默认输出路径会跟 manifest 打架

Vite 默认以项目根为 `root`，多页 HTML 会被输出到 `dist/src/popup/index.html`，而 manifest 里写的是 `popup/index.html`。这不是一个可以“以后再说”的问题，加载扩展时会直接 404。

处理方式是把 `root` 设为 `src`，让 HTML 的相对路径变成 `popup/index.html`，同时在 `build.mjs` 里断言产物结构。路径问题在构建期暴露，而不是等到浏览器里白屏。

### 2. 扩展页面的 CSP 不允许 inline script

MV3 默认 CSP 禁止 `unsafe-eval`，也不允许 inline script。所有脚本必须外链，HTML 里不能塞一段内联初始化代码。`build.mjs` 会检查两个 HTML 的 `<script src>` 是否存在、是否为相对路径、是否引用了远程地址。

### 3. Service Worker 随时会死

这是 MV3 和 MV2 最大的体感差异。Background 不能假设自己一直活着：

- 流程快照写 `chrome.storage.session`，SW 重启后能读回来；
- 读到非终态就改成 `failed(E_INTERRUPTED)`，不自动续跑；
- keepalive 只在流程活跃期间每 20 秒调一次 `chrome.runtime.getPlatformInfo()`，终态立即停止；
- 端口广播做了 50ms 去抖，避免连续迁移让 Popup 反复渲染；
- Popup 关闭导致端口断开，不会取消流程。

这套处理的核心不是“让 SW 不死”，而是“承认它会死，并让状态在死后仍然可解释”。

### 4. 密码写入不是一次 `set` 就完事

账号和密码存在两个地方，就必须考虑“第一个写成功、第二个失败”怎么办。当前的做法是先写密文、再写元数据，失败时回滚密文条目。这不是分布式事务，只是在单机存储上尽量缩小不一致窗口；真要做得更严谨，需要把两步合并成一个可恢复的操作日志，但以现在的数据规模，回滚已经够用。

### 5. 依赖方向不能靠自觉

“Background 不要 import Adapter”这种约定，写进文档很容易，写进代码很难。ESLint 的 `no-restricted-imports` 让它在编辑时就能报错；`check-no-selectors.mjs` 让“不要写选择器”在构建时失败。约束只有变成工具的输出，才会真的被遵守。

### 6. 文档状态与失效注释也会漂移

开发过程中出现过一条 lint 报错：`VaultGate.tsx` 里有一行 `eslint-disable-next-line react-hooks/exhaustive-deps`，但 ESLint 配置并没有启用 `react-hooks` 插件，于是报 `Definition for rule 'react-hooks/exhaustive-deps' was not found`。这不是业务逻辑问题，而是把禁用注释复制进来时没有同步配置。后来移除了这条失效注释，`lint` 恢复通过。它提醒我：注释也是代码，失效的注释和失效的配置一样会制造噪音。

更值得记的是文档状态。`README.md` 已经更新到阶段二，但 `docs/architecture.md` 顶部仍然标着“规划稿（待用户确认）”，阶段一计划里要求的“契约已冻结”标记也还没有加上。这类滞后不会让构建失败，所以更容易被忘掉；它应该被当成验收项，而不是写完代码后顺手补的装饰。

---

## 当前状态：能做什么，不能做什么

如果把当前工作副本直接加载到浏览器里，能完成的是：

- 在 Options 里配置 OA 系统、申请域名权限、切换当前系统；
- 创建账号、分组，保存用户名和密码；
- 初始化保险库、解锁、手动锁定、修改主密码；
- 在 Popup 里看到账号列表、保险库状态、流程状态；
- 点击切换时，走完状态机的骨架，得到明确的“未实现”失败，而不是一个假的成功。

不能完成的是：

- 真正打开 OA 页面、退出当前账号、填写另一个账号并登录；
- 自动判断登录成功或失败；
- 处理验证码、MFA、SSO；
- 导入/导出保险库、查看审计日志；
- 在 Chrome 和 Edge 上完成手动冒烟（这一项在阶段一记录里就是缺口）。

阶段划分上：阶段一已完成自动检查；阶段二核心链路已落地但未收尾；阶段三的适配器方法已经开始落地，但还没有真实页面验证；阶段四（真实流程执行器）和阶段五（打包、CI、i18n）还没进入。

---

## 如果重来一次，我会保留什么

**先冻结契约，再写实现。** storage key、消息信封、错误码、状态名、Adapter 方法签名，这些一旦被 UI、Background、Content 同时依赖，再改名字就会牵一发动全身。阶段一计划里专门有一节“契约冻结清单”，冻结后只允许新增，不允许重命名。

**用错误码而不是文案跨模块。** 文案会变、会翻译、会带情绪；错误码不会。UI 只负责把 `E_VAULT_LOCKED` 映射成“保险库已锁定，请先解锁”，Background 永远不需要知道这句话怎么说。

**把约束写成构建失败。** 单文件 IIFE、相对路径、无 `eval`、无全站权限、无具体选择器，这些都不是“代码 review 时注意一下”的事，而是脚本每次构建都会检查的事。

**允许“未实现”，但不允许“假成功”。** 阶段一的 `E_NOT_IMPLEMENTED` 和阶段三在没有配置时的 `E_CONFIG_MISSING`，都是为了把不确定性留在明面上。一个诚实的失败，比一个看起来漂亮的假状态更容易维护。

**在没有真实页面信息时，宁可什么都不写。** 选择器、退出地址、成功规则都不是可以靠通用经验补全的东西。等拿到真实页面，再填配置、写适配器，返工成本反而更低。

---

## 下一步

阶段二收尾：把审计、`lockAfterSwitch` 按规划补齐；继续补错误路径、并发和存储失败这类边界用例；把 `architecture.md` 的状态标记与过时注释同步到当前实现。

阶段三：拿到真实蓝凌 OA 的登录页、成功/失败证据、退出入口和 SSO/验证码情况后，把 `LandrayAdapterConfig` 填实，用真实页面验证已经落地的适配器方法，并补上适配器单测。选择器仍然只存在配置里，不进入流程代码。流程执行器的接入仍留给阶段四。

阶段四：把 `FlowRunner` 从“迁移一次就失败”的骨架换成真实执行器，接上 Content Script 的步骤调用、超时、取消和验证。

阶段五：打包 zip、补 CI、做 i18n，再考虑商店分发；如果确实需要保险库迁移，再补密文格式的导入/导出。

这个项目现在还不能替我完成一次真正的 OA 切换。但它已经有一条能被类型检查、单测、manifest 断言和构建脚本共同验证的骨架，也把“哪些事不该做”写进了代码。对一个个人项目来说，这比“看起来能用”更接近可交付。
