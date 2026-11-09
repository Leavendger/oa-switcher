# 阶段一实施计划（项目初始化 / MV3 / Popup / Background / Content Script 骨架）

> 前置：`docs/architecture.md` 已评审通过，且第 8.2 节中 **Q9、Q13、Q15、Q18** 有明确结论。  
> 本阶段**只搭骨架与契约，不实现任何真实 OA 登录逻辑，不实现保险库加解密，不写具体选择器**。

---

## 1. 阶段目标与范围

### 1.1 目标（可验证的成功定义）

阶段一结束时，应能下载 `dist/` 并在 Chrome 与 Edge 中加载，做到：

1. Popup 能打开，展示「未初始化 / 无账号 / 未配置系统」的空态，且**不报错**。
2. Options 能打开，展示配置分区（表单壳，字段可保存到本地）。
3. Background SW 正常注册，路由能响应 `app.bootstrap` / `settings.get` / `settings.update` / `flow.getState` / `flow.start`（后者返回 `E_NOT_IMPLEMENTED`）。
4. Content Script 能按**用户配置的域名**动态注入，并能响应 `content.ping`（返回 url/title/frame）。
5. 从 Popup 触发 `flow.start` 时，Popup 能通过端口收到 `failed(E_NOT_IMPLEMENTED)` 的状态快照并正确渲染。
6. 上述全部有单测覆盖 + `typecheck` / `build` / `check:manifest` 全绿。

### 1.2 明确不做（Out of Scope）

| 不在阶段一 | 归属阶段 |
|---|---|
| 账号/分组/系统的真实 CRUD 与表单校验完成度 | 阶段二 |
| PBKDF2 / AES-GCM / 保险库 / 主密码 UI 的真实逻辑 | 阶段二 |
| 蓝凌 Adapter 的 `detectLoginState/logout/fill/submit/verify` 实现 | 阶段三 |
| 完整切换状态机执行（真实步骤调用、超时、取消语义） | 阶段四 |
| 打包 zip、商店上架、CI、i18n 多语言、README 完整版 | 阶段五 |

阶段一允许「骨架里先返回 `E_NOT_IMPLEMENTED`」，但**不允许**为了让 UI 看起来完整而伪造成功状态（尤其是登录成功/锁定态）。

---

## 2. 前置决策（开工前需拍板）

| # | 决策 | 建议 | 阻塞谁 | 不决策的后果 |
|---|---|---|---|---|
| P0-1 | 构建方案 D1（Vite 三趟构建 vs `@crxjs/vite-plugin`） | 三趟构建 | T2 | 产物格式不合规，返工整个构建层 |
| P0-2 | 包管理器与 Node 版本（Q18） | npm + Node ≥ 20 | T1 | lockfile/脚本差异 |
| P0-3 | Popup 分组展示（Q13） | 分组折叠 + 搜索 | T8 | UI 结构返工（成本中等） |
| P0-4 | 关闭 Popup 是否中断切换（Q15） | 不中断 | T5/T8 | 端口与取消语义返工 |
| P0-5 | 是否同意「阶段一引入 mock 页面 `tests/fixtures/mock-oa.html` 用于验证注入」 | 同意（仅验证 ping，不含任何 OA 逻辑） | T6/T9 | 需真实 OA 才能验证 CS 注入 |
| P0-6 | 开发期调试方式（是否允许 `debugLogging` 默认开） | 开发默认关，问题排查时手动开 | T3 | 日志策略反复 |

> 除 P0-1/P0-2 外，其余若用户不特别回复，将按「建议」执行并在阶段一交付说明中标注为「暂定」。

---

## 3. 任务拆分

依赖顺序（自上而下，同级可并行）：

