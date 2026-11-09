# OA Switcher 架构设计

> 状态：阶段五交付稿（阶段一至四已实现，阶段五完成测试、打包与文档）  
> 适用范围：Chrome / Edge (Chromium) Extension，Manifest V3  
> 本文件定义结构、边界、协议、数据与安全设计；实现细节以 `src/` 为准。

---

## 0. 结论摘要（关键决策）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 构建采用 **Vite 三趟构建**（UI / background / content），由 `scripts/build.mjs` 调用 Vite JS API 串行执行，而不是 `@crxjs/vite-plugin` | 产物 deterministic：`background.js`、`content.js` 必须是**单文件 IIFE**，不能有 ESM import 与 chunk 拆分；三趟构建可精确控制每个入口的输出格式，且无额外插件版本风险 |
| D2 | Popup / Options 使用 **React + 普通 Vite 构建**（可代码分割，`base: './'`）；background 与 content script 强制 `format: 'iife'`、`inlineDynamicImports: true` | MV3 的 content script 在 manifest 声明中不能是 ES module；background 用 classic worker 规避不同版本浏览器对 `type: module` 的差异 |
| D3 | **Adapter 运行在 Content Script 内**，Background 只做编排，不 import 任何 adapter 代码 | 满足「Background 不碰 DOM」；OA 厂商逻辑与流程/账号逻辑物理隔离，可用 lint 规则强制依赖方向 |
| D4 | 流程状态机 + **runId 单飞**（同一时刻仅一个切换任务），状态快照写 `chrome.storage.session` | MV3 Service Worker 随时可能被回收，内存态不可靠；session storage 在 SW 重启后可恢复，浏览器重启即清空 |
| D5 | 凭证以 **整库单密文**（PBKDF2-SHA256 → AES-GCM-256）存 `chrome.storage.local`，账号元数据与密文分离 | 账号增删改不需要触碰密文；保险库体积小，整库重加密成本可忽略，且保证原子性 |
| D6 | 域名限制用 **`optional_host_permissions` + 运行时授权 + `chrome.scripting.registerContentScripts` 动态注册**，manifest 不写死任何 OA 域名 | 插件不申请全站权限；只有用户配置过的 OA 域名才会注入脚本，符合「限制脚本运行域名」 |
| D7 | 所有 OA 选择器/URL/成功判定字段**全部可配置且默认空**，缺项直接拒绝执行（`E_CONFIG_MISSING`）；唯一例外是**厂商预设**（`src/adapters/<vendor>/preset.ts`），预设值由用户选择 OA 类型时填入且可逐项覆盖 | 遵守「未获取真实页面信息前不得虚构选择器」；Adapter 只定义键位，不含猜测值。厂商预设必须经至少两个真实环境交叉校验，否则不得收录 |
| D8 | 错误以 **错误码**（而非文案）跨模块传递，文案由 UI 层映射 | Background 不知道 UI 语言；错误码可测试、可分类、可统计 |

---

## 1. 运行上下文与模块边界

### 1.1 信任/运行边界

| 上下文 | 生命周期 | 能做什么 | 绝对不能做什么 |
|---|---|---|---|
| Popup（React） | 打开即建，关闭即销毁 | 渲染 UI、发起消息、持有**明文主密码输入框**（提交后立即清空） | 不直接访问 OA DOM；不持有派生密钥；不直接读写保险库密文 |
| Options（React） | 同上 | 系统/账号/安全配置的增删改查 UI | 同上 |
| Background (SW) | 事件驱动，空闲可被回收 | 消息路由、流程状态机、`chrome.storage` 读写、**唯一持有 CryptoKey 的地方**、动态注册 Content Script、权限申请 | 不访问 DOM、不 `fetch` OA 页面、不 `eval` |
| Content Script | 每个匹配页面一份，随页面销毁 | 只做页面交互（DOM 查询/填写/点击/URL 等待），执行 Adapter | 不读写 `chrome.storage`、不做加解密、不做流程决策、不持久化任何数据 |
| Adapter（在 CS 内） | 同上 | 把「蓝凌登录/退出/状态」翻译为方法调用 | 不知道账号库存在、不 import storage 模块、不发消息 |

依赖方向（只允许箭头方向）：

```
popup/options ──messaging──> background ──messaging──> content/bridge ──> adapters ──> pageDriver ──> DOM
     │                          │
     └────── shared/types ──────┴────── storage（仅 background 可 import）
```

强制手段（阶段一落地）：ESLint `no-restricted-imports`：

- `src/background/**` 禁止 import `src/adapters/**`、`src/content/**`
- `src/adapters/**`、`src/content/**` 禁止 import `src/storage/**`、`src/background/**`
- `src/crypto/**` 只能被 `src/background/**` import

### 1.2 一次切换的时序（目标态，阶段四实现）

```
Popup          Background                 Content(CS)                OA 页面
  │  flow.start   │                          │                        │
  ├──────────────>│ 校验账号/系统 → 解锁态    │                        │
  │               │ settings/accounts 读取    │                        │
  │               │ 解密凭证(内存)            │                        │
  │               │ content.ping             │                        │
  │               ├─────────────────────────>│                        │
  │               │ oa.detectLoginState      │ 读 DOM/URL             │
  │               ├─────────────────────────>├───────────────────────>│
  │               │<── loggedIn|loggedOut|unknown ─────────────────────┤
  │               │ oa.logout（仅已登录）     │ 点击/导航 + 等 URL     │
  │               ├─────────────────────────>├───────────────────────>│
  │               │ oa.waitForLoginPage       │ 轮询就绪条件 + 超时    │
  │               │ oa.fill(用户名/密码)      │ 原生 setter + 事件     │
  │               │ oa.submit                 │ 点击/提交表单           │
  │               │ oa.verify（轮询至 deadline） 成功/失败证据          │
  │               │<── success|failure|unknown ────────────────────────┤
  │<── state 推送（每次迁移）                   │                        │
```

---

## 2. 目录结构与文件清单

`(P1)` = 阶段一落地；`(P2)`=账号/存储/加密；`(P3)`=蓝凌适配；`(P4)`=状态机；`(P5)`=测试打包。

