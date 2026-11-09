# 测试与验收记录

> 阶段五（测试与异常处理收口）实测记录。  
> 测试日期：2026-11-06  
> 环境：macOS 26.6.2 / Node v23.11.0 / npm 10.9.2 / Vitest 2.1.9 / jsdom 25  
> 命令：`npm run typecheck`、`npm run lint`、`npm test -- --run`、`npm run build`、`npm run check:manifest`、`npm run package`、`npm run check:package`

## 1. 结果总览

| 检查 | 结果 |
|---|---|
| TypeScript（`tsconfig.json` + `tsconfig.node.json`） | 通过，无报错 |
| ESLint（`src` + `tests`） | 通过，无告警 |
| 单元测试 | **21 个文件 / 184 个用例全部通过**，0 失败，耗时约 2.5s |
| 构建 | 通过，`dist/` 共 13 个文件；选择器静态检查通过 |
| manifest 校验 | 14 组断言全部通过 |
| 打包 | `release/oa-switcher-0.1.0.zip`，13 个文件，88,433 bytes |
| zip 内容校验 | 全部断言通过（必需文件、顶层白名单、无调试残留、manifest/图标/入口一致） |

## 2. 需求场景覆盖矩阵

| 场景 | 覆盖用例 | 结果 |
|---|---|---|
| 正常切换（已登录 → 退出 → 登录） | `runner.test.ts`「已登录路径按顺序退出、等待登录页、填写、提交、验证成功」；断言步骤顺序、密码仅在填写时出现、快照落 session | 通过 |
| 正常切换（未登录，跳过退出） | `runner.test.ts`「已登出路径跳过退出并直接进入登录页等待」 | 通过 |
| 登录失败 | `runner.test.ts`「验证失败只认失败证据」→ `E_LOGIN_REJECTED`；`landrayAdapter.test.ts` 失败标记优先 | 通过 |
| 验证无证据 | `runner.test.ts`「验证结果 unknown 视为验证超时失败」→ `E_VERIFY_TIMEOUT` | 通过 |
| 验证码 / MFA 阻断 | `runner.test.ts`「验证码阻塞直接失败且不填写凭证」；`landrayAdapter.test.ts` 阻断标记 | 通过 |
| 步骤超时 | `runner.test.ts`「单步超时后失败，不会继续后续步骤」→ `E_TIMEOUT` | 通过 |
| 等待登录页超时 | `runner.test.ts`「等待登录页超时映射为 E_LOGIN_PAGE_TIMEOUT」 | 通过 |
| 验证窗口超时 | `runner.test.ts`「验证步骤超时映射为 E_VERIFY_TIMEOUT」 | 通过 |
| 并发切换 | `runner.test.ts`「并发切换在非终态返回 E_FLOW_BUSY」；`machine.test.ts` 非终态守卫 | 通过 |
| 取消（填写进行中） | `runner.test.ts`「取消接到 runId 后立即落 cancelled，并通知服务清理」 | 通过 |
| 取消（目标解析完成前） | `runner.test.ts`「取消后在目标解析完成前也不会触发 Content 清理」 | 通过 |
| 取消后不再发命令 / 清理表单 | `contentBridge.test.ts` 两个取消用例 | 通过 |
| 终态再次取消 | `runner.test.ts`「终态后再次取消返回 E_VALIDATION」 | 通过 |
| 保险库未初始化 / 已锁定 | `vaultService.test.ts` 全流程；`flowSteps.test.ts`「锁定状态返回 E_VAULT_LOCKED」 | 通过 |
| 凭证缺失 | `flowSteps.test.ts`「账号没有密码条目时返回 E_CREDENTIAL_MISSING」 | 通过 |
| 账号 / 系统禁用、系统不匹配 | `flowSteps.test.ts` 三个校验用例 → `E_VALIDATION` | 通过 |
| 域名权限未授予 | `flowSteps.test.ts`「域名权限未授予时返回 E_NO_PERMISSION」；`contentRegistry.test.ts` 未授权不注册且状态为 `denied` | 通过 |
| 授权状态判定（注册成功 ≠ 已授权） | `contentRegistry.test.ts` 5 个用例：未授权不注册、已授权注册、仅注销本扩展项、权限查询异常降级、并发 reconcile 串行化 | 通过 |
| Content 脚本注入与 ping | 真实 Chrome + fixture；原始 dist 人工授权成功后动态注册，`content.ping` 返回 `ready=true`（见第 7 节） | 通过 |
| 无活动 OA 标签页 | `flowSteps.test.ts`「未找到对应活动 OA 标签页时返回 E_NO_OA_TAB」 | 通过 |
| 配置缺失 / 缺项列表 | `configValidation.test.ts`、`landrayAdapter.test.ts` 多组 `E_CONFIG_MISSING`；`errorMessages.test.ts` 文案完整性 | 通过 |
| 非法 CSS 选择器 | `pageDriver.test.ts`「非法 CSS 选择器映射为 E_CONFIG_MISSING」 | 通过 |
| 后台回收中断 | `runner.test.ts`「SW 重启后把非终态快照标记为 E_INTERRUPTED 且不续跑」 | 通过 |
| 终态副作用（`lockAfterSwitch`） | `runner.test.ts`「终态钩子执行一次，失败也不改变 completed 结论」；`vaultService.test.ts` 锁定 | 通过 |
| 密码不落盘 / 不泄漏 | `accountService.test.ts` 密文不含明文；`errorMessages.test.ts` 未知异常不回显 `password=...`；`runner.test.ts` 填写后立即清空内存密码 | 通过 |
| 账号删除与保险库条目 | `accountService.test.ts` 解锁清理、锁定保留孤儿、写入失败回滚 | 通过 |
| 分组删除对账号的影响 | `accountService.test.ts`「删除分组后账号 groupId 变为 null」 | 通过 |
| Popup 状态与失败展示 | `popupComponents.test.tsx` 12 个用例（含取消、失败原因、安全 detail） | 通过 |
| 消息协议 / 信封校验 | `protocol.test.ts` 5 个用例 | 通过 |
| 状态机迁移全覆盖 | `machine.test.ts` 29 个用例 | 通过 |
| 日志脱敏 | `log.test.ts` 3 个用例 | 通过 |

## 3. 分文件用例数

| 文件 | 用例数 |
|---|---|
| `machine.test.ts` | 29 |
| `landrayAdapter.test.ts` | 36 |
| `runner.test.ts` | 15 |
| `popupComponents.test.tsx` | 12 |
| `accountService.test.ts` | 11 |
| `rules.test.ts` | 11 |
| `vaultService.test.ts` | 10 |
| `crypto.test.ts` | 9 |
| `flowSteps.test.ts` | 7 |
| `pageDriver.test.ts` | 6 |
| `groupService.test.ts` | 5 |
| `protocol.test.ts` | 5 |
| `configValidation.test.ts` | 4 |
| `contentBridge.test.ts` | 3 |
| `contentRegistry.test.ts` | 5 |
| `errorMessages.test.ts` | 3 |
| `keys.test.ts` | 3 |
| `log.test.ts` | 3 |
| `registry.test.ts` | 3 |
| `repo.test.ts` | 3 |
| `systemService.test.ts` | 1 |
| **合计** | **184** |