```
T1 仓库骨架
 └─> T2 构建管线（manifest 生成 + 产物自检）
      ├─> T3 shared 契约层（类型/信封/错误）
      │    ├─> T4 storage 骨架
      │    │    └─> T5 background 骨架  ─┐
      │    ├─> T7 adapters 骨架（纯类型+配置校验） ─┤
      │    └─> T8 Popup/Options UI 骨架 ───────────┤
      └─> T6 content 骨架（依赖 T3、T7） ───────────┤
                                                    └─> T9 单测 + fixture
                                                         └─> T10 验收（typecheck/build/manifest/双浏览器加载）
```

### T1 仓库骨架与工具链

产出文件：

- `package.json`（deps：`react`、`react-dom`、`vite`、`@vitejs/plugin-react`、`typescript`、`tailwindcss`、`postcss`、`autoprefixer`、`vitest`、`jsdom`、`@types/chrome`、`@types/react`、`@types/react-dom`、`eslint` + `typescript-eslint`）
- `tsconfig.json`：`strict: true`、`noUncheckedIndexedAccess: true`、`noUnusedLocals`、`noUnusedParameters`、`noImplicitOverride`、`verbatimModuleSyntax`、`skipLibCheck`；`types: ["chrome"]`
- `tsconfig.node.json`：仅覆盖 `vite.config.ts` / `vitest.config.ts` / `scripts` 的 Node 类型
- `eslint.config.js`：含 `no-restricted-imports` 的**模块依赖方向**规则（见 architecture 1.1）
- `tailwind.config.ts`、`postcss.config.js`、`vitest.config.ts`（node 环境 + jsdom 环境两个 project）
- `.gitignore`、`.editorconfig`

验证方式：

1. `npm ci` 后 `npx tsc -p tsconfig.json --noEmit` 退出码 0（此时仅少量文件）。
2. `npx eslint src` 退出码 0；且故意在 `src/background/__lint_probe.ts` 中 import `../../adapters/types` 时**必须报错**，验证后删除该探针文件。
3. `npx vitest run` 可执行（0 测试时退出码应为 0，若 Vitest 默认报 `No test files found`，需在配置中设置 `passWithNoTests: true`，阶段一只在 T9 前生效）。

### T2 构建管线与 manifest 生成

产出文件：

- `manifest.template.json`（字段见 architecture 3.2）
- `scripts/build.mjs`（Vite JS API 串行三趟 + 复制 icons + 调生成/自检脚本）
- `scripts/generate-manifest.mjs`（模板 + `package.json.version` → `dist/manifest.json`）
- `scripts/check-manifest.mjs`（断言表见 §5.4）
- `scripts/build-watch.mjs`（三趟 watch；不实现自动 reload 扩展）
- `public/icons/icon-16,32,48,128.png`
- `vite.config.ts`（导出「按 target 生成配置」的函数，供 build.mjs 调用）

验证方式：

1. `npm run build` 成功，`dist/` 结构与 §5.2 完全一致（脚本内自带结构断言）。
2. `node -e "const m=require('./dist/manifest.json'); console.log(m.manifest_version, m.background.service_worker)"` → `3 background.js`。
3. `dist/background.js` 与 `dist/content.js` 均满足：文件内**无顶层 `import`/`export`**（构建脚本用正则断言 `^import ` 与 `^export ` 计数为 0）、无 `import(` 动态导入。
4. `dist/manifest.json` 的 `version` 与 `package.json` 一致；人改为不一致时 `check:manifest` 必须失败（做一次负向验证）。

### T3 shared 契约层

产出文件：