```
OA Switcher/
├── package.json                     # 依赖与脚本入口（build/typecheck/test/check:manifest）
├── tsconfig.json                    # 主 TS 配置（strict、noUncheckedIndexedAccess）
├── tsconfig.node.json               # vite/vitest 配置文件用的 Node 侧配置
├── vite.config.ts                   # 由构建脚本按 target 覆写的 Vite 配置（ui/background/content）
├── vitest.config.ts                 # 单测环境（node + jsdom 双 project）
├── tailwind.config.ts               # Tailwind 内容扫描范围与设计 token
├── postcss.config.js                # Tailwind/autoprefixer
├── eslint.config.js                 # 含模块依赖方向约束
├── .gitignore                       # 忽略 node_modules/dist/.crx 等
├── .editorconfig                    # 统一缩进与换行
├── public/
│   ├── icons/icon-16.png            # 扩展 16px 图标
│   ├── icons/icon-32.png            # 扩展 32px 图标
│   ├── icons/icon-48.png            # 扩展 48px 图标
│   └── icons/icon-128.png           # 扩展 128px 图标（商店/详情页）
├── manifest.template.json           # MV3 manifest 模板（不含 version，由生成脚本注入）
├── scripts/
│   ├── build.mjs                    # 串行执行三趟 Vite 构建 + 生成 manifest + 自检
│   ├── build-watch.mjs              # 开发态 watch（build --watch，手动 reload 扩展）
│   ├── generate-manifest.mjs        # 读 template + package.json 版本 → 写 dist/manifest.json
│   ├── check-manifest.mjs           # 校验 dist 产物与 manifest 一致性（CI/阶段验收）
│   ├── check-no-selectors.mjs       # 静态扫描，禁止写入具体 OA 选择器/退出地址（豁免 src/adapters/*/preset.ts）
│   ├── package.mjs                  # 按白名单从 dist 生成 release/oa-switcher-<version>/ 目录（zip 仅作归档）
│   ├── check-package.mjs            # 校验交付目录与 zip 的必需文件、顶层白名单、无调试残留、清单一致
│   ├── release-spec.mjs             # package 与 check-package 共用的白名单/必需文件/禁止内容规范
│   ├── extension-key.mjs            # 读取可选公钥并推导扩展 ID（供 manifest/打包校验复用）
│   └── make-key.mjs                 # 可选：生成固定扩展 ID 用的 RSA 密钥（私钥写到仓库外）
├── docs/
│   ├── architecture.md              # 本文件：架构、协议、数据、安全、Adapter 契约
│   ├── testing.md                   # 测试矩阵、异常审查结论与实测结果（阶段五）
│   └── development-summary.md       # 实现演进、关键取舍与真实排障记录
├── src/
│   ├── manifest.ts                  # （可选）manifest 的 TS 类型辅助/生成器被 scripts 复用时的桥接说明
│   ├── shared/                      # 唯一跨模块契约层，任何模块都可 import
│   │   ├── constants.ts             # storage key、超时默认值、端口名、限制常量
│   │   ├── types/
│   │   │   ├── ids.ts               # Id 品牌类型（AccountId/SystemId/GroupId/RunId）与生成规则
│   │   │   ├── account.ts           # 账号/账号分组的数据结构（不含密码）
│   │   │   ├── system.ts            # OA 系统与 Adapter 配置的字段定义
│   │   │   ├── settings.ts          # 全局设置结构
│   │   │   ├── messages.ts          # 消息类型、请求/响应信封、端口消息
│   │   │   ├── flow.ts              # 状态机状态、快照、步骤名
│   │   │   └── errors.ts            # 错误码枚举、分类、序列化结构
│   │   ├── messaging/
│   │   │   ├── protocol.ts          # 信封构造/解析 + 手写类型守卫（不引第三方校验库）
│   │   │   ├── client.ts            # UI 侧调用封装（sendMessage / 端口订阅，统一超时与错误归一）
│   │   │   └── server.ts            # Background 侧路由注册器（类型安全的 handler 表）
│   │   ├── result.ts                # Result<Ok, FlowError> 工具与错误归一化
│   │   ├── base64.ts                # Uint8Array ↔ base64（保险库序列化用）
│   │   └── log.ts                   # 脱敏日志（禁止输出密码/Cookie/Token 字段）
│   ├── storage/                     # 只有 background 可以 import
│   │   ├── keys.ts                  # 全部 storage key 常量与命名空间
│   │   ├── repo.ts                  # 类型化 get/set/update（含默认值填充与校验）
│   │   ├── migrations.ts            # schemaVersion 迁移链（v1 → vN）
│   │   └── sessionRepo.ts           # chrome.storage.session 的运行态快照读写
│   ├── crypto/                      # 只有 background 可以 import
│   │   ├── kdf.ts                   # PBKDF2 派生（参数校验、迭代数下限）
│   │   ├── aesgcm.ts                # AES-GCM 加解密 + AAD 绑定
│   │   └── vaultCrypto.ts           # 保险库信封的封装/解封（不负责业务字段）
│   ├── background/
│   │   ├── index.ts                 # SW 入口：注册监听、启动自检、恢复 session 快照
│   │   ├── router.ts                # 消息路由表（把 messages.ts 的类型映射到 service）
│   │   ├── services/
│   │   │   ├── accountService.ts    # 账号/分组 CRUD 与唯一性校验（不接触密文）
│   │   │   ├── systemService.ts     # OA 系统 CRUD、配置校验、域名模式生成
│   │   │   ├── settingsService.ts   # 全局设置读写与默认值
│   │   │   ├── vaultService.ts      # 锁定态、解锁、加解密编排、自动锁定计时
│   │   │   ├── permissionService.ts # 运行时申请 host 权限、查询已授权域名
│   │   │   └── bootstrapService.ts  # 一次性返回 popup 首屏所需聚合数据
│   │   ├── flow/
│   │   │   ├── machine.ts           # 纯函数状态机：迁移表 + 守卫（无副作用，最好测）
│   │   │   ├── runner.ts            # 执行器：按状态调用 CS 步骤、超时、取消、runId 单飞
│   │   │   ├── steps.ts             # 状态 → 步骤命令的映射与结果解释
│   │   │   └── snapshotStore.ts     # 状态快照持久化 + 端口广播（去抖）
│   │   ├── contentRegistry.ts       # 依据系统配置动态 register/unregister content script
│   │   └── keepalive.ts             # 流程进行中的 SW 保活（仅在 run 活跃期间）
│   ├── content/                     # Content Script（无 React）
│   │   ├── index.ts                 # CS 入口：建立消息桥、屏蔽非白名单来源、上报就绪
│   │   ├── bridge.ts                # 收消息 → 校验 → 调 adapter → 统一响应/异常包装
│   │   ├── pageDriver.ts            # DOM 驱动的具体实现（原生 setter、事件派发、URL 等待）
│   │   └── guards.ts                # 来源/上下文校验：top frame、域名、runId 绑定
│   ├── adapters/                    # OA 厂商适配层（只依赖 shared/types + 注入的 PageDriver）
│   │   ├── types.ts                 # OaAdapter 接口、AdapterContext、PageDriver 接口、能力位
│   │   ├── registry.ts              # vendor → 工厂映射；未知 vendor 返回 UnsupportedAdapter
│   │   ├── unsupported.ts           # 占位实现：明确抛 E_SYSTEM_UNSUPPORTED（其他厂商只留接口）
│   │   ├── configValidation.ts      # 通用「必填键位检查」→ 返回缺失字段列表
│   │   └── landray/
│   │       ├── adapter.ts           # 蓝凌适配实现（只读 config，写死逻辑为 0）
│   │       ├── config.ts            # 蓝凌 Adapter 配置 schema（键名 + 默认空值 + 版本）
│   │       └── rules.ts             # 判定规则组合器：URL 规则/选择器规则/失败标记优先级
│   ├── popup/
│   │   ├── index.html               # Popup HTML 入口（宽度固定 360px）
│   │   ├── main.tsx                 # React 挂载
│   │   ├── App.tsx                   # 首屏编排：bootstrap → 锁定态 → 账号列表 → 切换按钮
│   │   ├── components/
│   │   │   ├── AccountList.tsx      # 账号（按分组）列表与选中态
│   │   │   ├── SwitchButton.tsx     # 触发切换 + 禁用条件（未解锁/无系统/流程忙）
│   │   │   ├── FlowStatus.tsx       # 状态机快照可视化（步骤、耗时、错误码文案）
│   │   │   └── VaultGate.tsx        # 主密码解锁/初始化入口（阶段二接入真实逻辑）
│   │   └── hooks.ts                 # useFlowPort / useBootstrap / useVaultStatus
│   ├── options/
│   │   ├── index.html               # Options HTML 入口
│   │   ├── main.tsx                 # React 挂载
│   │   ├── App.tsx                   # 分区导航：系统 / 账号 / 分组 / 安全 / 关于
│   │   └── sections/
│   │       ├── SystemsSection.tsx   # OA 系统与 Adapter 配置表单（字段可留空并提示缺失）
│   │       ├── AccountsSection.tsx  # 账号 CRUD 与分组归属
│   │       ├── GroupsSection.tsx    # 分组 CRUD 与排序
│   │       └── SecuritySection.tsx  # 自动锁定、主密码变更、保险库导入/导出（阶段二/五）
│   ├── ui/                          # 跨 UI 复用
│   │   ├── styles.css               # Tailwind 指令与 CSS 变量（明暗主题）
│   │   ├── Button.tsx               # 按钮
│   │   ├── Field.tsx                # 表单字段 + 帮助文案 + 错误态
│   │   ├── Modal.tsx                # 模态框
│   │   └── Toast.tsx                # 轻提示
│   └── errors/
│       └── messages.zh-CN.ts        # 错误码 → 中文文案（UI 层唯一映射点）
├── tests/
│   ├── unit/
│   │   ├── protocol.test.ts         # 信封解析/守卫：非法 type、缺字段、超长 payload
│   │   ├── machine.test.ts          # 状态机迁移表全覆盖（合法/非法迁移）
│   │   ├── keys.test.ts             # storage key 唯一性与命名规范
│   │   ├── configValidation.test.ts # 缺配置 → 精确缺失字段列表
│   │   └── registry.test.ts         # 未知 vendor → 不支持错误
│   └── fixtures/
│       └── mock-oa.html             # 本地静态页（仅用于验证 CS 注入与 ping，不含任何 OA 逻辑）
```

### 2.1 标注说明

- `src/manifest.ts` 非必需：manifest 由 `manifest.template.json` + 脚本生成，类型仅通过 `@types/chrome` 的 `chrome.runtime.ManifestV3` 在 `check-manifest.mjs` 邻接的 TS 校验中复用。若不需要，可删除该文件（阶段一以「不创建」为准）。

---

## 3. 构建方案

### 3.1 为什么是多入口三趟构建

MV3 对四类产物的格式要求不同：

| 产物 | 格式要求 | 输出路径（固定名，manifest 引用） |
|---|---|---|
| Popup | HTML + ESM chunks（可分割） | `dist/popup/index.html` |
| Options | HTML + ESM chunks（可分割） | `dist/options/index.html` |
| Background | 单文件，classic script（IIFE） | `dist/background.js` |
| Content Script | 单文件，IIFE，无动态 import | `dist/content.js` |

