# OA Switcher

Chrome / Edge（Chromium）扩展，用于在多个 OA 账号之间快速切换。当前仅实现**蓝凌 OA** 的配置驱动适配；
除厂商预设外，所有页面选择器、登录页/退出地址、成功判定规则都由用户在设置页填写。
新建系统时可直接选择「OA 类型 = 蓝凌」套用厂商预设（已在两个独立环境交叉校验，可逐项覆盖）。
仓库里的构建期检查 `scripts/check-no-selectors.mjs` 只允许 `src/adapters/<vendor>/preset.ts` 携带站点结构特征，
其余 `src/adapters/**` 与 `src/content/**` 仍禁止写入具体选择器或域名；预设本身只用 `{origin}` 相对写法，
不含任何真实域名 / IP。

- Manifest V3，无后端、无云端同步、不代理登录请求。
- 密码以整库单密文保存在 `chrome.storage.local`，主密码只在扩展后台内存中派生密钥。
- 切换流程：校验账号/系统 → 检查保险库 → 探测登录态 →（已登录时）退出 → 等待登录页 → 填写 → 提交 → 验证 → 反馈。
- 任何一步没有明确证据都会失败并给出错误码与中文提示，不会把「没有报错」当作成功。

## 环境要求

- Node.js >= 20
- npm
- Chrome / Edge（Chromium >= 116）

## 安装

仓库只提交源码，**不提交构建产物**（`dist/`、`release/` 均在 `.gitignore` 中），因此克隆后不能直接加载。
选一种方式拿到可加载的文件夹：

**方式 A：下载 Release 附件（推荐给只想使用的用户）**

1. 打开本仓库的 Releases 页面，下载 `oa-switcher-<version>.zip`。
2. 解压得到一个包含 `manifest.json` 的文件夹（即 zip 的根层，不要再多套一层目录）。
3. 打开 `chrome://extensions`（Edge 用 `edge://extensions`），开启右上角「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择上面那个**包含 `manifest.json` 的文件夹**（不是它的上级目录，也不是 zip 本身）。

**方式 B：自行构建（推荐给要改代码的用户）**

```bash
npm ci
npm run build          # 产物在 dist/
npm run package        # 重新构建，产出 release/oa-switcher-<version>/ 目录 + 同名 zip 归档
```

然后按方式 A 的第 3–4 步加载 `release/oa-switcher-<version>/` 这一层目录。

**首次使用**：点开扩展 Popup → 设置主密码初始化保险库 → 在「设置」新增 OA 系统并点「授权域名」
（浏览器会弹出域名授权确认）→ 打开该 OA 页面 → 在 Popup 选择账号并点「切换账号」。
保险库锁定或浏览器重启后，切换前会要求先解锁。

### 关于「拖拽安装」

在 Chrome 156（macOS；stable 156.0.8078.80 与 Chrome for Testing 156.0.8078.4）实测：

- 页面存在文件夹拖放的内部处理链路：拖入时会调用 `developerPrivate.loadUnpacked({ useDraggedPath: true })`，
  控制台可见 `No current drop data` / `No dragged path`。
- 但本地自动化（程序化拖放与原生 CGEvent 拖拽）**未能完成一次真实的用户级拖拽安装**，未取得「拖入即安装成功」的证据。
- Chrome 官方文档也只提供「加载已解压的扩展程序」。

因此文档**不宣称支持拖拽**，请按上面第 2 步操作；如你手动拖入成功，也应先开启开发者模式，且拖入的是**文件夹**而非 zip。

### 为什么没有 `.crx`

`.crx` 需要签名私钥，且 Chrome 只允许从 Chrome Web Store 安装的 crx；本地/第三方来源的 crx 会被拦截
（`CRX_REQUIRED_PROOF_MISSING` 等）。本扩展不经过商店，因此**不提供 crx 分发**，统一用「加载已解压」。

## 构建与打包

