import { FlowError } from '../shared/types/errors';
import type { AdapterConfig, OaVendor } from '../shared/types/system';
import { LandrayAdapter } from './landray/adapter';
import { UnsupportedAdapter } from './unsupported';
import type { OaAdapter } from './types';

export const ADAPTER_BUNDLE_VERSION = '0.2.0-phase3';

/** vendor → Adapter 工厂。未知 vendor 一律返回不支持实现，绝不猜测。 */
export function createAdapter(vendor: OaVendor, config: AdapterConfig): OaAdapter {
  switch (vendor) {
    case 'landray':
      return new LandrayAdapter(config);
    case 'other':
      return new UnsupportedAdapter();
    default:
      throw new FlowError('E_SYSTEM_UNSUPPORTED', { vendor: String(vendor) });
  }
}