Rollup 的 `inlineDynamicImports` 只能用于**单入口**，因此不能「一次构建四入口」。三趟构建分别设置：

```ts
// 概念示例（实际写在 scripts/build.mjs 的 Vite JS API 调用里）
// Target A: ui
{
  root: 'src',                    // 让 HTML 输出为 dist/popup/index.html、dist/options/index.html
  base: './',                     // 扩展页面必须相对路径，不能用 /assets/...
  publicDir: false,               // 图标由 target C 统一复制，避免重复
  build: {
    outDir: resolve('dist'),
    emptyOutDir: true,
    rollupOptions: { input: { popup: 'popup/index.html', options: 'options/index.html' } },
  },
}

// Target B: background
{
  root: 'src',
  build: {
    outDir: resolve('dist'),
    emptyOutDir: false,
    rollupOptions: {
      input: { background: 'background/index.ts' },
      output: { entryFileNames: 'background.js', format: 'iife', inlineDynamicImports: true },
    },
  },
}

// Target C: content
{
  root: 'src',
  build: {
    outDir: resolve('dist'),
    emptyOutDir: false,
    rollupOptions: {
      input: { content: 'content/index.ts' },
      output: { entryFileNames: 'content.js', format: 'iife', inlineDynamicImports: true },
    },
  },
}
```

- CSS：Tailwind 只在 UI 趟产出 `dist/assets/*.css`，由 HTML 自动引用；CS/Background 不引 CSS。
- 图标：`publicDir: 'public'` 只在 Target C 开启，产出 `dist/icons/*`。
- `npm run build` 顺序：`clean → ui → background → content → generate-manifest → check-manifest`。

### 3.2 manifest.json 的生成方式

不手写 `dist/manifest.json`，用模板 + 注入，避免版本漂移：

```
manifest.template.json  (仓库根，含固定字段; background.service_worker = "background.js")
        +
package.json.version
        ↓  scripts/generate-manifest.mjs（纯 Node 的 JSON 读写，不依赖 TS 运行时）
dist/manifest.json
```

模板关键字段（阶段一即确定）：

```jsonc
{
  "manifest_version": 3,
  "name": "OA Switcher",
  "description": "OA 多账号快速切换（蓝凌 OA 优先）",
  "minimum_chrome_version": "116",
  "background": { "service_worker": "background.js" },   // 不加 type: module
  "action": { "default_popup": "popup/index.html", "default_icon": { "16": "icons/icon-16.png", "32": "icons/icon-32.png" } },
  "options_ui": { "page": "options/index.html", "open_in_tab": true },
  "permissions": ["storage", "scripting", "alarms"],
  "optional_host_permissions": ["http://*/*", "https://*/*"],
  "host_permissions": [],                                 // 不申请全站权限
  "content_scripts": [],                                  // 空：全部走 scripting.registerContentScripts 动态注册
  "icons": { "16": ..., "32": ..., "48": ..., "128": ... },
  "minimum_edge_version": "116"
}
```

- 不声明 `web_accessible_resources`（CS/Background 无需暴露资源）。
- 不使用 `content_security_policy` 自定义值（默认 MV3 CSP 已满足，且禁止 `unsafe-eval`）。
- 默认不使用 `key` 字段；仅在 `npm run package -- --pin-id`（或 `build -- --pin-id`）时注入公钥以固定扩展 ID。
  默认关闭的原因：加入 `key` 会改变一次扩展 ID，旧 profile 的 `chrome.storage.local` 配置将读不到。

### 3.3 域名限制与动态注入

1. 每次系统/账号配置写入后，`contentRegistry.reconcile()` 重新计算匹配集：
   - 来源：每个启用系统由 `loginUrl` / `homeUrl` 的主机与协议生成一个匹配模式，如 `https://oa.example.com/*`（**仅路径前缀下的站点**，不使用 `<all_urls>`）。
2. `chrome.scripting.registerContentScripts([{ id, matches, js: ['content.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true }])`。
3. 未授权的域：先 `chrome.permissions.request({ origins })`（必须由用户手势触发，即 Options 里点「保存并授权」），拒绝则保存配置但标记 `permissionState: 'denied'`，流程直接 `E_NO_PERMISSION`。
4. 兜底：若目标标签页确实无 CS（例如系统刚配置完），Background 用 `chrome.scripting.executeScript({ target: { tabId } })` 注入一次，再 `content.ping` 重试一次；仍失败 → `E_CONTENT_UNAVAILABLE`。
5. 同一域名被删除后调用 `unregisterContentScripts({ ids })`，并释放对应 host 权限（`chrome.permissions.remove`）。

### 3.4 Chrome / Edge 兼容

- 全部使用 `chrome.*` 命名空间（Edge Chromium 原生支持），不写 `browser.*` 分支。
- 不使用 `chrome.sidePanel`、`chrome.offscreen`（阶段一无需，也避免版本差异）。
- Service Worker 用 classic（`format: 'iife'`），Chrome 116+ / Edge 116+ 全支持。
- 产物加载验证覆盖 `chrome://extensions` 与 `edge://extensions` 的「加载已解压的扩展程序」。
- 文件夹拖入 `chrome://extensions` 存在内部处理链路（`loadUnpacked({useDraggedPath:true})`），但 Chrome 156 的
  自动化拖拽未能完成一次真实安装验证；文档不宣称支持拖拽，统一以「加载已解压」为准。

---

## 4. 消息协议设计

### 4.1 信封

所有跨上下文通信统一使用同一信封，禁止裸 `sendMessage('someString')`。

```ts
type MessageTarget = 'background' | 'content';

interface RequestEnvelope<T extends RequestType> {
  kind: 'req';
  id: string;            // 请求唯一 ID（nanoid 风格自实现，避免引依赖）
  type: T;               // 见 4.2 消息表
  payload: RequestPayload[T];
  createdAt: number;     // Date.now()，用于诊断与超时对齐
}

interface SuccessEnvelope<T> { kind: 'res'; id: string; ok: true; data: T; elapsedMs: number }
interface FailureEnvelope { kind: 'res'; id: string; ok: false; error: SerializedError; elapsedMs: number }
type ResponseEnvelope<T> = SuccessEnvelope<T> | FailureEnvelope;
```

```ts
interface SerializedError {
  code: ErrorCode;                      // 见 4.5
  category: ErrorCategory;              // 'validation'|'security'|'permission'|'environment'|'adapter'|'flow'|'internal'
  retryable: boolean;
  detail?: Record<string, string | number | boolean>;  // 已脱敏；禁止出现 password/cookie/token 键
}

interface ProgressEvent {              // 单向事件，仅从 background 发往 UI 端口
  kind: 'evt';
  type: 'flow.state';
  runId: string;
  snapshot: FlowStateSnapshot;
}
```

规则：

1. **校验在两端**：`protocol.parseRequest()` 用手写守卫校验 `kind/type/id/payload` 的必填与类型；非法 → `E_VALIDATION`，且不进入业务。
2. **一次请求一个响应**：不用「流式响应」；流程进度用端口事件，避免长连接请求语义混乱。
3. **UI → Background** 用 `chrome.runtime.sendMessage`（带超时封装）；**Background → Content** 同理，并额外带 `runId` 做归属校验（Content 拒绝非当前 run 的 fill 指令）。
4. **Background → UI** 用 `chrome.runtime.connect({ name: 'oa-switcher:flow' })` 长端口广播快照；Popup 打开时先 `flow.getState` 拉取全量。
5. 禁传大对象：`fill` 步骤 payload 只允许 `{ runId, systemId, username, password }`，不允许带完整账号对象。

### 4.2 消息类型表

UI → Background：

| type | payload | data（响应） | 阶段 |
|---|---|---|---|
| `app.bootstrap` | `{}` | `{ settings, systems, groups, accounts, vault: {locked\|unlocked\|uninitialized}, activeSystemId? }` | P1（空数据）/P2 |
| `settings.get` / `settings.update` | `{}` / `Partial<Settings>` | `Settings` | P1 / P2 |
| `system.list` / `system.create` / `system.update` / `system.delete` | `{}` / `OASystemInput` / `{id, patch}` / `{id}` | `OASystem[]` / `OASystem` | P2 |
| `system.probeConfig` | `{ systemId }` | `{ missing: string[] }` | P3 |
| `group.list` / `group.create` / `group.update` / `group.delete` | 同上模式 | `AccountGroup[]` | P2 |
| `account.list` / `account.create` / `account.update` / `account.delete` | 同上模式（`password` 仅 create/update 时出现并由后台立刻进保险库） | `Account[]` | P2 |
| `vault.status` | `{}` | `{ state, iterations?, lastUnlockedAt? }` | P2 |
| `vault.init` | `{ masterPassword }` | `{ state: 'unlocked' }` | P2 |
| `vault.unlock` | `{ masterPassword }` | `{ state: 'unlocked' }` | P2 |
| `vault.lock` | `{}` | `{ state: 'locked' }` | P2 |
| `vault.changeMaster` | `{ current, next }` | `{ state: 'unlocked' }` | P2 |
| `flow.start` | `{ accountId, systemId? }` | `{ runId }` | P1（stub 直接 `E_NOT_IMPLEMENTED`）/P4 |
| `flow.cancel` | `{ runId }` | `{ state: 'cancelled' }` | P4 |
| `flow.getState` | `{}` | `FlowStateSnapshot \| null` | P1 |
| `permission.ensure` | `{ systemId }` | `{ granted: boolean, origins: string[] }` | P2/P3 |