## 4. 异常处理审查结论

逐条检查关键路径的异常捕获与错误码映射：

| 路径 | 处理方式 | 结论 |
|---|---|---|
| `popup/options → background` 消息失败 | `callBackground` 超时 / 无响应 → `E_TIMEOUT` / `E_INTERNAL`；UI 只渲染 `describeError` 中文文案 | 不吞异常、不回显原始 message |
| `background → content` 消息失败 | 发送异常 → `E_CONTENT_UNAVAILABLE`；无响应 → `E_TIMEOUT`；非法响应 → `E_CONTENT_UNAVAILABLE` | 有明确中文原因 |
| 内容脚本未就绪 | 先 `content.ping`，失败补注入 `content.js` 后重试一次；仍失败 `E_CONTENT_UNAVAILABLE` | 页面导航后可自愈一次 |
| 超时 | 每步 `min(步超时, 剩余总时限)`；验证超时统一 `E_VERIFY_TIMEOUT`；登录页等待 `E_LOGIN_PAGE_TIMEOUT` | 超时不会被当作成功 |
| 页面关闭 / 导航 | 消息失败或超时进入失败分支；取消是尽力而为并记录日志 | 后台状态仍会落到终态 |
| 适配配置缺失 | 必需键缺失 / 提交退出结构非法 → `E_CONFIG_MISSING`，`detail.missing`/`field` 可定位 | 不猜测选择器 |
| 选择器语法非法 | `pageDriver` 捕获 `DOMException` → `E_CONFIG_MISSING`（`reason=invalid-selector`） | 不再落到「内部错误」 |
| 权限未授予 | `resolveOaTab` 先查 `chrome.permissions.contains` → `E_NO_PERMISSION` | 可读 |
| 保险库锁定 / 未初始化 | `E_VAULT_LOCKED` / `E_VAULT_NOT_INITIALIZED`，切换前触达页面即失败 | 报文不含密码 |
| 取消 | `AbortController` + `oa.cancel`；等待在途命令结束后清空表单；失败只记 `flow-cancel-cleanup-failed` 日志（仅 runId/reason） | 不留半填表单，不静默吞掉 |
| 终态副作用 | `afterTerminal` 只执行一次；失败记 `flow-terminal-hook-failed`，不改变流程结论 | 副作用失败不误报切换失败 |
| 快照持久化失败 | 记 `flow-snapshot-write-failed`，内存快照与端口广播继续 | 不阻断流程，也不静默 |
| SW 回收 | 恢复时非终态 → `E_INTERRUPTED`，不续跑 | 状态不明不猜测 |
| 未知异常 | `serializeError` 统一 `E_INTERNAL` + `reason=unexpected-error`；日志只输出错误码 | 不泄露页面内容 / 凭证 |
| 日志 | 敏感键黑名单打码；URL 裁到 origin；`debugLogging` 默认关闭 | 不打印密码 / Cookie / Token |

明确保留的「静默」点（均为非关键路径，且有日志或降级）：

- Popup 首次拉取 `flow.getState` 失败时依赖端口推送兜底，不弹错误。
- 取消阶段的 Content 清理失败只记日志（页面可能已关闭/跳转）。
- 后台初始化失败记录 `initialize-failed` 日志，后续请求仍按错误码返回。
- 删除锁定的保险库条目时保留孤儿密文，不强行解密。

## 5. 仍需在真实环境验证

以下内容无法由 jsdom/单测证明，必须在真实 Chrome/Edge 与真实蓝凌环境中确认：

1. **扩展加载**：Chrome for Testing 156 已实测通过（临时 profile + `--load-extension`，Service Worker 与 manifest 正常）；Chrome / Edge 稳定版加载与 Edge 差异仍需人工确认。
2. **权限与注入**：原始 dist 的人工授权已在固定 profile 上完成，授权后动态注册、注入与 `content.ping` 均验证通过（见第 7 节）；真实蓝凌域名仍需在真实环境重复一次授权。
3. **真实蓝凌页面**：按真实 DOM 填写全部适配配置后，登录态探测、退出、等待登录页、填写、提交、验证全链路可用。
4. **失败反馈**：密码错误、验证码、MFA、退出入口变更时，实际文案与错误码符合预期。
5. **并发与取消**：真实页面填写过程中取消，确认页面字段被清空且不会继续提交。
6. **SW 回收**：在 `chrome://extensions` 手动终止 Service Worker 后重新打开 Popup，确认显示 `E_INTERRUPTED` 且可重试。
7. **浏览器差异**：Edge 与 Chrome 在权限弹窗、session storage 行为上的差异。
8. **性能**：真实 OA 页面下各步骤耗时是否落在默认超时内，必要时调整 `timeouts`。

## 6. 真实浏览器冒烟记录

> 日期：2026-11-06  
> 浏览器：Chrome for Testing 156.0.8078.4（Playwright chromium-1248），headed，独立临时 profile  
> 方式：Playwright `launchPersistentContext` + `--disable-extensions-except` / `--load-extension` 加载 `dist`；fixture 为 `http://localhost:5173/mock-oa.html`

### 已实测通过

| 项 | 证据 |
|---|---|
| 扩展加载 | Service Worker URL 为 `chrome-extension://omcfkjipknmhjhaooidhpgolbhmdgjfn/background.js`；`chrome.runtime.getManifest()` 返回 name=`OA Switcher`、version=`0.1.0`、manifest_version=3 |
| manifest 无错误 | 加载与页面访问期间无 manifest / 扩展加载错误日志 |
| Popup 渲染 | `#root` 有内容，显示「未配置 OA 系统」「保险库未初始化」「切换账号」「检测当前页面」等元素；无 `pageerror`、无 `console.error` |
| Options 渲染 | 标题「OA Switcher 设置」，含「已配置系统」「添加 OA 系统」「保存系统」等元素；无 `pageerror`、无 `console.error` |
| fixture 页面 | 返回 200，标题 `Injection Fixture`；唯一控制台错误是 favicon 404，与扩展无关 |
| 权限缺失错误码 | 未授权时 `permission.ensure` 返回 `E_NO_PERMISSION`，`detail` 含 systemId / origin，中文文案正常 |
| 未授权不注册 | 修复后 `chrome.scripting.getRegisteredContentScripts()` 为空，系统 `permissionState` 为 `denied` |
| 原始 dist 域名授权（人工） | 固定 profile `/tmp/oa-switcher-auth-profile`；Options 点「授权域名」→ Chrome 原生弹窗点「允许」；`chrome.permissions.contains({origins:["http://localhost:5173/*"]})` 返回 `true`，`getAll().origins=["http://localhost:5173/*"]` |
| 原始 dist 授权后注入与 ping | 动态注册 `oa-switcher:sys_14f17e209f4e`（matches `http://localhost:5173/*`，js `["content.js"]`，runAt `document_idle`）；刷新 fixture 后 `content.ping` 返回 `{ok:true,data:{ready:true,frame:"top",adapterVersion:"0.2.0-phase3"}}` |
| 注入与 ping（测试副本） | 在 dist 副本中补 `host_permissions: ["http://localhost:5173/*"]` 后：动态注册 `oa-switcher:<systemId>` 成功；fixture 页面出现 `content-ready` 日志；`content.ping` 返回 `{ok:true, data:{ready:true, frame:"top", adapterVersion:"0.2.0-phase3"}}` |

