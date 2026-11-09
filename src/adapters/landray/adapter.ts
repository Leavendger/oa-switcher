import { FlowError, isFlowError } from '../../shared/types/errors';
import type {
  BlockerReport,
  LoginStateReport,
  LoginVerification,
} from '../../shared/types/messages';
import type { OaVendor } from '../../shared/types/system';
import { checkRequiredKeys } from '../configValidation';
import type {
  AdapterCapabilities,
  AdapterConfigValidation,
  AdapterContext,
  CredentialInput,
  LoginPageReport,
  OaAdapter,
} from '../types';
import { LANDRAY_REQUIRED_KEYS, parseLandrayConfig, type LandrayAdapterConfig } from './config';
import { matchesUrlPattern, selectVerificationOutcome } from './rules';

type Evidence = LoginStateReport['evidence'][number];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new FlowError('E_CANCELLED');
}

/**
 * 蓝凌适配器：所有行为都由用户填写的配置驱动。
 * 未配置必需键位时直接 E_CONFIG_MISSING，绝不猜测任何选择器或地址。
 */
export class LandrayAdapter implements OaAdapter {
  readonly vendor: OaVendor = 'landray';
  readonly config: LandrayAdapterConfig;

  readonly capabilities: AdapterCapabilities = {
    loginStateDetection: true,
    logout: true,
    urlRuleMatching: true,
    version: '0.2.0-phase3',
  };

  constructor(config: Record<string, unknown>) {
    this.config = parseLandrayConfig(config);
  }

  validateConfig(config: unknown): AdapterConfigValidation {
    return checkRequiredKeys(config, LANDRAY_REQUIRED_KEYS);
  }

  async detectLoginPage(context: AdapterContext): Promise<LoginPageReport> {
    const pattern = this.requireText('loginPageUrlPattern');
    const formSelector = this.requireText('loginFormReadySelector');

    return {
      isLoginPage: matchesUrlPattern(pattern, context.driver.url()),
      formReady: context.driver.query(formSelector) !== null,
    };
  }

  async detectLoginState(context: AdapterContext): Promise<LoginStateReport> {
    // 没有任何登录态判定信号时立即失败：否则会白等满一个探测窗口，
    // 最终报「无法判断当前登录状态」，掩盖真正的配置缺失。
    const hasStateSignal =
      isNonEmptyString(this.config.loggedInMarkerSelector) ||
      isNonEmptyString(this.config.loggedOutMarkerSelector) ||
      isNonEmptyString(this.config.loginPageUrlPattern) ||
      isNonEmptyString(this.config.authenticatedUrlPattern);
    if (!hasStateSignal) {
      throw new FlowError('E_CONFIG_MISSING', {
        field: 'adapterConfig',
        missing:
          'loggedInMarkerSelector,loggedOutMarkerSelector,loginPageUrlPattern,authenticatedUrlPattern',
      });
    }

    const deadline = Date.now() + Math.max(0, context.timeouts.stateProbeMs);

    for (;;) {
      abortIfNeeded(context.signal);
      const collected = this.collectLoginState(context);

      if (collected.loggedIn && collected.loggedOut) {
        return {
          state: 'unknown',
          evidence: [
            ...collected.evidence,
            { kind: 'conflict', detail: { loggedIn: true, loggedOut: true } },
          ],
        };
      }
      if (collected.loggedIn) return { state: 'loggedIn', evidence: collected.evidence };
      if (collected.loggedOut) return { state: 'loggedOut', evidence: collected.evidence };

      if (Date.now() >= deadline) return { state: 'unknown', evidence: [] };
      await context.driver.sleep(context.timeouts.pollMs);
    }
  }

  async detectBlockers(context: AdapterContext): Promise<BlockerReport> {
    abortIfNeeded(context.signal);
    const captcha = this.config.captchaMarkerSelector;
    const mfa = this.config.mfaMarkerSelector;

    if (isNonEmptyString(captcha) && context.driver.query(captcha)) return { blockedBy: 'captcha' };
    if (isNonEmptyString(mfa) && context.driver.query(mfa)) return { blockedBy: 'mfa' };
    return { blockedBy: null };
  }