Background → Content（均带 `runId`）：

| type | payload | data |
|---|---|---|
| `content.ping` | `{ runId?: string }` | `{ url, title, ready: true, frame: 'top', adapterVersion: string }` |
| `oa.detectLoginState` | `{ runId, systemId, vendor }` | `{ state: 'loggedIn'\|'loggedOut'\|'unknown', evidence: Evidence }` |
| `oa.waitForLoginPage` | `{ runId, systemId, vendor, timeoutMs }` | `{}` 或超时错误 |
| `oa.fillCredentials` | `{ runId, systemId, vendor, username, password }` | `{ filled: true }` |
| `oa.submitLogin` | `{ runId, systemId, vendor }` | `{ submitted: true }` |
| `oa.verifyLogin` | `{ runId, systemId, vendor, deadlineAt }` | `{ outcome: 'success'\|'failure'\|'unknown', evidence }` |
| `oa.logout` | `{ runId, systemId, vendor, timeoutMs }` | `{ loggedOut: true }` |
| `oa.detectBlockers` | `{ runId, systemId, vendor }` | `{ blockedBy: 'captcha'\|'mfa'\|null }` |
| `oa.cancel` | `{ runId, systemId, vendor }` | `{ cancelled: true }`：中止在途命令、等待其退出，再清空已填字段 |

Content → Background：不使用上表以外的自发消息（只有被动响应）。唯一例外是 `content.ready`（页面加载时上报 URL/标题，供 Popup 显示「当前系统」），且同样走信封。

### 4.3 切换状态机

状态定义：

```ts
type FlowState =
  | 'idle'          // 无运行中的任务
  | 'resolving'     // 校验账号/系统配置、检查解锁态、解密凭证
  | 'probing'       // 探测当前登录态（content.ping + detectLoginState）
  | 'loggingOut'    // 已登录时必须先退出
  | 'awaitingLogin' // 等待登录页/登录表单就绪
  | 'filling'       // 填写凭证
  | 'submitting'    // 提交
  | 'verifying'     // 轮询验证登录结果
  | 'completed'     // 终态：成功
  | 'failed'        // 终态：失败
  | 'cancelled';    // 终态：用户取消
```

迁移表（`machine.ts` 的纯函数即可表达）：

| 当前态 | 事件 | 守卫 | 下一态 | 失败分支 |
|---|---|---|---|---|
| idle | `START` | 无运行任务 && 账号/系统存在 | resolving | 校验失败 → failed(E_VALIDATION) |
| resolving | `RESOLVED` | 保险库已解锁 && 凭证存在 && 配置完整 | probing | E_VAULT_LOCKED / E_CREDENTIAL_MISSING / E_CONFIG_MISSING |
| probing | `STATE=loggedOut` | — | awaitingLogin | — |
| probing | `STATE=loggedIn` | — | loggingOut | — |
| probing | `STATE=unknown` | — | failed | E_STATE_UNKNOWN（不做猜测性继续） |
| probing | `BLOCKED` | 检测到 captcha/mfa | failed | E_BLOCKED_CAPTCHA / E_BLOCKED_MFA |
| loggingOut | `LOGGED_OUT` | URL/标记确认已退出 | awaitingLogin | E_LOGOUT_TIMEOUT / E_LOGOUT_TRIGGER_FAILED |
| awaitingLogin | `PAGE_READY` | 登录表单可填（字段存在且可编辑） | filling | E_LOGIN_PAGE_TIMEOUT / E_FORM_NOT_FOUND |
| filling | `FILLED` | 两个字段值已写入且触发了 input/change | submitting | E_FILL_FAILED |
| submitting | `SUBMITTED` | 提交动作已发出（不代表成功） | verifying | E_SUBMIT_FAILED |
| verifying | `VERIFIED=success` | 命中成功证据（见 6.3） | completed | — |
| verifying | `VERIFIED=failure` | 命中失败标记 | failed | E_LOGIN_REJECTED |
| verifying | `DEADLINE` | 超过 `verifyTimeoutMs` 仍无证据 | failed | E_VERIFY_TIMEOUT（**绝不以「没有报错」判成功**） |
| 任意非终态 | `CANCEL` | — | cancelled | — |
| 任意非终态 | `TIMEOUT` | 当前步超出步超时 | failed | E_TIMEOUT（detail.step 标注） |
| 任意非终态 | `ERROR` | 适配器抛错 | failed | 对应错误码 |

约束：

- **单飞**：`flow.start` 时若已有非终态 run → `E_FLOW_BUSY`（返回当前快照）。
- **runId 归属**：每次 start 生成新 `runId`；所有 Content 请求与快照都带 `runId`；迟到响应一律丢弃。
- **终态停留**：completed/failed/cancelled 保留至下一次 start 或用户关闭 Popup；便于 Popup 展示耗时与错误。
- **SW 被回收**：快照存 `chrome.storage.session`（含 `state`、`runId`、`deadlineAt`）。SW 重启时若读到非终态 → 置为 `failed`（`E_INTERRUPTED`）并告知用户重试（不做自动续跑，避免半途状态不明）。
- **无自动重试**：v1 只允许用户手动重试；`retryable` 仅用于 UI 提示。
- **终态副作用**：`lockAfterSwitch=true` 时在终态后由 `afterTerminal` 锁定保险库；钩子只执行一次，
  失败只记 `flow-terminal-hook-failed`，不改变本次流程结论。
- **密码生命周期**：填写步骤成功后立即清空内存目标中的密码；后续提交/验证不再持有明文。
- **快照写入失败**：记录 `flow-snapshot-write-failed` 后继续，内存快照与端口广播不受影响。

### 4.4 端口与广播

- 端口名：`oa-switcher:flow`
- 每次状态迁移写一次 session storage，然后广播一次（50ms 去抖合并连续迁移）。
- Popup 关闭端口断开，Background 不因端口断开而取消 run（run 由用户显式 `flow.cancel` 终止）——避免「关掉弹窗就中断」的困惑；此点列入待确认清单。
- keepalive：仅在 run 处于非终态时，每隔 `~20s` 调一次 `chrome.runtime.getPlatformInfo()`；终态即停止。

### 4.5 错误分类与错误码

| 分类 | 错误码 | 含义 | 可重试 |
|---|---|---|---|
| validation | `E_VALIDATION` | 入参非法/字段缺失 | 否 |
| validation | `E_FLOW_BUSY` | 已有切换在跑 | 是 |
| security | `E_VAULT_NOT_INITIALIZED` | 保险库尚未创建主密码 | 否 |
| security | `E_VAULT_LOCKED` | 保险库已锁定，需解锁 | 是 |
| security | `E_MASTER_INVALID` | 主密码错误（GCM 认证失败） | 是 |
| security | `E_CRYPTO_UNAVAILABLE` | `crypto.subtle` 不可用（非安全上下文等） | 否 |
| security | `E_CREDENTIAL_MISSING` | 目标账号无密码记录 | 否 |
| permission | `E_NO_PERMISSION` | 未授予该 OA 域名权限 | 是（需用户手势） |
| environment | `E_NO_OA_TAB` | 当前没有匹配该系统的标签页 | 是 |
| environment | `E_CONTENT_UNAVAILABLE` | Content Script 未注入/无响应 | 是 |
| environment | `E_SYSTEM_AMBIGUOUS` | 多个系统匹配当前页面 | 是（需用户选择） |
| adapter | `E_SYSTEM_UNSUPPORTED` | vendor 无实现（其他厂商预留） | 否 |
| adapter | `E_CONFIG_MISSING` | 适配配置缺项（`detail.missing` 列出键名） | 是 |
| adapter | `E_LOGIN_PAGE_TIMEOUT` | 登录页/表单未在时限内就绪 | 是 |
| adapter | `E_FORM_NOT_FOUND` | 用户名/密码字段或提交控件不存在 | 是 |
| adapter | `E_FILL_FAILED` | 写入失败（只读/被隐藏/被拦截） | 是 |
| adapter | `E_SUBMIT_FAILED` | 提交控件不可用或提交被阻止 | 是 |
| adapter | `E_LOGOUT_TRIGGER_FAILED` | 退出动作无法执行（找不到入口） | 是 |
| adapter | `E_LOGOUT_TIMEOUT` | 退出后未观察到登出证据 | 是 |
| adapter | `E_STATE_UNKNOWN` | 无法判定登录态 | 是 |
| adapter | `E_LOGIN_REJECTED` | 命中登录失败标记（密码错误/账号禁用等） | 否（需改账号） |
| adapter | `E_VERIFY_TIMEOUT` | 超时仍无成功/失败证据 | 是 |
| adapter | `E_BLOCKED_CAPTCHA` / `E_BLOCKED_MFA` | 需人工处理，插件不得绕过 | 否 |
| flow | `E_CANCELLED` | 用户取消 | 是 |
| flow | `E_TIMEOUT` | 步骤级超时（`detail.step`） | 是 |
| flow | `E_INTERRUPTED` | SW 被回收导致中断 | 是 |
| flow | `E_NOT_IMPLEMENTED` | 阶段一 stub | 否 |
| internal | `E_INTERNAL` | 未捕获异常 | 是 |