### 未通过 / 未验证

| 项 | 状态与原因 |
|---|---|
| 原始 dist 的域名授权 | 已通过（人工点击「允许」）。前两轮 5 分钟轮询超时的原因是点击事件未落在扩展页面：页面探针记录 `clicks=[]`；最终点击被记录为 `trusted=true` 后 `permissions.request` 立即发起，2.1 秒后返回 `granted=true` |
| 原始 dist 的 content 注入与 ping | 已通过，见第 7 节 |
| Chrome / Edge 稳定版加载 | 未验证。Chrome 稳定版使用同样的命令行参数时未观察到本扩展的 Service Worker，冒烟改用 Chrome for Testing |
| 真实蓝凌页面全链路 | 未验证（按约定不接触真实站点与真实账号） |
| 取消清空表单、SW 终止后的 `E_INTERRUPTED` | 已在测试副本 + 构造快照上验证，见第 7 节；原始 dist 未授权，未在原始 dist 上运行 |

### 冒烟中发现并修复的问题

1. **授权状态误判**：`registerContentScripts` 成功不代表已获得注入权限。修复前未授权也会注册，并把 `permissionState` 写成 `granted`，但页面实际没有注入。已在 `contentRegistry.ts` 改为先查 `chrome.permissions.contains`，未授权不注册并标为 `denied`，补充 4 个单测。
2. **Options 过期文案**：仍写着「真实切换流程在后续阶段接入」「阶段三仅实现蓝凌适配器」，已更新为当前交付状态。

## 7. 授权、SW 终止与取消（真实浏览器补充）

> 环境同上。原始 `dist` 与测试副本分别使用独立临时 profile。

### 已实测

| 项 | 结果 |
|---|---|
| 原始 dist 未授权 | `chrome.permissions.contains` 为 `false`；系统 `permissionState=denied`；`getRegisteredContentScripts()` 为空；`permission.ensure` 返回 `E_NO_PERMISSION`，detail 含 systemId / origin |
| SW 终止 | 构造合法非终态快照（`state=verifying`、`step=verify`）写入 `chrome.storage.session`，通过 CDP `ServiceWorker.stopWorker` 终止 `background.js`，再打开 Popup 唤醒 SW |
| 中断恢复 | 快照被恢复逻辑改为 `failed` + `E_INTERRUPTED`，`reason=service-worker-restart`；Popup 显示「流程被浏览器中断，请重试」及「重试」按钮 |
| 可重试 | 点击「重试」生成新 `runId`（与中断的 `run_smokeinterrupt` 不同）；因保险库未解锁返回 `E_VAULT_LOCKED`，属于预期前置失败 |
| 取消 | 测试副本 + fixture 测试标记：`state=verifying` 时字段已填（`alice` / `smoke-secret`）；Popup 点「取消切换」后快照 `cancelled`，两个输入框清空，submit 计数保持 1，2 秒后仍为 1（未继续提交） |

### 原始 dist 人工授权与注入（2026-11-06 17:22 UTC）

| 项 | 结果 |
|---|---|
| 固定 profile | `/tmp/oa-switcher-auth-profile`；Chrome for Testing 156，headed，`--load-extension=dist`，CDP 端口 9335；未删除、未重开 |
| 授权前 | `chrome.permissions.contains` 为 `false`；卡片显示「权限：未授权」；`getRegisteredContentScripts()` 为空 |
| 点击与授权 | 页面探针记录 `click`（`trusted=true`）→ `permissions.request({origins:["http://localhost:5173/*"]})` 发起 → 2.1 秒后 `resolved granted=true`（Chrome 原生弹窗由用户点「允许」） |
| 权限状态 | `contains=true`；`getAll().origins=["http://localhost:5173/*"]`；`permissions=["alarms","storage","scripting"]` |
| 动态注册 | `oa-switcher:sys_14f17e209f4e`，matches `http://localhost:5173/*`，js `["content.js"]`，runAt `document_idle` |
| 注入与 ping | 刷新 `http://localhost:5173/mock-oa.html` 后 `chrome.tabs.sendMessage` 发 `content.ping` 返回 `{ok:true, data:{ready:true, frame:"top", adapterVersion:"0.2.0-phase3"}}`，`elapsedMs=0` |
| UI 同步 | 卡片文案由「权限：未授权」更新为「权限：已授权」，并显示「已授权，刷新 OA 页面后生效」 |
| 并发 reconcile（修复前） | 三个并发 `permission.ensure` 中一个返回 `E_INTERNAL`，存储被写成 `denied`，但 `contains=true` 且注册仍存在，Options 卡片显示「权限：未授权」 |
| 并发 reconcile（修复后） | `reconcileContentScripts` 串行化；并发 3 次全部 `ok`，`permissionState=granted`，注册项唯一；新增单测覆盖重复注册场景 |
| 环境说明 | `chrome.runtime.reload()` 后 Chrome 156 会禁用命令行加载的未打包扩展（`DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION`）；通过 `chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})` + `reload` 恢复，扩展 ID 与已授予权限均未变；未关闭浏览器、未删 profile |

### 说明与未验

- 取消与 SW 终止使用测试副本（在 `dist` 基础上补 `host_permissions: http://localhost:5173/*`）与 fixture 自带 `#field-a`、`#field-b`、`#submit-button` 测试标记；未新增任何真实蓝凌选择器。
- 原始 dist 的授权后注入已完成；取消与 SW 终止仍只在测试副本上运行，原始 dist 未跑真实 flow。
- 前两轮 5 分钟轮询超时为点击未落在扩展页面（探针 `clicks=[]`），不是权限手势失效；最终人工点击 `trusted=true` 并成功授权，证据见上表。

## 8. 方案二（活动页系统识别）+ 悬浮球 + 保险库状态同步（2026-11-08）

> 环境：macOS 26.6.2 / Node v23.11.0；真实 OA 站点 `http://oa.example.com`（蓝凌）；扩展以未打包方式原地加载 `dist/`，改代码后 `npm run build` + `chrome.runtime.reload()` 重载。
> 保险库在测试期间使用「用户提供的主密码」解锁；主密码未写入任何文件、日志、报告、截图、DOM 属性或本节文本。