```bash
npm ci
npm run build          # 产物在 dist/
npm run package        # 重新构建，产出 release/oa-switcher-<version>/ 目录 + 同名 zip 归档
npm run check:package  # 校验目录与 zip 的文件白名单、manifest、图标与入口，并比对两者清单一致
```

交付目录与 zip 的根层只包含 `manifest.json`、`background.js`、`content.js`、`icons/`、`popup/`、
`options/`、`assets/`；不含 source map、测试、`node_modules`、临时脚本、日志或 `.DS_Store`。

更新扩展后，已打开的 OA 页面需要刷新一次，内容脚本才会使用新版本。

### 固定扩展 ID（可选，默认关闭）

未设置 `manifest.key` 时，未打包扩展的 ID 由**加载目录的绝对路径**推导：换机器或换目录后 ID 会变，
`chrome.storage.local` 里的系统/账号配置读不到。需要跨机器、跨目录保持 ID 时：

```bash
npm run key:generate      # 生成一对 RSA 密钥
npm run package -- --pin-id   # 构建时把公钥写入 manifest.key
```

- 公钥写入仓库内 `keys/extension-public-key.pem`；私钥写入**仓库外** `~/.oa-switcher/extension-private-key.pem`
  （权限 600，不参与「加载已解压」，不要提交或分发）。本方案只需要公钥与私钥的配对关系，
  私钥仅在未来签名/商店发布时才会用到。若仓库中已存在该公钥，`key:generate` 会拒绝覆盖，
  直接执行 `npm run package -- --pin-id` 即可。
- **默认不启用**：一旦启用，扩展 ID 会变更一次，现有 profile 的旧配置将读不到；请先在旧 ID 下
  「设置 → 数据与迁移」导出，再用新 ID 加载后导入。
- 长期固定 ID 时，`keys/extension-public-key.pem` 需要随仓库保留（它决定 ID）；私钥务必自行备份，
  丢失后无法再以同一 ID 签名发布。

## 使用说明

### 1. 初始化保险库

打开扩展 Popup，首次切换时会要求设置主密码（至少 8 位）。主密码用于派生 AES-GCM 密钥，
后续新增/修改账号密码、解锁保险库都需要它。忘记主密码无法恢复密文中的密码。

### 2. 配置 OA 系统

在「设置」页的「OA 系统」中新增：

- **名称**：用于 Popup 展示。
- **厂商**：目前只有「蓝凌（landray）」可用，「其他」仅预留接口。
- **域名 origin**：每行一个，只填协议 + 主机 + 端口，如 `https://oa.example.com`，不要带路径。
- **登录页 URL**：必须与上面的 origin 一致。
- **首页 URL**：可选。
- **启用**：启用后才会动态注册内容脚本。

保存后在列表中点击「授权域名」并在浏览器权限弹窗中确认。未授权时切换会失败并提示 `E_NO_PERMISSION`。
授权完成后刷新 OA 页面。

### 3. 配置账号与分组

- 「账号」区新增账号：标签、用户名、所属系统、分组、角色、备注、启用状态、密码（可选）。
- 密码写入需要先解锁保险库；不填密码也可以先创建元数据，之后编辑时再补充。
- 同一系统内 `(系统, 用户名)` 必须唯一。
- 「分组」区可创建分组、调整排序、设置 Popup 默认折叠。
- 删除账号时会移除元数据；保险库已解锁时同时删除对应密码条目，锁定状态下保留孤儿条目（不强行解密）。

### 4. 切换账号

1. 在 Popup 顶部确认当前系统，选择目标账号。
2. 点击「切换账号」。若保险库锁定，会先要求解锁；若开启了「切换前确认」，会弹出确认框。
3. 状态区实时展示当前步骤、耗时与失败原因；可随时点击「取消切换」。
4. 关闭 Popup 不会中断切换；重新打开可继续查看进度。

**前提**：当前窗口的活动标签页必须属于目标系统已配置的 origin。切换会影响该 OA 在浏览器中的所有标签页
（同域共享 Cookie）。