错误构造规范：只允许 `detail` 携带白名单字段（`step`、`missing`、`elapsedMs`、`httpStatus` 等），`SerializedError` 由 `result.ts` 统一产出，禁止在 catch 中直接透出 `Error.message`（防泄漏页面内容或凭证）。

### 4.6 解耦如何被保证

1. **代码层**：`background/flow/*` 中只出现步骤名（`'detectLoginState' | 'logout' | ...`）与 `vendor` 字符串，不出现任何选择器常量或蓝凌 URL。
2. **数据层**：蓝凌专属字段全在 `adapters/landray/config.ts`，以 `adapterConfig` 不透明对象存于系统配置；background 只透传，不解释（仅 `configValidation` 做泛化的「必填键」检查）。厂商预设（`adapters/landray/preset.ts`）同样是**数据**，由 Options 在用户选择 OA 类型时展开为 `adapterConfig`，background 不 import。
3. **调用层**：Adapter 的能力差异通过 `capabilities` 声明，runner 不写 `if (vendor === 'landray')`。
4. **依赖层**：ESLint 规则禁止反向 import（见 1.1）；阶段一即生效。
5. **测试层**：状态机单测用「假 CS 客户端」覆盖所有分支，无需真实 OA 页面。

---

## 5. 数据模型

### 5.1 Storage key 规划

统一前缀 `oa.v1.`，全部存 `chrome.storage.local`（**绝不使用 `storage.sync`**，避免凭证密文上云）。

| key | 内容 | 说明 |
|---|---|---|
| `oa.v1.meta` | `{ schemaVersion: 1, installedAt, updatedAt }` | 迁移入口，读到低版本先跑 `migrations.ts` |
| `oa.v1.settings` | `Settings` | 全局设置 |
| `oa.v1.systems` | `OASystem[]` | OA 系统及其 adapter 配置 |
| `oa.v1.groups` | `AccountGroup[]` | 账号分组 |
| `oa.v1.accounts` | `Account[]` | 账号元数据（**无密码**） |
| `oa.v1.vault` | `VaultEnvelope` | 加密保险库（唯一密文） |
| `oa.v1.audit` | `AuditEntry[]`（上限 200 条，可关闭） | 仅非敏感元数据 |
| `chrome.storage.session` → `oa.v1.session.run` | `FlowStateSnapshot \| null` | 运行态快照 |

命名规则：`oa.{schemaMajor}.{domain}`；新增字段走同 key 内的 optional 字段 + `schemaVersion` 递增，禁止改 key 名（改 key 必须写迁移）。

### 5.2 账号 `Account`

```ts
interface Account {
  id: AccountId;              // 'acc_' + 12 位随机
  label: string;              // 展示名，1..32
  username: string;           // 登录用户名，1..128，不加密（非机密）
  systemId: SystemId;         // 所属 OA 系统
  groupId: GroupId | null;    // 分组，可空
  role: string | null;        // 角色描述（如「财务主管」），0..32，仅展示/筛选
  note: string | null;        // 备注，0..120
  enabled: boolean;           // 停用后不可选
  sortOrder: number;          // 列表排序（同组内）
  createdAt: string;          // ISO
  updatedAt: string;
}
```

校验规则：

- `(systemId, username)` 唯一（同一系统内不允许重复用户名，避免切换歧义）。
- `label` 必填且在同一系统内建议唯一（非强制，重复时 UI 提示）。
- 密码不在 `Account` 上；`account.create/update` 的 `password?` 字段在 service 层拆分：元数据进 `oa.v1.accounts`，密码进保险库（同一事务顺序：先写保险库成功 → 再写元数据；失败则回滚内存态并返回 `E_INTERNAL`）。

### 5.3 账号分组 `AccountGroup`

```ts
interface AccountGroup {
  id: GroupId;
  name: string;              // 1..24，唯一（忽略大小写）
  color: string | null;      // 预置色板 key，不存任意 CSS 值（防注入）
  sortOrder: number;
  collapsedByDefault: boolean; // Popup 默认折叠
  createdAt: string;
  updatedAt: string;
}
```

删除分组：`accounts` 中指向该分组的记录统一置 `groupId: null`（不级联删账号）；操作在同一个 `repo.update` 批次内完成。

### 5.4 OA 系统 `OASystem`

```ts
interface OASystem {
  id: SystemId;
  name: string;                       // 1..32，唯一
  vendor: 'landray' | 'other';        // 其他厂商仅占位，v1 不可用
  enabled: boolean;
  origins: string[];                  // 形如 'https://oa.example.com'，仅协议+主机（不含路径）
  loginUrl: string;                   // 登录页完整 URL（用户提供）
  homeUrl: string | null;             // 登录后主页 URL（用户提供，可留空）
  adapterConfig: AdapterConfig;       // 不透明对象，按 vendor 解释（见 6）
  permissionState: 'unknown' | 'granted' | 'denied';
  createdAt: string;
  updatedAt: string;
}
```

校验规则：`origins` 必须为 `https://` 或显式确认的 `http://`（内网）；不允许通配符主机；不允许含路径/查询。`loginUrl` 必须落在 `origins` 内。

### 5.5 全局设置 `Settings`

```ts
interface Settings {
  schemaVersion: 1;
  activeSystemId: SystemId | null;   // Popup 默认展示的系统
  autoLockMinutes: number;           // 默认 15，0 = 仅手动锁定（不推荐）
  lockOnBrowserStart: boolean;       // 默认 true（实际由 SW 生命周期天然满足）
  lockAfterSwitch: boolean;          // 默认 false：切换成功后是否立即丢弃密钥
  confirmBeforeSwitch: boolean;      // 默认 true：切换前二次确认（防误操作）
  theme: 'system' | 'light' | 'dark';// 默认 'system'
  auditEnabled: boolean;             // 默认 false
  debugLogging: boolean;             // 默认 false；开启也只输出脱敏字段
  preferredPopupGrouping: 'flat' | 'grouped'; // 默认 'grouped'
}
```

### 5.6 保险库 `VaultEnvelope`（structure only）

```ts
interface VaultEnvelope {
  schemaVersion: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; saltB64: string };
  cipher: { name: 'AES-GCM'; ivB64: string };
  aad: string;                 // 固定 'oa-switcher.vault.v1'
  ciphertextB64: string;       // 明文结构见 5.7
  createdAt: string;
  updatedAt: string;
}
```

### 5.7 保险库明文结构

```ts
interface VaultPlaintext {
  schemaVersion: 1;
  entries: Record<AccountId, { password: string }>;
}
```

- 单一密文承载全部密码：任何增删改都整库重新加密（新 IV），保证原子性，不存在「部分账号已更新」的中间态。
- 不存主密码派生结果；不存明文密码的副本。

### 5.8 数据迁移包 `TransferFile`

导出/导入复用同一份 JSON 结构，字段与校验实现见 `src/shared/types/transfer.ts`、`src/shared/transferPackage.ts`。

| 字段 | 说明 |
|---|---|
| `format` | 固定 `oa-switcher.transfer` |
| `version` / `schemaVersion` | 包格式版本 / 数据 schema 版本；高于当前支持值直接拒绝 |
| `exportedAt` / `appVersion` / `mode` | 导出时间、来源扩展版本、`full` \| `config` |
| `data.systems` / `accounts` / `groups` | 配置与账号元数据（不含明文密码） |
| `data.settings` / `data.float` | 偏好；导入时**本机优先**，只补本机缺失字段 |
| `vault` | 完整模式下原样携带的 `VaultEnvelope`；仅配置模式固定为 `null` |
| `integrity` | 各段条数与 SHA-256；导入先验完整性再写入 |