  async logout(context: AdapterContext): Promise<void> {
    const trigger = this.requireLogoutTrigger();

    // 蓝凌的非门户页（如 /sys/profile/）不渲染顶部退出入口，这些页面统一提供 GET /logout.jsp。
    // 只在点击目标确实找不到时兜底：能正常点到的站点行为完全不变。
    if (trigger.kind === 'click' && !context.driver.query(trigger.selector)) {
      await this.logoutViaFallback(context);
      await this.waitForLogoutEvidence(context);
      return;
    }

    try {
      if (trigger.kind === 'url') {
        await context.driver.navigate(trigger.url, { signal: context.signal });
      } else {
        const element = await context.driver.waitFor(trigger.selector, {
          timeoutMs: context.timeouts.logoutTriggerMs,
          signal: context.signal,
        });
        await context.driver.click(element);

        if (isNonEmptyString(trigger.confirmSelector)) {
          const confirm = await context.driver.waitFor(trigger.confirmSelector, {
            timeoutMs: context.timeouts.logoutTriggerMs,
            signal: context.signal,
          });
          await context.driver.click(confirm);
        }
      }
    } catch (error) {
      if (isFlowError(error) && (error.code === 'E_TIMEOUT' || error.code === 'E_FORM_NOT_FOUND')) {
        if (trigger.kind === 'click') {
          await this.logoutViaFallback(context);
          await this.waitForLogoutEvidence(context);
          return;
        }
        throw new FlowError('E_LOGOUT_TRIGGER_FAILED', { step: 'logout' });
      }
      throw error;
    }

    await this.waitForLogoutEvidence(context);
  }

  /** 站内兜底登出地址：蓝凌在站点根提供 /logout.jsp（GET 后跳转登录页）。 */
  private async logoutViaFallback(context: AdapterContext): Promise<void> {
    const origin = new URL(context.driver.url()).origin;
    await context.driver.navigate(`${origin}/logout.jsp`, { signal: context.signal });
  }

  async waitForLoginPage(context: AdapterContext): Promise<void> {
    const pattern = this.requireText('loginPageUrlPattern');
    const formSelector = this.requireText('loginFormReadySelector');
    const deadline = Date.now() + Math.max(0, context.timeouts.loginPageWaitMs);

    for (;;) {
      abortIfNeeded(context.signal);
      this.throwIfBlocked(context);

      if (matchesUrlPattern(pattern, context.driver.url()) && context.driver.query(formSelector)) {
        return;
      }
      if (Date.now() >= deadline) {
        throw new FlowError('E_LOGIN_PAGE_TIMEOUT', { step: 'waitLoginPage' });
      }
      await context.driver.sleep(context.timeouts.pollMs);
    }
  }

  async fillCredentials(context: AdapterContext, credential: CredentialInput): Promise<void> {
    const usernameSelector = this.requireText('usernameFieldSelector');
    const passwordSelector = this.requireText('passwordFieldSelector');

    const usernameField = await this.waitForField(context, usernameSelector, 'username');
    const passwordField = await this.waitForField(context, passwordSelector, 'password');

    abortIfNeeded(context.signal);
    try {
      await context.driver.setValue(usernameField, credential.username);
    } catch (error) {
      throw this.fieldError(error, 'username');
    }
    // 取消可能发生在两个字段之间：第二字段写入前必须再检查一次
    abortIfNeeded(context.signal);
    try {
      await context.driver.setValue(passwordField, credential.password);
    } catch (error) {
      throw this.fieldError(error, 'password');
    }
  }

  /** 取消后清空已填写字段；只使用用户配置的选择器，配置缺失时跳过。 */
  async clearCredentials(context: AdapterContext): Promise<void> {
    const selectors = [this.config.usernameFieldSelector, this.config.passwordFieldSelector];
    for (const selector of selectors) {
      if (!isNonEmptyString(selector)) continue;
      const field = context.driver.query(selector.trim());
      if (!field) continue;
      try {
        await context.driver.setValue(field, '');
      } catch {
        // 清理是尽力而为，绝不因单个字段失败阻断取消流程
      }
    }
  }

  async submitLogin(context: AdapterContext): Promise<void> {
    const trigger = this.requireSubmitTrigger();

    try {
      const element = await context.driver.waitFor(trigger.selector, {
        timeoutMs: context.timeouts.submitMs,
        signal: context.signal,
      });
      if (trigger.kind === 'formSubmit') {
        await context.driver.submitForm(element);
      } else {
        await context.driver.click(element);
      }
    } catch (error) {
      // 配置类错误（选择器非法/缺失）必须原样上抛，不能被伪装成「提交失败」
      if (
        error instanceof FlowError &&
        (error.code === 'E_CANCELLED' || error.code === 'E_CONFIG_MISSING')
      ) {
        throw error;
      }
      throw new FlowError('E_SUBMIT_FAILED', {
        step: 'submit',
        reason: error instanceof FlowError ? error.code : 'unexpected-error',
      });
    }
  }