- `src/shared/constants.ts`：`STORAGE_KEYS`、`SESSION_KEY`、`PORT_NAME`、默认超时表、`MAX_*` 长度限制
- `src/shared/types/ids.ts`、`account.ts`、`system.ts`、`settings.ts`、`flow.ts`、`errors.ts`、`messages.ts`
- `src/shared/messaging/protocol.ts`：`createRequest`、`createSuccess/createFailure`、`parseEnvelope`（手写守卫）、`isRequestOf(type)` 类型收窄
- `src/shared/messaging/client.ts`：`sendToBackground<T>()`（超时默认 10s、错误归一为 `SerializedError`）、`connectFlowPort()`
- `src/shared/messaging/server.ts`：`registerRoutes(handlers)`（类型安全的 handler 表 + 统一 try/catch → `E_INTERNAL`）
- `src/shared/result.ts`：`ok/fail`、`toFlowError`、`serializeError`（detail 白名单过滤）
- `src/shared/base64.ts`、`src/shared/log.ts`（脱敏日志）

验证方式：

1. `protocol.test.ts` 全绿（见 §5.3 用例 C1–C4）。
2. `tsc --noEmit` 0 错误；`messages.ts` 中任何 payload 类型不得包含 `Account` 全对象用于 fill（由单测断言键集合）。
3. `log.ts` 单测：传入 `{ password: 'x', url: 'https://oa/sessionid=1' }` 时输出不含 `x`，`url` 被裁成 origin。

### T4 storage 骨架

产出文件：

- `src/storage/keys.ts`（`oa.v1.*` 常量，唯一来源；`shared/constants.ts` 不重复定义 key）
- `src/storage/repo.ts`：`readSettings()`（带默认值）、`writeSettings(patch)`、`readSystems/readAccounts/readGroups()`（阶段一返回 `[]`）
- `src/storage/migrations.ts`：`ensureSchema()`（读写 `oa.v1.meta`，阶段一只写 `schemaVersion: 1`，迁移链为空）
- `src/storage/sessionRepo.ts`：`readRun()/writeRun()/clearRun()`（`chrome.storage.session`，带 try/catch 降级为内存 Map）

验证方式：

1. `keys.test.ts` 断言：所有 key 以 `oa.v1.` 开头、无重复、不含大写/空格。
2. `repo` 单测（用 `chrome.storage` 的假实现）：空存储读 settings 得到**完整默认值**；写入部分字段不影响其他字段。
3. 手动验证：Popup 修改主题 → 关闭重开 Popup → 值保持。

### T5 Background 骨架

产出文件：

- `src/background/index.ts`：`chrome.runtime.onInstalled`（初始化 meta、reconcile CS）、`onStartup`、`onMessage` 接入 `server.ts`；启动时读 session run，若为「非终态」→ 写 `failed(E_INTERRUPTED)`
- `src/background/router.ts`：路由表（阶段一：`app.bootstrap`、`settings.get/update`、`system.list/create/update/delete/pingActiveTab`、`flow.getState`、`flow.start`(stub)、`flow.cancel`(stub)、`permission.ensure`（真实检查 `chrome.permissions.contains`，未授权返回 `E_NO_PERMISSION`）
- `src/background/services/settingsService.ts`、`bootstrapService.ts`
- `src/background/flow/machine.ts`：**纯函数**状态机（迁移表 + `canTransition` + `transition`，不依赖 chrome API）
- `src/background/flow/runner.ts`：阶段一为「最小可跑」——`start()` → 迁移到 `resolving` → 立即 `failed(E_NOT_IMPLEMENTED)`；`cancel()` 实现；单飞与 runId 已生效
- `src/background/flow/snapshotStore.ts`：写 session + 去抖广播
- `src/background/contentRegistry.ts`：`reconcile()`（按 systems 生成/注销注册；阶段一无系统 → `unregister` 全部 + 无注册）
- `src/background/keepalive.ts`：run 非终态时每 20s `getPlatformInfo()`

验证方式：

1. `machine.test.ts` 覆盖 §4.3 迁移表的每一条（合法迁移成功、非法迁移返回 `E_INTERNAL` 且状态不变）。
2. 手动：扩展详情页 Service Worker 日志无未捕获异常；Popup 调 `flow.start` 收到 `failed(E_NOT_IMPLEMENTED)`；再次 `flow.start` 在终态后允许，非终态期间返回 `E_FLOW_BUSY`（可用 stub 延迟验证）。
3. SW 手动「终止」后，Popup 再打开能读到 `failed(E_INTERRUPTED)` 快照（验证 session 恢复）。