**导出**只读 `chrome.storage.local` 中的密文，不调用任何解密能力；文件里不会出现明文密码或主密码。

**导入**先构建内存合并计划，再通过一次 `chrome.storage.local.set` 原子写入全部 key：

- 不同 ID 直接并入；同 ID 由用户选择「覆盖」或「保留双方」（后者生成新 ID、重映射引用，并在预览中展示 `${name} → ${name}（导入）`）。
- 保险库分支：目标未初始化 → 接管信封（用来源主密码解锁）；已初始化且同密码 → 合并凭证；不同密码 → 拒绝合并，只能「只导入配置」或「清空本机保险库后导入（二次确认）」。
- 导入后重算 `activeSystemId`、清理失效 `rememberedSystems` 并重注册内容脚本。

**大文件例外**：`data.preview` / `data.import` 两条消息的 payload 上限从 32KB 放宽到 8MB（`TRANSFER_MAX_CONTENT_BYTES`），其余消息仍为 32KB；超限返回 `E_VALIDATION (reason: too-large)`，detail 携带实际大小与 `limit`。不做分片或长连接。

---

## 6. 安全设计

### 6.1 参数

| 项 | 取值 | 说明 |
|---|---|---|
| KDF | PBKDF2-HMAC-SHA-256 | Web Crypto 唯一可用的口令派生原语（无 Argon2id） |
| 迭代次数 | **600000**（默认写入信封；读取时允许 ≥ 100000 以兼容旧信封） | 对齐 OWASP 2023 对 PBKDF2-SHA256 的建议值；阶段二在本机测一次实际耗时并记录 |
| Salt | 16 字节随机（`getRandomValues`），每次「初始化/改主密码」重新生成 | 存于信封 |
| 对称算法 | AES-GCM 256 位，`deriveKey` 产出 `extractable: false` | 密钥不可导出 |
| IV | 12 字节随机，**每次加密重新生成**，禁止复用 | 存于信封 |
| AAD | 固定字符串 `oa-switcher.vault.v1` | 绑定格式版本，阻止跨版本移植 |
| 序列化 | `JSON.stringify` → UTF-8 → 加密；密文 base64 存储 | 见 `base64.ts` |

### 6.2 流程

初始化：

```
masterPassword (用户输入, popup 内 string)
  → salt = randomBytes(16)
  → key = PBKDF2(password, salt, 600000) → AES-GCM-256 (non-extractable, usages: encrypt|decrypt)
  → iv = randomBytes(12)
  → ct = AES-GCM-encrypt(key, iv, utf8(json(emptyVault)), aad)
  → 写 oa.v1.vault；key 保留在 SW 内存（不落盘）
```

解锁：读信封 → 用信封内 `salt/iterations` 重新派生 → 解密；**GCM 认证失败即视为主密码错误或数据被篡改**（两者在设计上不可区分，UI 统一提示 `E_MASTER_INVALID`，并提示「若确定密码正确，可能数据已损坏」）。

写入（新增/修改账号密码）：以内存 key + 新 IV 重新加密整个 `VaultPlaintext` → 覆盖写 `oa.v1.vault` → `updatedAt` 更新。写失败则保留旧密文（storage 单 key 写入具备整体性）。

锁定：丢弃 `CryptoKey` 引用与 `VaultPlaintext` 引用；把明文用过的 `Uint8Array` 显式 `fill(0)`；`vaultService` 状态置 `locked`。

### 6.3 密钥与明文生命周期

| 位置 | 明文出现形式 | 生命周期 | 缓解 |
|---|---|---|---|
| Popup 主密码输入框 | 用户键入的 string | 提交后立即清空 state；组件卸载不留值 | 不写入任何 storage；不进入 URL/日志 |
| 消息通道（popup→bg） | 主密码 string | 单次请求 | 走进程内 IPC，不落盘；refuse 在 detail/错误里回显 |
| Background 内存 | `CryptoKey`（不可导出） + 解密后的 `VaultPlaintext` | 仅解密瞬间；填完后尽快丢弃 `VaultPlaintext`（保留 key） | key 非可导出；SW 回收即自然清零 |
| 消息通道（bg→CS） | `{username, password}` | 仅 `oa.fillCredentials` 一次 | 请求带 runId，CS 只接受当前 run；`password` 字段不出现在任何日志/错误 detail |
| Content Script 内存 | password string | 填入 DOM 后立即丢弃引用，不留模块级变量 | JS string 无法可靠清零（GC 决定），这是本设计的**明确残余风险** |
| OA 页面 DOM | `<input>` 的 value | 由 OA 页面决定（插件不负责清理，提交后由页面跳转销毁） | 不在切换完成后主动清空（会破坏 OA 自身提交），阶段三实测确认 |

自动锁定：

- 记录 `lastUserActivityAt`（每次 UI 请求更新）。
- `chrome.alarms.create('vault:autolock', { periodInMinutes: 1 })`，每分钟检查 `now - lastUserActivityAt > autoLockMinutes` → 锁定。
- **SW 被回收时 key 随之消失**，等价于被动锁定；因此「自动锁定」是「最多 autoLockMinutes」的保证，而非「至少」。UI 需如实提示：SW 重启后可能需要重新解锁。
- 切换流程进行中：不因空闲锁定而中断（run 期间刷新 activity）；`lockAfterSwitch=true` 时在终态后立即锁定。

### 6.4 安全边界（诚实声明）

**能防：**

- 磁盘/备份/同步泄漏：`chrome.storage.local` 中只有密文，无明文密码（需主密码才能解密）。
- 简单的存储翻看：扩展 devtools 里看不到密码字段。
- 账号元数据与凭证分离：仅泄露元数据时不暴露密码。
- 误操作：切换前二次确认 + 仅用户手势触发，无快捷键/无自动切换。
- 权限过度：不申请全站 host 权限，仅用户配置的 OA 域名注入脚本。

**防不了（必须在 README/Options 明示）：**

- 主密码弱（如 6 位数字）时的**离线暴力破解**：PBKDF2 非内存硬，GPU/多核仍可加速。
- 浏览器已解锁且本机被控（恶意扩展、远控、内存转储、键盘记录、屏幕录制）：无法防。
- Content Script 注入后，页面自身脚本或恶意页面可读取已填入的密码字段（同一 DOM 世界）。
- OA 服务端日志、浏览器密码管理器、企业 DLP 对页面内容的采集。
- 验证码 / MFA / 设备指纹：**不绕过**，检测到即中止并提示人工处理（`E_BLOCKED_CAPTCHA` / `E_BLOCKED_MFA`）。
- 密码在 JS 内存中的字符串残留（GC 不可控）；`Uint8Array` 可清零，string 不可。
- 扩展被侧载篡改：若攻击者能改写扩展文件，即可直接读内存。

**不做的事：** 不记录 Cookie/Token/请求体；不代理 OA 登录请求；不 `fetch` OA 页面（避免绕过页面安全策略）；不将密码写入 `chrome.storage.session`/`sync`；不提供明文导出。导出功能若要做（阶段五），只能是「重新加密后的密文 + 主密码派生」格式。

### 6.5 日志与诊断

`log.ts` 提供 `log.info/warn/error`，接收结构化字段，内部用**键名黑名单**（`password`、`passwd`、`pwd`、`cookie`、`token`、`authorization`、`set-cookie`）做剔除后再输出。`debugLogging=false` 时只输出错误码与步骤名，不输出 URL 全量（URL 可能含 session id）→ 只输出 origin。

---

## 7. 蓝凌 OA Adapter 接口设计

> 本节**只定义接口与可配置键位**。所有键位默认为 `undefined`，未配置时 Adapter 必须返回 `E_CONFIG_MISSING` 并列出缺失键名。**不写入任何推测性选择器、退出地址或成功规则。**
>
> 唯一例外是厂商预设 `src/adapters/landray/preset.ts`：它是一份经过两个真实环境交叉校验的**数据模板**，
> 由 Options 在用户选择「OA 类型 = 蓝凌」时展开（`{origin}` 占位）并写入 `adapterConfig`，用户可逐项覆盖。
> 该文件是 `check-no-selectors` 的唯一豁免点：预设必须携带结构特征，且必须满足「相对写法、可覆盖、可自检、
> 可判定过期」。新增厂商预设同样需要至少两个真实环境的交叉校验证据。

### 7.1 分层