  async verifyLogin(
    context: AdapterContext,
    options: { deadlineAt: number },
  ): Promise<LoginVerification> {
    const failureSelector = this.config.loginFailureMarkerSelector;
    const authenticatedPattern = this.config.authenticatedUrlPattern;
    const loggedInSelector = this.config.loggedInMarkerSelector;

    if (
      !isNonEmptyString(failureSelector) &&
      !isNonEmptyString(authenticatedPattern) &&
      !isNonEmptyString(loggedInSelector)
    ) {
      throw new FlowError('E_CONFIG_MISSING', {
        field: 'adapterConfig',
        missing: 'loginFailureMarkerSelector,authenticatedUrlPattern,loggedInMarkerSelector',
      });
    }

    for (;;) {
      abortIfNeeded(context.signal);
      const evidence: Evidence[] = [];

      if (isNonEmptyString(failureSelector) && context.driver.query(failureSelector)) {
        evidence.push({ kind: 'failureMarker', detail: { selector: failureSelector } });
        return { outcome: selectVerificationOutcome(['failure']), evidence };
      }

      const signals: ('failure' | 'success')[] = [];
      if (
        isNonEmptyString(authenticatedPattern) &&
        matchesUrlPattern(authenticatedPattern, context.driver.url())
      ) {
        signals.push('success');
        evidence.push({ kind: 'authenticatedUrl', detail: { pattern: authenticatedPattern } });
      }
      if (isNonEmptyString(loggedInSelector) && context.driver.query(loggedInSelector)) {
        signals.push('success');
        evidence.push({ kind: 'loggedInMarker', detail: { selector: loggedInSelector } });
      }

      if (signals.length > 0) {
        return { outcome: selectVerificationOutcome(signals), evidence };
      }
      if (Date.now() >= options.deadlineAt) return { outcome: 'unknown', evidence: [] };
      await context.driver.sleep(context.timeouts.pollMs);
    }
  }

  private collectLoginState(context: AdapterContext): {
    loggedIn: boolean;
    loggedOut: boolean;
    evidence: Evidence[];
  } {
    const evidence: Evidence[] = [];
    let loggedIn = false;
    let loggedOut = false;

    const loggedInSelector = this.config.loggedInMarkerSelector;
    if (isNonEmptyString(loggedInSelector) && context.driver.query(loggedInSelector)) {
      loggedIn = true;
      evidence.push({ kind: 'loggedInMarker', detail: { selector: loggedInSelector } });
    }

    // 登录成功 URL 规则与「已登录标记」同权：标记依赖具体页面结构，
    // URL 规则依赖站点路径；两者任一命中都足以证明已登录，避免门户改版后误判。
    const authenticatedPattern = this.config.authenticatedUrlPattern;
    if (
      isNonEmptyString(authenticatedPattern) &&
      matchesUrlPattern(authenticatedPattern, context.driver.url())
    ) {
      loggedIn = true;
      evidence.push({ kind: 'authenticatedUrl', detail: { pattern: authenticatedPattern } });
    }

    const loggedOutSelector = this.config.loggedOutMarkerSelector;
    if (isNonEmptyString(loggedOutSelector) && context.driver.query(loggedOutSelector)) {
      loggedOut = true;
      evidence.push({ kind: 'loggedOutMarker', detail: { selector: loggedOutSelector } });
    }

    const loginPattern = this.config.loginPageUrlPattern;
    if (isNonEmptyString(loginPattern) && matchesUrlPattern(loginPattern, context.driver.url())) {
      loggedOut = true;
      evidence.push({ kind: 'loginPageUrl', detail: { pattern: loginPattern } });
    }

    return { loggedIn, loggedOut, evidence };
  }