### T6 Content Script 骨架

产出文件：

- `src/content/index.ts`：注册 `chrome.runtime.onMessage` → `bridge.handle`；模块级只持有 in-flight 集合
- `src/content/bridge.ts`：信封校验 → `guards` 校验（top frame + 当前 runId）→ 分发给 `content.ping`（真实实现）/其他类型统一 `E_NOT_IMPLEMENTED`
- `src/content/guards.ts`：`isTopFrame()`、`runIdMatches()`、`originAllowed(url, systems)`
- `src/content/pageDriver.ts`：`url/title/query/queryAll/waitFor/waitUntil/click/setValue/submitForm/navigate/sleep` 的**通用实现**（不含任何 OA 选择器；`setValue` 用原生 setter + `input/change/blur`）
- `src/content/readyReporter.ts`：页面加载后上报 `content.ready`（仅 origin/title，不含查询串）

验证方式：

1. 用 `tests/fixtures/mock-oa.html`（经 `npm run serve:fixture` 起本地静态服务）配置一个测试系统 origin，扩展加载后刷新页面 → DevTools 控制台可见 CS 已注入；从 Popup/后台 `content.ping` 返回 `{ready:true, frame:'top'}`。
2. 在未配置 origin 的页面（如 example.com）确认**没有** CS 注入（`chrome.runtime.sendMessage` 无响应 → `E_CONTENT_UNAVAILABLE`）。
3. `pageDriver` 使用 jsdom 单测：`setValue` 触发 `input` 与 `change` 事件、`waitFor` 超时抛 `E_LOGIN_PAGE_TIMEOUT`（传参控制）。

### T7 Adapters 骨架

产出文件：

- `src/adapters/types.ts`（`PageDriver`、`OaAdapter`、`AdapterContext`、能力位、`AdapterTimeouts`）
- `src/adapters/registry.ts`、`src/adapters/unsupported.ts`
- `src/adapters/configValidation.ts`：通用「必填键检查」→ `{ ok:false, missing: string[] }`
- `src/adapters/landray/config.ts`：键位定义 + `DEFAULT_LANDRAY_TIMEOUTS` + `REQUIRED_KEYS`（**值全为 `undefined`**）
- `src/adapters/landray/adapter.ts`：全部方法体 `throw new FlowError('E_NOT_IMPLEMENTED')`（阶段三实现），`validateConfig` 已可用
- `src/adapters/landray/rules.ts`：空壳导出（阶段三实现组合优先级）

验证方式：

1. `configValidation.test.ts`：空配置 → `missing` 恰好等于 `REQUIRED_KEYS` 且顺序稳定；补齐键 → `ok:true`。
2. `registry.test.ts`：`other` → `E_SYSTEM_UNSUPPORTED`；`landray` → 实例方法齐全。
3. 代码审查断言：`grep` `src/` 中不存在 `input[name=`、`#username`、`logout` 之类的具体选择器/URL 常量（构建脚本加入一条简单正则自检，避免回填）。

### T8 Popup / Options UI 骨架

产出文件：

- `src/popup/index.html`、`main.tsx`、`App.tsx`、`components/{AccountList,SwitchButton,FlowStatus,VaultGate}.tsx`、`hooks.ts`
- `src/options/index.html`、`main.tsx`、`App.tsx`、`sections/{SystemsSection,AccountsSection,GroupsSection,SecuritySection}.tsx`
- `src/ui/{styles.css,Button,Field,Modal,Toast}.tsx`
- `src/errors/messages.zh-CN.ts`（错误码 → 文案，**唯一**映射点）

阶段一 UI 行为（明确空态）：

