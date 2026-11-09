import type { ResolveBasis } from '../../shared/types/system';

export function basisText(basis: ResolveBasis | null): string {
  if (!basis) return '未识别';
  if (basis.kind === 'signature') {
    return basis.pattern ? `登录页 / URL 规则 ${basis.pattern}` : 'URL 规则';
  }
  if (basis.kind === 'remembered') return '记住的路径选择';
  return '域名 origin';
}

export interface SystemBadgeProps {
  name: string;
  basis: ResolveBasis | null;
  /** 用户从「查看其他系统」手动选择时，说明当前页并不属于该系统。 */
  manual?: boolean;
}

/** 头部系统标识：系统名 + 识别依据，让用户知道「为什么显示这个系统」。 */
export function SystemBadge({ name, basis, manual }: SystemBadgeProps) {
  return (
    <div className="flex flex-col">
      <span className="text-[13px] font-medium">{name}</span>
      <span className="text-[10px] text-muted">
        识别依据：{manual ? '手动选择（来自其他系统）' : basisText(basis)}
      </span>
    </div>
  );
}