### 5. 数据导出 / 导入

在「设置 → 数据与迁移」中操作，用于在两个浏览器之间搬迁整套配置。

- **完整（默认）**：包含系统、账号元数据、分组、偏好与保险库密文信封；在新浏览器导入后，用**来源浏览器的主密码**解锁即可。导出过程不解密，文件里没有明文密码，也没有主密码。
- **仅配置**：不含保险库信封，导入后账号存在但没有密码，需要重新设置。
- **导入是合并，不是覆盖**：
  - 不同 ID 直接并入；同 ID 让你在预览里选择「覆盖」或「保留双方」。
  - 保留双方会生成新 ID，并在预览中显示「将重命名为 `X（导入）`」，执行前可见。
  - `settings` 与悬浮球偏好按**本机优先**合并：只补本机缺失项，不覆盖已有值；`activeSystemId` 与 `rememberedSystems` 按导入后的实际数据重算，指向不存在的系统会回退或清理。
  - 版本高于当前扩展、格式或校验失败会拒绝导入，并指出具体段；任何失败都不写存储，不会只导入一半。
- **保险库冲突**：目标未初始化时接管导入信封；已初始化且同密码可合并凭证；密码不同时拒绝合并，只能「只导入配置」或「清空本机保险库后导入（需二次确认）」。
- **大文件**：导入文件上限 8MB（仅 `data.preview` / `data.import` 两条消息例外，其余消息仍为 32KB）；超限会提示实际大小与上限。
- 导出文件含凭证密文，请按机密文件保管；导入完成后建议删除导出的 JSON。

## 蓝凌适配配置

在「OA 系统」列表点击「编辑」，在「蓝凌适配配置」中按真实页面填写。全部留空即视为未配置。

### 必需项（缺失时直接报 `E_CONFIG_MISSING`，不会猜测）

| 配置项 | 字段 | 说明 |
|---|---|---|
| 登录页 URL 规则 | `loginPageUrlPattern` | 当前页面是否登录页；支持完整 URL、glob（`*` / `?`）或 `re:` 前缀正则 |
| 登录表单就绪标记 | `loginFormReadySelector` | 登录表单可填写时存在的 CSS 选择器 |
| 用户名输入框 | `usernameFieldSelector` | 用户名输入框选择器 |
| 密码输入框 | `passwordFieldSelector` | 密码输入框选择器 |
| 提交方式 | `submitTrigger` | `{ kind: 'formSubmit' \| 'click', selector }` |
| 退出方式 | `logoutTrigger` | `{ kind: 'url', url }` 或 `{ kind: 'click', selector, confirmSelector? }`；点击入口在该页面不存在时，蓝凌适配器会兜底访问同源 `/logout.jsp` |

### 状态与验证相关

| 配置项 | 字段 | 缺失后果 |
|---|---|---|
| 已登录标记 | `loggedInMarkerSelector` | 状态判定缺少证据，可能返回 `E_STATE_UNKNOWN` |
| 未登录标记 | `loggedOutMarkerSelector` | 退出后只能靠 URL 规则确认 |
| 登录成功 URL 规则 | `authenticatedUrlPattern` | 与「已登录标记」同等有效，两者都缺时会返回 `E_STATE_UNKNOWN` |
| 登录失败提示 | `loginFailureMarkerSelector` | 密码错误只能等验证超时 |
| 退出后 URL 规则 | `loggedOutUrlPattern` | 退出确认依赖未登录标记 |
| 验证码标记 | `captchaMarkerSelector` | 检测到验证码时中止（`E_BLOCKED_CAPTCHA`）；未配置则只能超时 |
| MFA 标记 | `mfaMarkerSelector` | 检测到二次验证时中止（`E_BLOCKED_MFA`）；未配置则只能超时 |
| 当前账号标记 | `currentAccountMarker` | 不识别当前账号身份，一律退出重登 |