  private async waitForLogoutEvidence(context: AdapterContext): Promise<void> {
    const urlPattern = this.config.loggedOutUrlPattern;
    const markerSelector = this.config.loggedOutMarkerSelector;

    if (!isNonEmptyString(urlPattern) && !isNonEmptyString(markerSelector)) {
      throw new FlowError('E_CONFIG_MISSING', {
        field: 'adapterConfig',
        missing: 'loggedOutUrlPattern,loggedOutMarkerSelector',
      });
    }

    const deadline = Date.now() + Math.max(0, context.timeouts.logoutConfirmMs);
    for (;;) {
      abortIfNeeded(context.signal);
      this.throwIfBlocked(context);

      if (
        (isNonEmptyString(urlPattern) && matchesUrlPattern(urlPattern, context.driver.url())) ||
        (isNonEmptyString(markerSelector) && context.driver.query(markerSelector))
      ) {
        return;
      }
      if (Date.now() >= deadline) throw new FlowError('E_LOGOUT_TIMEOUT', { step: 'logout' });
      await context.driver.sleep(context.timeouts.pollMs);
    }
  }

  private throwIfBlocked(context: AdapterContext): void {
    const blocker = this.detectBlockersSync(context);
    if (blocker === 'captcha') throw new FlowError('E_BLOCKED_CAPTCHA', { step: 'probe' });
    if (blocker === 'mfa') throw new FlowError('E_BLOCKED_MFA', { step: 'probe' });
  }

  private detectBlockersSync(context: AdapterContext): 'captcha' | 'mfa' | null {
    const captcha = this.config.captchaMarkerSelector;
    const mfa = this.config.mfaMarkerSelector;
    if (isNonEmptyString(captcha) && context.driver.query(captcha)) return 'captcha';
    if (isNonEmptyString(mfa) && context.driver.query(mfa)) return 'mfa';
    return null;
  }

  private async waitForField(
    context: AdapterContext,
    selector: string,
    field: string,
  ): Promise<Element> {
    try {
      return await context.driver.waitFor(selector, {
        timeoutMs: context.timeouts.fillMs,
        signal: context.signal,
      });
    } catch (error) {
      if (isFlowError(error) && error.code === 'E_CANCELLED') throw error;
      throw new FlowError('E_FORM_NOT_FOUND', { field });
    }
  }

  private fieldError(error: unknown, field: string): FlowError {
    if (isFlowError(error) && error.code === 'E_CANCELLED') return error;
    return new FlowError('E_FILL_FAILED', { field });
  }

  private requireText(key: keyof LandrayAdapterConfig): string {
    const value = this.config[key];
    if (!isNonEmptyString(value)) {
      throw new FlowError('E_CONFIG_MISSING', { field: 'adapterConfig', missing: key });
    }
    return value.trim();
  }

  private requireSubmitTrigger(): { kind: 'formSubmit' | 'click'; selector: string } {
    const trigger = this.config.submitTrigger;
    if (
      !trigger ||
      !isNonEmptyString(trigger.selector) ||
      (trigger.kind !== 'formSubmit' && trigger.kind !== 'click')
    ) {
      throw new FlowError('E_CONFIG_MISSING', { field: 'adapterConfig', missing: 'submitTrigger' });
    }
    return { kind: trigger.kind, selector: trigger.selector.trim() };
  }

  private requireLogoutTrigger():
    | { kind: 'url'; url: string }
    | { kind: 'click'; selector: string; confirmSelector?: string } {
    const trigger = this.config.logoutTrigger;
    if (!trigger) {
      throw new FlowError('E_CONFIG_MISSING', { field: 'adapterConfig', missing: 'logoutTrigger' });
    }
    if (trigger.kind === 'url') {
      if (!isNonEmptyString(trigger.url)) {
        throw new FlowError('E_CONFIG_MISSING', {
          field: 'adapterConfig',
          missing: 'logoutTrigger.url',
        });
      }
      return { kind: 'url', url: trigger.url.trim() };
    }
    if (trigger.kind === 'click') {
      if (!isNonEmptyString(trigger.selector)) {
        throw new FlowError('E_CONFIG_MISSING', {
          field: 'adapterConfig',
          missing: 'logoutTrigger.selector',
        });
      }
      return {
        kind: 'click',
        selector: trigger.selector.trim(),
        confirmSelector: isNonEmptyString(trigger.confirmSelector)
          ? trigger.confirmSelector.trim()
          : undefined,
      };
    }
    throw new FlowError('E_CONFIG_MISSING', { field: 'adapterConfig', missing: 'logoutTrigger' });
  }
}