```
Background (不知 DOM)
   │ 命令：oa.detectLoginState / oa.logout / oa.waitForLoginPage / oa.fillCredentials / oa.submitLogin / oa.verifyLogin
   ▼
content/bridge.ts（校验 + 路由 + 错误包装）
   ▼
adapters/registry.ts  --vendor-->  adapters/landray/adapter.ts
   ▼
PageDriver（content/pageDriver.ts 提供，Adapter 只面向接口）
   ▼
真实 DOM / location
```

### 7.2 注入给 Adapter 的页面驱动接口

```ts
interface PageDriver {
  url(): string;
  title(): string;
  query<T extends Element>(selector: string): T | null;
  queryAll<T extends Element>(selector: string): T[];
  waitFor<T extends Element>(selector: string, opts: { timeoutMs: number; signal: AbortSignal }): Promise<T>;
  waitUntil(predicate: () => boolean, opts: { timeoutMs: number; pollMs: number; signal: AbortSignal }): Promise<void>;
  click(el: Element): Promise<void>;                 // 处理 disabled / 遮挡 / 事件派发
  setValue(el: Element, value: string): Promise<void>; // 原生 value setter + input/change/blur，兼容 React/Vue 受控组件
  submitForm(el: Element): Promise<void>;             // form.requestSubmit()，无 form 时退回 click
  navigate(url: string, opts: { signal: AbortSignal }): Promise<void>;
  sleep(ms: number): void;                            // 仅用于轮询间隔，不用于「等成功」
}
```

### 7.3 Adapter 接口

```ts
type OaVendor = 'landray' | 'other';
type LoginState = 'loggedIn' | 'loggedOut' | 'unknown';

interface Evidence { kind: string; detail: Record<string, string | number | boolean> }

interface LoginStateReport {
  state: LoginState;
  evidence: Evidence[];       // 命中了哪些规则；unknown 时为空
}

interface BlockerReport { blockedBy: 'captcha' | 'mfa' | null; evidence: Evidence[] }

interface LoginVerification {
  outcome: 'success' | 'failure' | 'unknown';
  evidence: Evidence[];
}

interface AdapterCapabilities {
  loginStateDetection: boolean;
  logout: boolean;          // 是否支持程序化退出（SSO 场景可能为 false）
  urlRuleMatching: boolean; // 是否支持 URL glob/regex 规则
  version: string;
}

interface AdapterContext {
  driver: PageDriver;
  config: LandrayAdapterConfig;
  timeouts: AdapterTimeouts;
  signal: AbortSignal;
}

interface OaAdapter {
  readonly vendor: OaVendor;
  readonly capabilities: AdapterCapabilities;

  /** 检查配置完整性；只做「键是否存在」的泛化检查，不解释语义 */
  validateConfig(config: unknown): { ok: true } | { ok: false; missing: string[] };

  /** 登录页识别：当前 URL/页面是否是该系统的登录页（以及登录表单是否已就绪） */
  detectLoginPage(ctx: AdapterContext): Promise<{ isLoginPage: boolean; formReady: boolean }>;

  /** 当前登录态：必须给出证据；无证据只能返回 unknown */
  detectLoginState(ctx: AdapterContext): Promise<LoginStateReport>;

  /** 检测阻断因素（验证码/MFA）；命中即中止，不尝试绕过 */
  detectBlockers(ctx: AdapterContext): Promise<BlockerReport>;

  /** 退出登录：点击入口或访问退出 URL，然后等待登出证据 */
  logout(ctx: AdapterContext): Promise<void>;

  /** 等待登录页可填（轮询就绪条件直至 deadline） */
  waitForLoginPage(ctx: AdapterContext): Promise<void>;

  /** 填写凭证（不得在此步骤提交） */
  fillCredentials(ctx: AdapterContext, cred: { username: string; password: string }): Promise<void>;

  /** 提交（不得在此步骤判定成功） */
  submitLogin(ctx: AdapterContext): Promise<void>;

  /** 轮询验证结果直至 deadlineAt；无证据返回 unknown，绝不默认成功 */
  verifyLogin(ctx: AdapterContext, opts: { deadlineAt: number }): Promise<LoginVerification>;

  /** 取消后清理已填写的表单字段（可选；只使用配置中的选择器，尽力而为） */
  clearCredentials?(ctx: AdapterContext): Promise<void>;
}
```

`registry.ts`：

```ts
const registry: Record<OaVendor, (cfg: AdapterContext['config']) => OaAdapter> = {
  landray: (cfg) => new LandrayAdapter(cfg),
  other: () => new UnsupportedAdapter(),   // 只预留接口
};
```

### 7.4 蓝凌 Adapter 可配置项（`LandrayAdapterConfig`）

全部字段 `optional`，默认 `undefined`，由用户在 Options 中填写（来自真实页面信息）。

| 键 | 类型 | 用途 | 缺失后果 |
|---|---|---|---|
| `schemaVersion` | `1` | 配置版本 | 有默认值 |
| `loginPageUrlPattern` | string（glob 或 `re:` 前缀正则） | 判定「当前是登录页」 | `E_CONFIG_MISSING` |
| `loginFormReadySelector` | string CSS | 登录表单就绪标记（如用户名输入框容器） | `E_CONFIG_MISSING` |
| `usernameFieldSelector` | string CSS | 用户名字段 | `E_CONFIG_MISSING` |
| `passwordFieldSelector` | string CSS | 密码字段 | `E_CONFIG_MISSING` |
| `submitTrigger` | `{ kind: 'formSubmit'; selector: string } \| { kind: 'click'; selector: string }` | 提交方式 | `E_CONFIG_MISSING` |
| `loggedInMarkerSelector` | string CSS | 「已登录才存在」的元素（状态判定与成功检测） | 状态判定缺证据→`unknown` |
| `loggedOutMarkerSelector` | string CSS | 「未登录才存在」的元素 | 同上 |
| `authenticatedUrlPattern` | string | 登录成功后 URL 规则（与 marker 任一命中即成功） | 成功检测仅靠 marker |
| `loginFailureMarkerSelector` | string CSS | 失败提示元素（密码错误等） | 失败只能靠超时→`E_VERIFY_TIMEOUT` |
| `logoutTrigger` | `{ kind: 'url'; url: string } \| { kind: 'click'; selector: string; confirmSelector?: string }` | 退出方式 | 已登录时无法自动退出 → `E_LOGOUT_TRIGGER_FAILED` |
| `loggedOutUrlPattern` | string | 退出后 URL 规则（登出证据） | 仅靠 `loggedOutMarkerSelector` |
| `captchaMarkerSelector` | string CSS | 验证码出现标记 | 检测不到 → 仅靠超时 |
| `mfaMarkerSelector` | string CSS | 二次验证出现标记 | 同上 |
| `currentAccountMarker` | string \| null | 「当前登录用户名所在元素」（可选，用于「是否已是目标账号」判断） | 不做身份判断，一律退出重登 |
| `timeouts` | `Partial<AdapterTimeouts>` | 覆盖默认步超时 | 用默认值 |
| `notes` | string \| null | 用户记录的适配备注 | — |

`AdapterTimeouts` 默认值（可在系统配置中覆盖）：

| 键 | 默认 | 说明 |
|---|---|---|
| `stateProbeMs` | 5000 | 登录态探测 |
| `logoutTriggerMs` | 5000 | 退出入口可点 |
| `logoutConfirmMs` | 15000 | 观察到登出证据 |
| `loginPageWaitMs` | 15000 | 登录页/表单就绪 |
| `fillMs` | 3000 | 填写完成 |
| `submitMs` | 5000 | 提交动作返回 |
| `verifyMs` | 20000 | 登录结果观测窗口 |
| `pollMs` | 300（250–1000） | 轮询间隔（**不是判定手段**） |

### 7.5 判定规则组合（`landray/rules.ts` 的语义，不写具体值）

- `detectLoginState`：按 `loggedInMarkerSelector` → `loggedOutMarkerSelector` → `loginPageUrlPattern` 顺序取证；命中多项且互相矛盾 → `unknown`（并记录矛盾证据）。
- `verifyLogin`：优先级 `loginFailureMarkerSelector` > `authenticatedUrlPattern` > `loggedInMarkerSelector`；同一轮中出现「失败标记」立即 `failure`；到达 `deadlineAt` 仍无证据 → `unknown`（runner 转 `E_VERIFY_TIMEOUT`）。
- `logout`：执行 `logoutTrigger` →
  - `kind: 'url'`：`navigate(url)` 后等待 `loggedOutUrlPattern` 或 `loggedOutMarkerSelector`；
  - `kind: 'click'`：点击（若有 `confirmSelector` 则等待并确认）后同上；
  - 等待期间若出现 `mfaMarkerSelector/captchaMarkerSelector` → 直接 `E_BLOCKED_*`。
