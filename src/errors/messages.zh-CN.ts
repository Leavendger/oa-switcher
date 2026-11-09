import type { ErrorCode } from '../shared/types/errors';
import { isFlowError } from '../shared/types/errors';

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  E_VALIDATION: '请求参数不合法',
  E_FLOW_BUSY: '已有切换任务在运行，请先等待完成或取消',
  E_VAULT_NOT_INITIALIZED: '保险库尚未初始化，请先设置主密码',
  E_VAULT_LOCKED: '保险库已锁定，请先解锁',
  E_MASTER_INVALID: '主密码不正确，或数据已损坏',
  E_CRYPTO_UNAVAILABLE: '当前环境不支持 Web Crypto',
  E_CREDENTIAL_MISSING: '该账号还没有保存密码',
  E_NO_PERMISSION: '未授权该 OA 域名，请在设置页授权',
  E_NO_OA_TAB: '当前前台标签页不是该 OA 系统，请先切到 OA 标签页再切换',
  E_CONTENT_UNAVAILABLE: '无法与 OA 页面通信（页面可能正在跳转或未注入脚本），请确认 OA 标签页在前台后重试',
  E_SYSTEM_AMBIGUOUS: '多个 OA 系统匹配当前页面，请手动指定',
  E_SYSTEM_IN_USE: '该系统仍被账号引用，无法直接删除',
  E_SYSTEM_UNSUPPORTED: '暂不支持该 OA 厂商（仅预留接口）',
  E_TRANSFER_INVALID: '备份文件格式或完整性校验失败，未写入任何数据',
  E_TRANSFER_VERSION: '备份文件版本高于当前扩展支持，请先升级扩展',
  E_CONFIG_MISSING: 'OA 适配配置不完整，请在设置页补齐',
  E_LOGIN_PAGE_TIMEOUT: '等待登录页就绪超时',
  E_FORM_NOT_FOUND: '找不到登录表单字段',
  E_FILL_FAILED: '填写账号密码失败',
  E_SUBMIT_FAILED: '提交登录失败',
  E_LOGOUT_TRIGGER_FAILED: '找不到退出登录入口',
  E_LOGOUT_TIMEOUT: '退出登录超时',
  E_STATE_UNKNOWN: '无法判断当前登录状态',
  E_LOGIN_REJECTED: '登录被拒绝（密码错误或账号不可用）',
  E_VERIFY_TIMEOUT: '登录结果验证超时',
  E_BLOCKED_CAPTCHA: '检测到验证码，插件不会自动处理',
  E_BLOCKED_MFA: '检测到二次验证，插件不会自动处理',
  E_DISCOVERY_FAILED: '自动识别失败，请确认网址可正常打开后重试',
  E_DISCOVERY_TIMEOUT: '自动识别超时，页面在规定时间内没有加载完成',
  E_DISCOVERY_BLOCKED: '自动识别被拦截，页面无法读取（可能跳转到其他域名或被浏览器阻止）',
  E_CANCELLED: '已取消',
  E_TIMEOUT: '操作超时',
  E_INTERRUPTED: '流程被浏览器中断，请重试',
  E_NOT_IMPLEMENTED: '该功能尚未实现',
  E_INTERNAL: '内部错误',
};

export function errorText(code: ErrorCode | undefined, fallback = '未知错误'): string {
  if (!code) return fallback;
  return ERROR_MESSAGES[code] ?? fallback;
}

/** 把未知异常转成中文文案 + 错误码；UI 不直接渲染 error.message。 */
export function describeError(cause: unknown): string {
  if (isFlowError(cause)) return `${errorText(cause.code)}（${cause.code}）`;
  return errorText(undefined);
}