- Popup 顶部：当前系统名（未配置显示「未配置 OA 系统」）+ 保险库状态（固定显示「未初始化」，并标注「阶段二接入」）。
- 账号区：空态插画 + 「前往设置添加账号」按钮（打开 Options）。
- 切换按钮：无账号/无系统/未解锁时 `disabled`，并给出禁用原因。
- 触发切换（stub）后：`FlowStatus` 显示状态流与错误码文案，含「重试」按钮（重试即再次 `flow.start`）。
- Options：四个分区可切换，表单字段可编辑，「保存」调用 `settings.update` / 系统配置写入（阶段一仅系统与设置真实落盘；账号分区为只读空态）。
- 所有错误均通过 `messages.zh-CN.ts` 渲染，不允许在组件里写死原始 `error.message`。

验证方式：

1. 手动：Popup 在 `chrome://extensions` 与 `edge://extensions` 加载后均能打开，无 CSP 报错、无 inline script 报错。
2. 键盘可达：Tab 顺序合理，`disabled` 按钮有 `aria-disabled` 与原因文案；分辨率 360×600 下无横向滚动。
3. 组件单测（jsdom）：`SwitchButton` 在三种禁用条件下均 `disabled` 且 `title` 文案正确；`FlowStatus` 对 6 个错误码渲染对应中文文案（不出现 `E_` 原文）。
4. 深色模式：`prefers-color-scheme: dark` 下文字对比度 ≥ 4.5:1（目测 + Tailwind token 审查）。

### T9 单测与 fixture

产出文件：

- `tests/unit/{protocol,machine,keys,configValidation,registry}.test.ts`
- `tests/unit/{log,repo,pageDriver}.test.ts`
- `tests/fixtures/mock-oa.html`（**纯静态、无任何 OA 相关类名语义**，仅用于 ping 验证）
- `tests/helpers/chromeMock.ts`（`chrome.storage.local/session` 的内存假实现）
- `vitest.config.ts`：单 `jsdom` 环境（阶段一全部用例均可在 jsdom 运行），`passWithNoTests: false`

验证方式：`npm test` 全部通过，且**每个测试文件至少 1 个断言**（用 `--reporter=verbose` 核对文件名列表）。

### T10 验收与最小 README

产出文件：

- `README.md`（**阶段一最小版**：环境要求、`npm ci`、`npm run build`、Chrome/Edge 加载 `dist/` 的步骤、已知限制「阶段一为骨架」）
- 交付说明（在最终回复中给出，不单独建文档）

验证方式：按 §5 全量跑一遍并留存命令输出。

---

## 4. 阶段内契约冻结清单（冻结后才进入阶段二）

以下内容一旦冻结，阶段二/三/四只能**新增**，不得重命名：

1. `STORAGE_KEYS` 的 key 名与结构（`meta/settings/systems/groups/accounts/vault/audit` + session 的 `oa.v1.session.run`）。
2. 消息信封字段（`kind/id/type/payload/createdAt` 与 `ok/data/error`）。
3. `ErrorCode` 枚举全集（含 architecture 4.5 全部项）。
4. `FlowState` 九个状态名与迁移表。
5. `OaAdapter` 方法签名与 `LandrayAdapterConfig` 键名（键名可增，不可改）。
6. `PORT_NAME = 'oa-switcher:flow'` 与 `SESSION_KEY = 'oa.v1.session.run'`。

冻结方式：在 `docs/architecture.md` 顶部追加「已冻结（日期）」标记；变更需在文档记录原因。

---

## 5. 阶段完成验收口径

### 5.1 类型检查

```bash
npm run typecheck     # tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit
```

通过标准：

- 两个命令退出码 0，输出无 `error TS`。
- 不出现 `// @ts-expect-error` 或 `as any` 在 `src/shared/**`、`src/storage/**`（CI 用 `grep` 断言；`as any` 全仓上限 3 处且必须带理由注释）。
- 不允许 `strictNullChecks` 关闭、不允许 `skipLibCheck` 之外的宽松项。