- **禁止**：用固定 `sleep(3000)` 然后当作成功；`pollMs` 只用于控制轮询频率。

---

## 8. 待用户确认 / 需用户提供清单

### 8.1 必须由用户提供（阻塞阶段三）

| # | 需要的信息 | 默认处理（未提供时） | 影响 |
|---|---|---|---|
| Q1 | 蓝凌 OA 登录页 URL 与登录表单 DOM：用户名/密码输入框选择器、提交按钮选择器（或是否 form submit） | 不写任何值；Adapter 返回 `E_CONFIG_MISSING`，阶段三不产出可用适配 | 无法完成自动填写与提交 |
| Q2 | 登录成功判定依据：成功后 URL 形态（或是否跳到首页/工作台）、仅登录后存在的元素选择器 | 只用 URL 规则；无规则则不判定成功 | 成功检测不可靠，切换只能报超时 |
| Q3 | 登录失败提示：错误提示元素选择器及其出现条件 | 无失败检测，只能等超时 | 密码错误时反馈慢（约 20s） |
| Q4 | 退出登录方式：是否有「退出」按钮/菜单（多级？是否有二次确认）、或独立退出 URL | 不做退出，已登录时流程直接失败 | 无法实现「自动退出再登录」核心体验 |
| Q5 | 是否使用 SSO / 是否有验证码、MFA、短信验证 | 按「可能出现」处理，缺 marker 选择器则只能超时 | 命中 SSO 时自动切换不成立，需产品层面决策 |
| Q6 | 是否存在 iframe 内登录（登录表单在子 frame） | `allFrames: false`，仅顶层 frame | 若在 iframe 内则整套 CS 注入策略要改 |
| Q7 | 系统是否多套环境（测试/生产）共享同一域名不同路径 | 按 origin 匹配，多环境需各自配一条系统 | 多系统同源时需人工选择系统 |
| Q8 | 测试机器上的 OA 是否 http（内网非 TLS） | `origins` 允许显式 http 但会在 UI 标红提示 | 明文传输下插件无法保证凭证在网络层安全 |

### 8.2 需要产品决策（含默认建议）

| # | 问题 | 默认建议 | 若采纳其他方案的影响 |
|---|---|---|---|
| Q9 | 主密码解锁时机 | **懒解锁**：Popup 里点「切换」时才要求解锁；SW 重启后需重新解锁 | 启动即解锁体验好但密钥常驻内存更久；`lockAfterSwitch=true` 更安全但每次切换都要输密码 |
| Q10 | 多个 OA 系统匹配同一标签页时的识别策略 | 按 `origins` + `loginUrl` 路径最长匹配；**多命中让用户在 Popup 选择**（`E_SYSTEM_AMBIGUOUS` 前置为 UI 选择） | 自动猜测可能操作错系统，风险高 |
| Q11 | 当前已登录账号恰好是目标账号时 | v1 **仍执行退出→重登**（无身份探测手段前）；若用户提供 `currentAccountMarker` 则具备「已是目标则跳过」的能力（作为 P3 可选增强） | 跳过可省时间，但身份判定错误会导致「以为切了其实没切」 |
| Q12 | 密码在内存中的生命周期 | 仅在 `oa.fillCredentials` 一次性传递；填完立即丢弃；**不实现跨步骤缓存** | 缓存可减少解密次数，但扩大泄漏面 |
| Q13 | 账号分组展示方式 | Popup：分组**折叠列表**（默认展开当前系统全部分组）+ 搜索框；Options：表格管理 | 扁平列表更简单但账号多时难找；分组折叠需要额外交互状态 |
| Q14 | 是否记录切换历史 | 默认**关闭**；开启仅记录 `{time, accountId, systemId, result}`，不记 URL 全量 | 有助排查，但会留下使用痕迹 |
| Q15 | 关闭 Popup 是否中断进行中的切换 | **不中断**（仅显式取消/超时才终止），Popup 重新打开可看到实时状态 | 中断更符合直觉但容易误伤；不中断需 keepalive |
| Q16 | 自动锁定时间 | 15 分钟空闲 + SW 回收即锁 + 浏览器启动即锁 | 更长更省心但暴露窗口更大 |
| Q17 | 是否支持同一 OA 多账号并行（不同标签页各自登录） | **不支持**（共享 Cookie，切换即全局生效），UI 明示「切换会影响该 OA 的所有标签页」 | 支持需 Cookie 分区/隐身窗口等完全不同的架构，v1 明确排除 |
| Q18 | 包管理器与 Node 版本 | npm + Node ≥ 20，输出 `dist/` 可加载产物 | 用 pnpm 需统一 lockfile 与 CI |
| Q19 | 是否需要企业策略/商店分发 | v1 只做「加载已解压的扩展程序」；商店上架与更新机制留到阶段五 | 商店分发涉及隐私政策、审核、自动更新 |
| Q20 | 错误文案语言 | 简体中文单语（`messages.zh-CN.ts`），结构预留 i18n | 多语言需要 `_locales` 与消息键规范 |

### 8.3 已按约束自行决定、无需确认的项

- 不使用 `storage.sync`；不申请 `<all_urls>`；不引入第三方校验/状态管理库（只用 React + Tailwind + `@types/chrome` + Vitest）。
- 流程不做自动重试、不做定时切换、不做快捷键切换。
- 除 `src/adapters/<vendor>/preset.ts` 的厂商预设外，全部 OA 选择器配置化，代码中不出现任何具体选择器或站点专属 URL；预设本身也不含域名（URL 规则用 `{origin}` 占位）。

---

## 9. 阶段五：打包与交付

### 9.1 可分发目录与 zip 归档

`npm run package` 先执行完整构建，再由 `scripts/package.mjs` 从 `dist/` 按白名单复制到临时目录
`release/.staging-<version>`（过滤 `.map`、校验白名单/禁止内容），然后原子重命名为
**`release/oa-switcher-<version>/`**：该目录本身就是「加载已解压的扩展程序」可直接选择的交付物。
随后以该目录为源生成 `release/oa-switcher-<version>.zip`，仅作归档/传输，用户无需解压即可安装。

- 版本号来源：`package.json.version`，与 `manifest.json` 注入值一致。
- 包内白名单：`manifest.json`、`background.js`、`content.js`、`icons/`、`popup/`、`options/`、`assets/`。
- 必需文件：manifest、background、content、popup/options 的 `index.html`、四档图标。
- 禁止内容：`.map`、`.ts/.tsx`、`.log/.tmp`、`node_modules`、`__MACOSX`、`.DS_Store`。
- 白名单/必需/禁止规则集中在 `scripts/release-spec.mjs`，由 `package.mjs` 与 `check-package.mjs` 共用。
- `npm run check:package` 同时校验目录与 zip：必需文件、顶层入口白名单、无调试残留、
  manifest_version/版本号/入口/图标存在性；并断言目录与 zip 文件清单逐一相等，再用 `unzip -t` 做完整性测试。
- `.crx` 不作为交付格式：需要签名私钥，且 Chrome 仅允许商店来源的 crx，本地来源会被拦截。

### 9.1.1 可选固定扩展 ID

- `npm run key:generate` 生成 RSA-2048 密钥对：公钥写 `keys/extension-public-key.pem`（可随仓库保留），
  私钥写 `~/.oa-switcher/extension-private-key.pem`（600，仓库外，不打包）。
- `npm run package -- --pin-id`（或 `npm run build -- --pin-id`）通过 `OA_PIN_ID=1` 让
  `generate-manifest.mjs` 注入 `manifest.key`；`check-manifest` / `check-package` 用 `createPublicKey`
  （SPKI DER）校验并打印推导出的扩展 ID。
- 固定 ID 包单独产出为 `release/oa-switcher-<version>-pinned-id/` 与同名 zip，不覆盖普通包；
  `check:package` 会分别校验两种包，并断言固定 ID 包的 `manifest.key` 与仓库公钥一致。
- `npm run install:local [-- --pin-id] [-- --target <dir>]` 把发行目录铺到固定安装目录：
  只复制白名单文件并覆盖同名文件，不删除目标目录中的其它内容；不操作浏览器。
- **默认关闭**：启用会使扩展 ID 变更一次，已加载 profile 的配置读不到；迁移方式为旧 ID 导出 → 新 ID 导入。
- 启用后所有版本必须沿用同一把公钥，否则 ID 再次变化；私钥仅用于同 ID 的 crx/商店签名，
  丢失不影响「加载已解压」读取数据，但无法再以同一 ID 签名发布。


### 9.2 质量门

阶段五结束实际执行并通过：

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
npm run check:manifest
npm run package
npm run check:package
```

测试矩阵、异常处理审查与真实结果见 `docs/testing.md`。未接入 CI、未做 i18n（无明确必要性）。