### 8.1 活动页系统识别（真实环境）

| 项 | 结果 |
|---|---|
| 识别输入 | `http://oa.example.com/sys/portal/page.jsp` |
| `system.resolveActiveTab` | `status=matched`，`systemId=sys_f1994933a8a0`，系统名「示例公司 OA（蓝凌）」 |
| 识别依据 | `basis.kind=signature`；该系统的 `urlSignatures` 为空，回退到 `homeUrl` 匹配 |
| 记忆键 | `rememberKey=http://oa.example.com/sys/portal/`（origin + 目录前缀） |
| 账号 | `user01`、`user02` 两个示例账号均在同一系统下可见 |
| content script 注册 | 按 origin 合并为一条：`oa-switcher:http___oa_example_com_11c7ifj`，`matches=["http://oa.example.com/*"]`，不再按系统重复注入 |
| 非 OA 页面 | 在 `https://example.com/` 下不渲染悬浮球，也不留下空容器节点 |

### 8.2 悬浮球（真实 OA 页面）

| 场景 | 结果 |
|---|---|
| 渲染条件 | 仅在识别为已配置且启用的系统页面渲染；未识别、路径不匹配签名、未授权、已关闭站点均不渲染 |
| 拖动与位置记忆 | 拖到 `(928,164)` 后写入 `float.positions[origin]`；刷新页面后恢复到同一位置 |
| 视口约束 | 视口缩到 480×360 时位置被夹到 `(428,164)`，未越界 |
| 面板内容 | 系统名、「示例公司 OA（蓝凌）」、两个账号、切换按钮、流程状态区 |
| 键盘 | Enter 展开、Esc 收起面板并回焦到悬浮球；小球不被移除，不拦截页面其它快捷键 |
| 页面交互 | 拖动不触发点击；打开面板不影响页面滚动；点页面空白处收起面板 |
| 紧凑态 | 面板收起时小球旁显示当前系统名；展开后隐藏，叉叉（`aria-label=关闭账号列表`）只收起面板 |
| 贴边吸附 | 松手时距左右边缘 32px 以内吸附贴边（`x=8` 或 `视口宽-52`），中间区域保持原位；吸附后可再次拖离 |
| 站点级关闭 | 在 Popup 设置勾选「在当前站点隐藏」写入 `float.dismissed[origin]`，当前页立即移除；取消勾选或点「恢复显示」立即恢复 |
| 全局开关 | Popup 设置里的「页面悬浮球 · 显示」可全局关闭，所有站点立即移除悬浮球；重新打开立即恢复，均无需刷新页面 |

### 8.3 保险库状态同步（Popup 不再显示陈旧状态）

| 项 | 结果 |
|---|---|
| 挂载与重新可见 | `useBootstrap` 在挂载、`focus`、`visibilitychange` 时重新拉取权威状态；`useFlowPort` 在端口断开/重连与收到 `vault.state` 广播时触发 `refresh` |
| SW 强杀 | CDP `ServiceWorker.stopWorker` 终止 `background.js` 后打开 Popup，SW 自动唤醒并重建；Popup 共发出 4 次后台请求（2×`app.bootstrap` + 2×`flow.getState`），UI 保持「保险库已锁定」+「解锁」按钮，无控制台错误 |
| 广播驱动 | 从 Options 调用 `vault.lock` 触发真实广播后，Popup 请求数 4→5，说明广播确实驱动重拉 |
| 单测 | `uiPort.test.ts` 6 例（vault 广播、非法事件、断线重连、取消订阅、`notifyVaultState` 广播与失效端口清理）；`popupVaultSync.test.tsx` 3 例（重载后取到 locked 并渲染解锁入口、focus 刷新、收到广播刷新） |

### 8.4 真实切换（正向：user01 → user02）

`runId=run_bedcaebc7617`，从悬浮球面板发起。

| 时间点(ms) | 状态 | 说明 |
|---|---|---|
| 7 | `resolving` | 校验账号与系统配置 |
| 12 | `loggingOut` | 触发蓝凌退出 |
| 695 | `submitting` | 登录页填报并提交 |
| 807 | `verifying` | 等待落地页 |
| 1576 | `completed` | 面板显示「切换成功 … 耗时 1576 ms」 |

- 最终 `state=completed`，`error=null`
- 落点 URL：`http://oa.example.com/sys/portal/page.jsp`
- 退出确认框：未触发
- 登录后命中 `authenticatedUrlPattern`（`page.jsp*`），`loggedInMarkerSelector`（`div.lui_single_menu_header_logout .lui_dropdown_toggle`）存在
- 页面右上角名称变为「张三」，账号 `acc_4c74e879b83c`（user02）

### 8.5 真实切换（反向：user02 → user01）

`runId=run_2d94c1d292d9`。

| 时间点(ms) | 状态 | 说明 |
|---|---|---|
| 7 | `probing` | 已登录态探测 |
| 54 | `loggingOut` | 蓝凌 DOM 退出确认弹窗出现并被适配器处理（`dialogSeen=true`） |
| 870 | `submitting` | 登录页填报并提交 |
| 1450 | `verifying` | 等待落地页 |
| 1705 | `completed` | 面板显示「切换成功 … 耗时 1705 ms」 |

- 最终 `state=completed`，`error=null`
- 落点 URL：`http://oa.example.com/sys/portal/page.jsp`
- 退出确认框：**触发**（蓝凌页面内 DOM 弹窗，适配器自动确认；非浏览器原生弹窗）
- 登录后命中 `authenticatedUrlPattern` 与 `loggedInMarkerSelector`
- 页面名称「李四」，账号 user01

### 8.6 连续切换与面板收起时的状态推进

| 场景 | 结果 |
|---|---|
| 连续第二次切换 | `run_4127f5ee724e`（切到 user02）成功，说明退出→登录链路可连续复用 |
| 面板收起期间 | `run_0cd3dd817abf`（user02 → user01）在面板收起状态下持续推进；重新展开可见实时进度「退出当前账号 / 当前步骤：退出登录 … 耗时 6 ms」，最终 `completed` 1437 ms |
| 还原 | 结束时回到 user01（「李四」），恢复测试前登录状态 |

### 8.7 验证结论（三分法）

**已在真实环境验证通过**

- 活动页识别 `matched` + 系统名 + `basis=signature` + rememberKey
- content script 按 origin 合并注册（单条 `oa-switcher:http___oa_example_com_11c7ifj`）
- 悬浮球渲染/拖动/位置恢复/视口夹取/键盘/站点关闭与恢复/全局开关
- Popup 保险库状态与后台一致（SW 强杀后重拉、广播驱动刷新）
- 正向与反向真实切换各一次，均 `completed`，落点与登录标记均符合预期
- 连续切换、面板收起期间状态持续推进