### 5.2 构建

```bash
npm run build
```

通过标准：`dist/` 必须**恰好**包含以下结构（多出 `*.map` 仅当 `dev` 构建）：

```
dist/
├── manifest.json
├── background.js          # 单文件、无 import/export 语句
├── content.js             # 单文件、无 import/export 语句
├── popup/index.html
├── options/index.html
├── assets/                # UI 的 js/css，文件名带 hash
└── icons/{icon-16,icon-32,icon-48,icon-128}.png
```

附加断言（写在 `build.mjs` 内，失败即非 0 退出）：

- `background.js` / `content.js` 行首 `import `/`export ` 计数为 0。
- 两个 HTML 的 `<script src>` 均为相对路径（以 `./`、`../` 或 `assets/` 开头），不含 `http://` / `https://`。
- `dist` 中不存在 `**/*.ts` 源文件；不存在 `eval(`。

### 5.3 单元测试

```bash
npm test      # vitest run --reporter=verbose
```

必须存在且通过的最小用例集：

| 文件 | 用例 | 断言要点 |
|---|---|---|
| `protocol.test.ts` | C1 合法请求解析 | 返回 `kind:'req'` 且类型收窄正确 |
| | C2 缺 `id`/`type` 的请求 | 拒绝，不进入 handler，返回 `E_VALIDATION` |
| | C3 未知 type | 拒绝 |
| | C4 超长 payload（>32KB） | 拒绝 |
| `machine.test.ts` | 迁移表 12 条合法迁移 | 终态正确、`runId` 不变 |
| | 5 条非法迁移（如 idle→filling） | 抛错且原状态不变 |
| | 任意态 `CANCEL` | → `cancelled` |
| `keys.test.ts` | 前缀/唯一/命名 | 6 个 key 全 `oa.v1.` |
| `configValidation.test.ts` | 空配置 | `missing` = 必填键全集 |
| | 缺 2 个键 | `missing` 仅这 2 个 |
| `registry.test.ts` | `other` / 未知 vendor | `E_SYSTEM_UNSUPPORTED` |
| `log.test.ts` | 敏感键剔除 + URL 裁剪 | 输出无 password、无查询串 |
| `repo.test.ts` | 空存储读默认值 / 部分更新 | 默认值完整、不覆盖其他字段 |
| `pageDriver.test.ts`（jsdom） | `setValue` 事件 / `waitFor` 超时 | `input`+`change` 触发；超时错误码正确 |

通过标准：`Tests  N passed`、`0 failed`，且 `N ≥ 14`。

### 5.4 manifest 与扩展配置检查

```bash
npm run check:manifest
```

`check-manifest.mjs` 必须断言（任一失败即非 0 退出，并打印具体失败项）：

| # | 断言 | 期望 |
|---|---|---|
| M1 | `manifest_version` | `3` |
| M2 | `name` / `version` / `description` | 存在；`version` 与 `package.json` 完全一致 |
| M3 | `background.service_worker` | `background.js`，且**无** `type: "module"` |
| M4 | `action.default_popup` | `popup/index.html` |
| M5 | `options_ui.page` | `options/index.html`（`open_in_tab: true`） |
| M6 | `permissions` | 全集 ⊆ `{storage, scripting, alarms}`（超出即失败，防止静默扩权） |
| M7 | `host_permissions` | `[]`（禁止全站权限） |
| M8 | `content_scripts` | `[]`（动态注册，禁止静态声明） |
| M9 | `optional_host_permissions` | 存在且仅 `http(s)://*/*` |
| M10 | `icons` / action icons | 16/32/48/128 均存在且文件真实在 `dist/` |
| M11 | 所有 manifest 内引用的路径 | 文件在 `dist/` 中存在（`popup/index.html`、`options/index.html`、`background.js`、icons） |
| M12 | 无 `web_accessible_resources`、无自定义 CSP、无 `content_security_policy` | 通过 |
| M13 | `minimum_chrome_version` / `minimum_edge_version` | `minimum_chrome_version` 为 `116`（Chrome/Edge 共用）；不写 `minimum_edge_version`，避免 Chrome 对未知键告警 |
| M14 | 产物内不含 `eval(`、`new Function(` | 通过 |