> 验证阶段至少要配置 `loginFailureMarkerSelector`、`authenticatedUrlPattern`、`loggedInMarkerSelector`
> 中的一项，否则会直接返回 `E_CONFIG_MISSING`。验证只认成功证据；到截止时间仍无证据按 `E_VERIFY_TIMEOUT` 失败。

### 超时

默认单步超时：校验 10s、探测 12s、退出 30s、等待登录页 20s、填写 12s、提交 10s、验证 30s，
流程总截止 90s。系统配置中的 `timeouts`（`stateProbeMs`、`logoutTriggerMs`、`logoutConfirmMs`、
`loginPageWaitMs`、`fillMs`、`submitMs`、`verifyMs`、`pollMs`）会在运行时传给适配器；
非正数或超过 120s 的值会被忽略并回落到默认值，流程级单步上限仍受上述值约束。
设置页暂未提供超时编辑入口，预设已给出默认值。

### 厂商预设（蓝凌）

新建系统时选择「OA 类型 = 蓝凌」，会按预设一次性填充登录页、表单、提交、登录态、失败提示、退出入口/二次确认、
退出后 URL 与 URL 签名等字段；保存后仍可在「编辑」里逐项覆盖。预设集中存放在
`src/adapters/landray/preset.ts`，全部 URL 规则使用 `{origin}` 占位（不包含任何具体域名/IP），
且只收录「在两个真实环境都命中」的规则。

保存后对系统点「自检」会逐项列出配置在该站点的命中数量；若配置来自预设且当前登录态下应有字段未命中，
会明确提示「预设可能已过期」，而不是显示成功。

**`check-no-selectors` 的豁免范围**：构建期脚本只允许 `src/adapters/<vendor>/preset.ts` 写具体选择器，
其余 `src/adapters/**` 与 `src/content/**` 仍严格禁止。理由：厂商预设的价值就是携带站点结构特征，
无法只用通用规则表达；同时预设必须满足「相对写法（`{origin}`）、可被用户逐项覆盖、可通过自检验证命中数、
可随站点版本变化被判定为过期」四条约束。任何新增预设都必须经过至少两个真实环境的交叉校验。

## 安全边界

**设计上能防：**

- 磁盘/备份泄漏：`chrome.storage.local` 中只有密文，没有明文密码。
- 账号元数据与凭证分离：仅拿到账号列表不会暴露密码。
- 过度授权：不申请全站权限，只对用户配置并授权的 OA 域名注入内容脚本。
- 误操作：默认切换前二次确认；只由用户手势触发，无自动/定时切换。
- 日志泄漏：日志按敏感键名脱敏（password/cookie/token 等），URL 只保留 origin。

**无法防（使用前请知悉）：**

- 主密码过弱导致的离线暴力破解（PBKDF2 不是内存硬算法）。
- 浏览器已解锁且本机被控：恶意扩展、远控、内存转储、键盘记录、屏幕录制。
- 内容脚本注入后，页面自身脚本能读到已填入的密码字段（同 DOM 世界）。
- OA 服务端日志、企业 DLP、浏览器密码管理器对页面内容的采集。
- 验证码 / MFA / SSO：插件不会绕过，检测到即中止。
- 密码字符串在 JS 内存中的残留（GC 不可控）；本设计已尽量缩短生命周期。
- 扩展文件被篡改：能改扩展文件即可读内存。

**明确不做：** 不记录 Cookie/Token/请求体；不代理或重放登录请求；不 `fetch` OA 页面；不把密码写入
`storage.session` / `storage.sync`；不提供明文导出。

## 已知限制