**仅在测试环境验证（jsdom / 单测）**

- `E_SYSTEM_AMBIGUOUS` 与「记住本次选择」的 UI 分支（真实站点只有单系统，无歧义场景）
- 同 origin 多系统时的归属校验拒绝分支
- 视口极小、移动端触控拖动的边界组合

**未验证**

- Edge 稳定版与 Chrome 稳定版（本次仍使用 Chrome for Testing）
- 真实站点上的取消切换（填写中途取消并清空表单）
- 多系统歧义在真实站点上的体验（需第二个同域系统）

## 9. 用户自装环境「无法判断当前登录状态」定位（2026-11-08）

> 现场：用户自己的 Chrome（扩展从未打包目录 `release/oa-switcher-0.1.0` 加载，ID `example-extension-id`），页面 `http://oa.example.com/login.jsp#system/systemview`。
> 失败：`run_aacd07b2ed11`，`E_STATE_UNKNOWN`，5127 ms。

### 9.1 实测证据

| 项 | 结果 |
|---|---|
| 快照 | `chrome.storage.session` 中只有其他站点命名空间，无 `oa.v1.session.run`；浏览器重启后会话快照已被清除，无法直接回读该 runId |
| 时间特征 | 5127 ms ≈ `stateProbeMs` 默认 5000 ms + 请求开销；`E_STATE_UNKNOWN` 只由 probe 返回 `unknown` 触发，排除填写/提交阶段 |
| 系统配置（`chrome.storage.local`，只读） | `sys_15e8a5a3a781`「示例公司」，`adapterConfig: {}`（全空），`homeUrl: null`，`urlSignatures: []`，`loginUrl: .../login.jsp#system/systemview`，`origins: ["http://oa.example.com"]`，权限 `granted` |
| 账号 | 4 个（只读名称与用户名，未读取任何密码）；本次目标「李四」 |
| 真实登录页 DOM | `form[action="/j_acegi_security_check"]`=1、`input[name="j_username"]`=1、`input[name="j_password"]`=1、`input[name="btn_submit"]`=1、`input[type=password]`=1；`.lui_login_message_div`=1 |
| 真实已登录页 DOM | `div.lui_single_menu_header_logout .lui_dropdown_toggle`=1、登录表单=0、`.lui_login_message_div.tip_message`=0 |
| 页面身份 | 登录页 `readyState=complete`，标题「登录系统」；并非加载慢 |

### 9.2 根因

系统由「添加系统」创建，该入口刻意不写任何蓝凌键位，`adapterConfig` 为空；而 `detectLoginState` 在没有任何判定信号时不校验配置，空转满 5 s 后返回 `unknown`，runner 映射为 `E_STATE_UNKNOWN`（「无法判断当前登录状态」），掩盖了真正的配置缺失。

明确排除：(a) 入口未纳入识别——单系统独占 origin，页面已识别为「示例公司」；(b) 未登录标记不匹配——旧值在真实登录页命中；(c) 已登录标记不匹配——旧值在真实已登录页命中；(d) 加载慢——页面已 complete。

### 9.3 修复

| 改动 | 说明 |
|---|---|
| `src/adapters/landray/adapter.ts` | `detectLoginState` 在 `loggedInMarkerSelector` / `loggedOutMarkerSelector` / `loginPageUrlPattern` 全空时立即抛 `E_CONFIG_MISSING`（`missing` 列出三项），不再空等探测窗口 |
| `src/options/sections/SystemsSection.tsx` | 新增系统后的提示改为「请点击『编辑』补齐蓝凌适配配置，否则切换会提示配置缺失」 |
| `tests/unit/landrayAdapter.test.ts` | 新增「无判定信号立即失败且不消耗探测窗口」；保留「有判定配置但无证据 → unknown」 |

### 9.4 验证

| 检查 | 结果 |
|---|---|
| `npm run typecheck` / `npm run lint` | 通过 |
| `npm test -- --run` | 28 文件 / 250 用例全部通过（+1） |
| `npm run build` / `check:manifest` / `package` | 13 文件；14 组断言；zip 99,917 bytes |

已把新构建覆盖到用户 Chrome 实际加载目录 `release/oa-switcher-0.1.0`；需在 `chrome://extensions` 点「重新加载」并刷新 OA 页面后生效。

## 10. 「提交登录失败」14 ms 定位（2026-11-09）

> 失败：`run_b205a3c80baa`，`E_SUBMIT_FAILED`，14 ms；页面为登录页，用户名/密码已填写。
> 只读检查用户 Chrome 存储（扩展 ID `example-extension-id`），未读取任何密码。

### 10.1 实测

| 项 | 结果 |
|---|---|
| 存储中的 `submitTrigger` | `{"kind":"formSubmit","selector":"click/input[name=\"btn_submit\"]"}` |
| 其它选择器 | 登录页 URL 规则、表单就绪、用户名/密码、已登录/未登录标记、成功 URL、失败标记均正确；`homeUrl` 已补；`urlSignatures` 仍为空；**`logoutTrigger` 缺失** |
| 真实按钮 | `input[name="btn_submit"]` 存在，`type=submit`，`getBoundingClientRect` 为 0×0，`display:inline-block`、`visibility:visible`、`offsetParent` 非空，位于 `form[action="/j_acegi_security_check"]` 内 |
| 表单事件 | `onsubmit="return kmss_onsubmit();"`，按钮无 `onclick`，`form.requestSubmit` 可用 |
| 会话快照 | `chrome.storage.session` 未落盘到可读位置，无法直接回读该 runId；错误码与耗时由代码路径与 14 ms 立即失败特征确认 |

### 10.2 根因

`selector` 写成 `click/input[name="btn_submit"]`，不是合法 CSS：`waitFor` → `document.querySelector` 抛 `DOMException` → `E_CONFIG_MISSING(reason=invalid-selector)`；`submitLogin` 的兜底 catch 把它统一改写成 `E_SUBMIT_FAILED {step:'submit'}`，于是面板显示「提交登录失败」，真实原因被掩盖。因属立即抛错，耗时仅 14 ms。与元素 0×0 无关。

### 10.3 修复

| 文件 | 改动 |
|---|---|
| `src/adapters/landray/adapter.ts` | `submitLogin` 保留 `E_CONFIG_MISSING` / `E_CANCELLED` 原样上抛；其余错误记为 `E_SUBMIT_FAILED` 并附带 `reason` |
| `tests/unit/landrayAdapter.test.ts` | 新增「非法选择器保留 E_CONFIG_MISSING」；超时用例断言 `reason=E_TIMEOUT` |

点击策略无需改动：`click()` 已是页面上下文 `element.click()`（即用户所述回退），0×0 不影响程序化点击；`formSubmit` 使用 `form.requestSubmit()`，会触发 `onsubmit`，不绕过密码加密。本次两条路径都未执行，因为选择器在 `waitFor` 阶段已失败。