### 5.5 手动冒烟（必须双浏览器各跑一遍）

Chrome（`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `dist`）：

1. 扩展详情页无错误徽标；Service Worker 状态为「激活」。
2. 点 Popup：空态 + 禁用原因文案；无 console 报错。
3. Options：切换四个分区；改主题并保存 → 重开 Popup 生效。
4. 配置一个测试系统（origin = `http://localhost:5173`，`loginUrl` 指向 fixture）→ 保存 → SW 日志出现 `registered content script` 且 id 含 system id。
5. 打开 fixture 页面（`npm run serve:fixture`）→ 刷新 → Popup 显示「已检测到页面」（ping 成功）；`example.com` 上 ping 返回 `E_CONTENT_UNAVAILABLE`。
6. 点 Popup 的「触发流程自检」（阶段一无账号，切换按钮按设计禁用）→ `FlowStatus` 显示 `resolving → failed`，文案为「阶段一未实现」，带「重试」。
7. 在扩展详情页点「终止」SW → 重开 Popup → 显示 `E_INTERRUPTED` 快照（若上次为终态则显示该终态）。

Edge（`edge://extensions`）：重复 1–7。差异点需记录到交付说明。

通过标准 = 7 项全部符合预期 + 两份浏览器各自留存截图或终端记录（截图放 `docs/` 下不提交也可以，交付说明里给出结论即可）。

---

## 6. 风险与应对

| 风险 | 表现 | 应对 |
|---|---|---|
| Vite HTML 输出路径偏移 | 生成的是 `dist/src/popup/index.html`，manifest 引用 404 | T2 用 `root: 'src'` + 结构断言，构建期即失败 |
| Popup 打开白屏（CSP） | 控制台报 `Refused to execute inline script` | 全部脚本外链；禁止 `dangerouslySetInnerHTML` 注入脚本 |
| 单文件约束被破坏 | content.js 内出现 `import "./x"` | `inlineDynamicImports` + 构建断言（§5.2） |
| Tailwind 类未生效 | 样式丢失（构建产物 CSS 很小） | `tailwind.config.ts` 的 `content` 覆盖 `src/**/*.{ts,tsx,html}`；Options/Popup 结构断言 |
| SW 立即休眠导致调试困难 | 日志断点丢失 | 开发期用扩展详情页的「Service Worker」直接打开控制台；不在业务代码加 `setInterval` 保活 |
| `chrome.*` 类型与 Edge 差异 | 类型通过但运行时 API 缺失 | 只用 `storage/scripting/alarms/runtime/permissions`；T10 双浏览器冒烟 |
| 端口广播导致 Popup 抖动 | 连续迁移触发多次渲染 | `snapshotStore` 50ms 去抖 + React 层按 `runId+state+updatedAt` 去重 |
| 动态注册失败（权限未授予） | `registerContentScripts` 抛错 | `reconcile()` try/catch，失败记 `permissionState:'denied'`，UI 提示需授权，不阻塞其他系统 |

---

## 7. 阶段一 → 阶段二交接物

1. `docs/architecture.md` 标注「契约已冻结」。
2. `dist/` 可加载产物 + 冒烟结论（双浏览器）。
3. 全部单测与三个命令的输出记录。
4. 未决项清单（P0-3/P0-4 若采默认值，需在此明确）。
5. 阶段二入口：`vaultService.ts`、`crypto/*`、账号/分组真实 CRUD（此时才允许写 `oa.v1.vault`）。