- 除蓝凌厂商预设外，仓库不包含真实站点选择器；未提供真实页面信息前无法完成自动切换，只会得到 `E_CONFIG_MISSING`。
- 仅操作当前窗口的**活动标签页**，不支持后台标签页批量切换。
- 不支持 iframe 内的登录表单（内容脚本只注入顶层 frame）。
- 不支持同一 OA 的多账号并行登录（Cookie 共享，切换是全局生效）。
- 无法从 OA 页面可靠识别「当前登录的是哪个账号」，默认一律退出后重登。
- 账号删除在保险库锁定时会留下孤儿密码条目，这是「元数据操作不强行解密」的取舍。
- `auditEnabled` 设置项暂未产生实际审计记录。
- 未接入 CI、未做 i18n；错误文案固定为简体中文。

## 故障排查

| 现象 / 错误码 | 原因与处理 |
|---|---|
| `E_VAULT_NOT_INITIALIZED` | 尚未设置主密码，在 Popup 初始化保险库 |
| `E_VAULT_LOCKED` | 保险库已锁定；解锁后重试。浏览器重启或后台被回收后会重新锁定 |
| `E_MASTER_INVALID` | 主密码错误，或密文已损坏 |
| `E_CREDENTIAL_MISSING` | 该账号没有保存密码，在设置页补充 |
| `E_NO_PERMISSION` | 未授权 OA 域名，点击「授权域名」后重试 |
| `E_NO_OA_TAB` | 当前活动标签页不是目标系统，切换到 OA 页面后再试 |
| `E_CONTENT_UNAVAILABLE` | 页面脚本未注入或无响应；刷新 OA 页面后重试 |
| `E_SYSTEM_AMBIGUOUS` | 多个系统匹配当前页面，在 Popup 明确选择目标系统 |
| `E_CONFIG_MISSING` | 适配配置缺失或选择器非法，按提示补齐；`detail.missing` 会列出缺失键 |
| `E_LOGIN_PAGE_TIMEOUT` | 登录页/表单未在时限内就绪；检查登录页 URL 规则与表单标记 |
| `E_FORM_NOT_FOUND` / `E_FILL_FAILED` | 用户名/密码字段找不到或不可写；检查选择器与实际 DOM |
| `E_SUBMIT_FAILED` | 提交控件不可用或提交被阻止；检查提交方式与元素 |
| `E_LOGOUT_TRIGGER_FAILED` / `E_LOGOUT_TIMEOUT` | 退出入口或退出地址不可用，或未观察到登出证据 |
| `E_STATE_UNKNOWN` | 无法判定登录态；补配已登录/未登录标记 |
| `E_LOGIN_REJECTED` | 命中登录失败提示（密码错误/账号不可用） |
| `E_VERIFY_TIMEOUT` | 超过验证窗口仍无成功/失败证据；补配成功标记或 URL 规则 |
| `E_BLOCKED_CAPTCHA` / `E_BLOCKED_MFA` | 需人工完成验证，插件不做绕过 |
| `E_CANCELLED` | 用户取消了切换 |
| `E_FLOW_BUSY` | 已有切换在运行；等待完成或先取消 |
| `E_INTERRUPTED` | 后台被浏览器回收导致流程中断；重新发起切换（不会自动续跑） |
| `E_TIMEOUT` | 单步或流程总超时；检查网络/OA 响应速度与超时配置 |

如果 Popup 完全无法加载配置，先重新打开 Popup；仍失败时在 `chrome://extensions` 查看扩展错误，
或在扩展的 Service Worker 控制台查看脱敏日志。

## 本地开发与检查

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run check:manifest
npm run package
npm run check:package
```

本地页面注入验证：

```bash
npm run serve:fixture
```

打开 `http://localhost:5173/`，在设置页新增系统：origin 为 `http://localhost:5173`，
登录页 URL 为 `http://localhost:5173/`，保存并授权域名，刷新页面后在 Popup 点击「检测当前页面」。

测试矩阵与实际结果见 [docs/testing.md](docs/testing.md)；架构决策与模块边界见 [docs/architecture.md](docs/architecture.md)；
需求演进、关键实现与真实踩坑记录见 [docs/development-summary.md](docs/development-summary.md)。