### 10.4 验证

| 检查 | 结果 |
|---|---|
| typecheck / lint | 通过 |
| 单测 | 28 文件 / 251 用例全部通过（+1） |
| build / check:manifest / package | 13 文件；14 组断言；zip 99,934 bytes |

新构建已覆盖到 `release/oa-switcher-0.1.0`，并清理了旧构建残留的 `assets/options-Xv92baII.js`。需「重新加载」扩展并刷新 OA 页面。

## 11. 通用新建向导 + 自动识别（2026-11-09）

### 11.1 实现

| 模块 | 改动 |
|---|---|
| `src/shared/types/discovery.ts` | 草稿字段/状态/证据、自检结果类型；字段顺序与中文标签集中定义 |
| `src/background/discovery/pageFacts.ts` | 只读探针：采集 form/input/button/alert/link 的结构属性；自检只统计选择器命中数 |
| `src/background/discovery/heuristics.ts` | 通用启发式：`input[type=password]`、最近文本输入、同表单可提交控件、包含「登录/首页」文本的可见元素、redirect 参数；无站点硬编码选择器 |
| `src/background/discovery/selfCheck.ts` | 纯函数：选择器收集、登录态判定（只认 URL 规则与标记命中，冲突即 unknown） |
| `src/background/services/discoveryService.ts` | 权限校验 → 后台临时标签页 → 15s 加载上限、8s 注入上限 → 关闭标签页；跨域跳转/chrome-error/注入失败给明确错误码 |
| `src/background/services/selfCheckService.ts` | 找到用户已打开的该系统标签页，只读计数并判定登录态；5s 上限 |
| `src/shared/types/messages.ts` / `protocol.ts` / `router.ts` | 新增 `system.discover`（url + vendor）与 `system.selfCheck`（systemId） |
| `src/options/sections/SystemsSection.tsx` | 新建表单简化为名称 + 网址 +（可选）厂商；「自动识别」在点击手势内先申请权限；草稿表格可逐项编辑并展开证据；缺项保存二次确认；列表新增「自检」 |
| `src/shared/types/errors.ts` / `src/errors/messages.zh-CN.ts` | 新增 `E_DISCOVERY_FAILED` / `E_DISCOVERY_TIMEOUT` / `E_DISCOVERY_BLOCKED` |
| `tests/unit/discoveryHeuristics.test.ts` | 7 个启发式用例（标准 Acegi 页、根路径、无密码框、多密码框、redirect 参数、错误容器、无法生成选择器） |
| `tests/unit/selfCheck.test.ts` | 6 个登录态判定 + 2 个选择器收集/结果组装用例 |
| `tests/unit/protocol.test.ts` | 新增白名单回归：`system.discover` / `system.selfCheck` |

安全边界：探针不读取 `input.value`、cookie、localStorage 或页面正文；不点击、不提交、不登录；存储只写入选择器与 URL 规则。

### 11.2 真实站点端到端（Chrome for Testing，扩展 ID `omcfkjipknmhjhaooidhpgolbhmdgjfn`）

- 目标：`http://oa.example.com/login.jsp#system/systemview`，只填名称「识别测试」+ 网址，点击「自动识别」后保存。
- 识别耗时：276 ms；临时标签页打开登录页（标题「登录系统」）后自动关闭（实测目标列表无残留）。
- 自检对象：既有系统「示例公司 OA（蓝凌）」，当前标签 `page.jsp`，耗时 8 ms，判定 **loggedIn**。

| 字段 | 识别值 / 状态 | 与手工可用配置对比 |
|---|---|---|
| 登录页 URL 规则 | `http://oa.example.com/login.jsp*` · 自动识别 | 一致 |
| 登录表单就绪标记 | `form[action="/j_acegi_security_check"]` · 自动识别 | 一致 |
| 用户名输入框 | `input[name="j_username"]` · 自动识别 | 一致 |
| 密码输入框 | `input[name="j_password"]` · 自动识别 | 一致 |
| 提交方式 / 提交元素 | `click` + `input[name="btn_submit"]` · 自动识别 | 一致 |
| 未登录标记 | `input[name="j_username"]` · 自动识别 | 一致 |
| 已登录标记 | 无法识别 | 手工有值（`div.lui_single_menu_header_logout .lui_dropdown_toggle`）；必须登录后才有 |
| 登录成功 URL 规则 | 无法识别 | 手工有值（`sys/portal/page.jsp*`）；登录页无跳转参数、除登录链接外无其它链接 |
| 登录失败提示 | 无法识别 | 手工有值（`.lui_login_message_div.tip_message`）；实测登录页该选择器命中 0，需失败提交后才出现 |
| 退出方式 | 无法识别 | 手工为 click；必须登录后才有 |
| 退出入口 | 无法识别 | 手工有值；必须登录后才有 |
| 退出二次确认 | 无法识别 | 手工有值；必须登录后才有 |
| 退出后 URL 规则 | 无法识别 | 手工为 `login.jsp*`；未用「登录页规则」反推，留给用户确认 |
| 退出地址（方式为 url 时） | 无法识别 | 手工未使用；仅 url 方式需要 |
| URL 签名 | `http://oa.example.com/login.jsp*` · 自动识别 | 手工为空；识别新增，非冲突 |

统计：自动识别 8 / 16（50%），识别错误 0；与手工已配置且可从登录页推导的 6 项对比，一致 6 / 6（100%），不一致 0；无法识别 8 项均属于「登录页不可见 / 必须登录后或登录失败后才有」的字段。

自检（既有系统）逐项命中：登录表单 0、用户名 0、密码 0、提交元素 0、已登录标记 1、未登录标记 0、失败提示 0、退出入口 1、退出二次确认 0（弹窗未打开，符合预期）；判定已登录，证据为成功 URL 规则命中 + 已登录标记命中。

### 11.3 验证

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm test -- --run` | 30 文件 / 267 用例全部通过（+16） |
| `npm run build` | 13 个文件；no-selectors 13 个文件通过 |
| `npm run check:manifest` | 14 组断言通过 |
| `npm run package` | zip 108,007 bytes |

新构建已覆盖 `release/oa-switcher-0.1.0` 并清理旧 assets；需在 `chrome://extensions` 点「重新加载」并刷新 OA 页面。

---

## 12. 删除系统修复 + 蓝凌厂商预设（2026-11-09）

### 12.1 A：删除系统「点了没反应」

**修前真实复现（Chrome for Testing，旧构建）**

- 对象：系统「示例公司 OA（蓝凌）」（`sys_f1994933a8a0`，2 个账号）。
- 操作：列表「删除」→ 确认弹窗「删除」。
- UI 表现：弹窗关闭；系统卡片仍在；页面底部（「添加 OA 系统」卡片内、列表之外、通常不在视口）出现 `请求参数不合法（E_VALIDATION）`。
- 结论：不是权限/存储/注销脚本失败，而是**引用检查用了通用校验错误码且提示位置远离操作点**，等价于静默失败。

**根因（代码位置）**

- `src/background/services/systemService.ts`：旧 `deleteSystem` 在有账号引用时抛 `FlowError('E_VALIDATION', { field: 'systemId' })`。
- `src/options/sections/SystemsSection.tsx`：删除失败只写入新建区域的 `message` 状态，列表卡片处没有任何反馈；`E_VALIDATION` 只能映射为通用文案，无法说明「被几个账号引用、怎么处理」。
- 权限撤销 / storage 写入 / contentScripts 注销均未参与该失败路径（后续修复中分别做非阻塞与 best-effort 处理）。

**修法**

| 层 | 改动 |
|---|---|
| 错误码 | 新增 `E_SYSTEM_IN_USE`（`validation` / 不可重试），detail 允许 `systemId` + `accountCount` |
| 服务 | `deleteSystem(id, { deleteAccounts })`：默认拒绝并返回账号数量；`deleteAccounts: true` 时在同一 `storage.set` 中原子删除系统与账号；清理 `activeSystemId`、`rememberedSystems`、独占 origin 的悬浮球偏好、保险库密文（解锁时）、origin 权限（失败不阻塞，返回 `permission-may-remain`）；contentScripts 重算失败只记日志 |
| UI | 列表卡片内显示删除结果（成功/拒绝原因）；拒绝时弹「无法删除：仍有账号引用」，提供「同时删除 N 个账号」；成功后显示清理摘要 |
| 存储 | `src/storage/repo.ts` 新增 `writeSystemsAndAccounts`，避免「系统已删、账号变孤儿」的中间态 |

**单测（真实通过）**

- `tests/unit/systemDelete.test.ts`：5 个用例（正常删除并清理设置/悬浮球/权限；账号引用拒绝且不产生孤儿；连带删除；权限撤销失败仍删除并提示残留；共享 origin 不误撤权限）。
- 既有 `systemService.test.ts` 4 个用例保持通过。
- 命令：`npx vitest run tests/unit/systemDelete.test.ts tests/unit/systemService.test.ts` → 9 passed。

**修后真实 UI 验证**

| 场景 | 结果 |
|---|---|
| 2 个账号引用的系统 | 弹出「无法删除：仍有账号引用」，正文含「仍有 2 个账号」与「同时删除 2 个账号」；列表顶部同时显示拒绝原因；卡片保留。**不再静默失败** |
| 无账号引用的系统（「识别测试」，与另一系统共享 origin） | 删除成功：卡片消失，列表显示「已删除「识别测试」」；共享 origin 未被撤销权限、未清理悬浮球偏好（符合预期） |
| 权限撤销失败 | **仅单测覆盖**（`chrome.permissions.remove` 抛错 → 配置仍删除，返回 `permission-may-remain`） |

### 12.2 B：蓝凌厂商预设

**实现**

| 模块 | 改动 |
|---|---|
| `src/adapters/landray/preset.ts` | 唯一预设模块：`LANDRAY_PRESET_TEMPLATE`（URL 全部 `{origin}` 占位）、`buildLandrayPresetDraft`、`buildLandrayPresetConfig`、版本号与逐字段交叉校验依据 |
| `src/adapters/landray/config.ts` | `LandrayAdapterConfig.preset` 标记（id + version），供自检判断「是否可能已过期」 |
| `scripts/check-no-selectors.mjs` | 仅豁免 `src/adapters/<vendor>/preset.ts`；其余 `src/adapters/**`、`src/content/**` 规则不变 |
| `src/options/sections/SystemsSection.tsx` | 「OA 类型」下拉（未指定/蓝凌）；选蓝凌即按预设填充草稿并标注证据，用户可逐项覆盖；新增「应用蓝凌预设」；自检弹窗展示预设命中与过期提示 |
| `src/background/discovery/selfCheck.ts` / `selfCheckService.ts` | 预设过期判定：按当前登录态只检查「该状态下必然存在」的字段，失败提示/退出确认不参与，避免误报 |
| `src/shared/types/discovery.ts` | `SelfCheckPresetInfo`（id/version/stale/staleFields/notes） |
| `tests/unit/landrayPreset.test.ts` | 6 个用例（必需键、`{origin}` 展开、模板无域名/IP、草稿字段、来源标记、URL 签名） |
| `tests/unit/selfCheck.test.ts` | 新增 5 个预设用例（正常、未命中、选择器非法、登录态未知、手写配置） |

**交叉校验（硬要求：两环境都命中才进预设）**

环境一 `http://oa2.example.com`，环境二 `http://oa.example.com`。

| 预设字段 | 值（相对写法） | 环境一命中 | 环境二命中 |
|---|---|---|---|
| 登录页 URL 规则 | `{origin}/login.jsp*` | ✓ `/login.jsp` | ✓ `/login.jsp` |
| 登录表单就绪 | `form[action="/j_acegi_security_check"]` | 1 | 1 |
| 用户名输入框 | `input[name="j_username"]` | 1 | 1 |
| 密码输入框 | `input[name="j_password"]` | 1 | 1 |
| 提交方式 / 元素 | `click` + `input[name="btn_submit"]` | 1 | 1 |
| 未登录标记 | `input[name="j_username"]` | 1 | 1 |
| 已登录标记 | `div.lui_single_menu_header_logout .lui_dropdown_toggle` | 1（登录后） | 1（登录后） |
| 登录成功 URL 规则 | `{origin}/sys/*` | ✓（`/sys/` 下各页面） | ✓（`/sys/` 下各页面） |
| 登录失败提示 | `.lui_login_message_div.tip_message` | 1（失败后） | 1（失败后） |
| 退出方式 / 入口 | `click` + 同上退出容器 | ✓（同一 `__sys_logout()`） | ✓（同一 `__sys_logout()`） |
| 退出二次确认 | `div.lui_dialog_main .lui_widget_btn.lui_toolbar_btn_def` | 1（弹窗内） | 1（弹窗内） |
| 退出后 URL 规则 | `{origin}/login.jsp*` | ✓ | ✓ |
| URL 签名 | `{origin}/sys/portal/*` | ✓ | ✓ |

- 失败提示的取证方式：两环境各用**不存在的账号**提交一次，观察到相同提示容器与相同文案；未对真实账号做错误密码尝试。
- 两环境结构一致，**没有出现「仅单环境命中」的候选规则**，因此本轮没有规则被剔除。可见的「登录」链接只是调用隐藏提交控件的 UI 包装，未单独纳入配置。
- 预设未覆盖：验证码/MFA/当前账号识别（两环境均未观察到），以及退出地址（本预设固定 click 方式）。

**自检（真实，预设配置）**

| 系统 / 站点 | 登录态 | 预设结论 | 预期字段命中 |
|---|---|---|---|
| 环境二（已登录） | loggedIn | 未过期 | 已登录标记 1、退出入口 1（2/2） |
| 环境一（登录页） | loggedOut | 未过期 | 表单 1、用户名 1、密码 1、提交 1、未登录标记 1（4/4） |

**真实切换（预设配置，两环境均成功）**

| 环境 / 账号 | 起始状态 | 状态时间线（相对 flow.start） | 最终 state | 错误码 | 落点 URL |
|---|---|---|---|---|---|
| 环境二 / user01 | 已登录 | loggingOut 57ms → awaitingLogin 649ms → submitting 700ms → verifying 804ms → completed **1500ms** | completed | 无 | `http://oa.example.com/sys/portal/page.jsp` |
| 环境一 / admin01 | 登录页 | submitting 56ms → verifying 162ms → completed **481ms** | completed | 无 | `http://oa2.example.com/sys/portal/page.jsp` |
| 环境一 / admin01 | 已登录 | loggingOut 56ms → submitting 512ms → verifying 619ms → completed **938ms** | completed | 无 | `http://oa2.example.com/sys/portal/page.jsp` |

- 环境一验证账号为临时账号，验证完成后已删除，返回 `{ deleted: true, credentialRemoved: true }`；账号密码未写入仓库文件、日志或本记录。
- 识别准确率变化：登录页通用自动识别 8/16（50%）；选择「蓝凌」后预设直接填充 15/16（94%，唯一空项为 click 方式不需要的退出地址），并补齐自动识别无法得到的 5 项（已登录标记、成功 URL、失败提示、退出入口、退出二次确认）。

### 12.3 检查与产物

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npx vitest run` | 32 文件 / 283 用例全部通过（+16） |
| `node scripts/check-no-selectors.mjs` | 13 个文件通过（`preset.ts` 豁免生效） |
| `npm run build` | 13 个文件；manifest 14 组断言通过 |
| `npm run package` | `release/oa-switcher-0.1.0.zip`（13 个文件，111,260 bytes） |

### 12.4 验证状态口径

- **真实环境验证通过**：A 的拒绝路径与成功删除路径；B 的预设配置自检、两环境完整切换（含退出→重登）。
- **仅单测覆盖**：权限撤销失败仍删除并提示残留；预设「可能已过期」的展示路径（真实站点两环境均未过期，未触发）。
- **未验证**：其它蓝凌版本/SSO/验证码站点（预设不承诺覆盖）。

### 12.5 用户需执行的动作

1. 在 `chrome://extensions` 对本扩展点「重新加载」（`dist` / `release/oa-switcher-0.1.0` 已更新），并刷新已打开的 OA 页面。
2. 新建系统时填写名称与网址后，将「OA 类型」选为「蓝凌」，确认预设草稿后保存；已有系统可在「编辑」中逐项覆盖。
3. 首次使用某域名仍需在「授权域名」或自动识别时同意权限弹窗。
4. 若保险库已锁定，切换前需在设置页解锁。

## 13. 数据导出 / 导入（2026-11-09）

### 13.1 单测矩阵（真实通过）

| 文件 | 用例 | 覆盖点 |
|---|---|---|
| `tests/unit/transferExport.test.ts` | 4 | 完整包含信封且无明文；仅配置包 `vault=null` 且更小；导出源码不引用解密符号；篡改段/版本过高被拒 |
| `tests/unit/transferImport.test.ts` | 11 | 完整/仅配置往返（adapterConfig 深字段、urlSignatures、悬浮球偏好）；同 ID 覆盖与保留双方（含预览重命名）；版本过高、校验失败、引用非法与存储写入失败的原子性；保险库三分支；`activeSystemId` 回退与 `rememberedSystems` 清理；settings 本机优先 |
| `tests/unit/protocol.test.ts` | 8（+1） | `data.*` 白名单；`data.preview` 40KB 通过；超过 8MB 拒绝且 detail 含 `limit` 与实际大小 |

全量 `npx vitest run`：34 文件 / 299 用例全部通过。`npm run typecheck`、`npm run lint`、`npm run build`、`npm run check:manifest`、`npm run package`、`npm run check:package` 均通过。

### 13.2 真实 Chrome 往返（Chrome for Testing，扩展原地加载 `dist/`）

| 步骤 | 结果 |
|---|---|
| 重载扩展 | 「数据与迁移」分区出现，确认加载的是新构建 |
| 完整备份导出 | 7,325 bytes；段计数 系统 2 / 账号 4 / 分组 0 / 设置 1 / 悬浮球 1 / 保险库 1 |
| 仅配置导出 | 6,626 bytes；保险库段 0；比完整包小 699 bytes |
| 清空 + 重启 SW | `chrome.storage.local.clear()` 后重新加载扩展，模拟全新浏览器；预览显示「本机保险库：未初始化」，默认选中「采用备份中的凭证」 |
| 导入 | 一次原子写入耗时 206ms；结果「凭证：已导入 · 保险库：已接管备份凭证」；内容脚本重新注册 2 个 origin |
| 数据一致性 | systems / accounts（忽略 `updatedAt`）/ groups / settings 偏好 / 悬浮球偏好与导出前一致；`activeSystemId` 指向存在系统；`rememberedSystems` 无失效项 |
| 人工解锁 | 用户在设置页输入来源主密码解锁；密码未经过自动化、未写入日志 |
| 真实切换 1（登录页 → 示例 OA） | `submitting 17ms → verifying 123ms → completed **517ms**`；错误码无；落点 `http://oa2.example.com/sys/portal/page.jsp` |
| 真实切换 2（已登录 → 退出重登） | `loggingOut 10ms → submitting 485ms → verifying 559ms → completed **883ms**`；错误码无；落点同上 |

- 两次切换都使用导入后的保险库凭证，证明凭证在新存储中可用。
- 首次切换尝试返回过 `E_NO_OA_TAB`（detail `reason: origin-mismatch`）：自动化把新建的设置页置为活动标签页，后台按设计只定位活动标签页。将 OA 标签页置前后即成功，属于执行环境问题，不是导入缺陷。
- 保险库分支覆盖口径：
  - **真实环境**：目标未初始化 → 接管信封（adopt）。
  - **仅单测**：已初始化同密码合并、不同密码拒绝 + 清空本机保险库替换 + 二次确认。
- 测试产生的导出 JSON、临时备份与脚本已删除；仓库与 `~/Downloads` 均无残留。

### 13.3 验证状态口径

- **真实验证通过**：两种导出模式与体积差异、清空后接管信封导入、导入后数据一致性、两次悬浮球真实切换（含退出重登）。
- **仅单测覆盖**：同 ID 覆盖/保留双方在真实 UI 的执行结果、保险库同密码合并与不同密码替换、8MB 超限提示的真实渲染、存储写入失败的原子回滚。
- **未验证**：其他浏览器（Firefox/Edge）与跨设备导入；超大包（接近 8MB）真实导入耗时。
