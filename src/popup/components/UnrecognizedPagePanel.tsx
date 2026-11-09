import type { PageKind } from '../../shared/types/system';
import { Button } from '../../ui/Button';

const NON_OA_TEXT: Record<Exclude<PageKind, 'web'>, string> = {
  extension: '当前是扩展页面，不是 OA 页面。请先切到 OA 标签页。',
  newtab: '当前是新标签页，不是 OA 页面。请先切到 OA 标签页。',
  browser: '当前是浏览器内置页面，不是 OA 页面。请先切到 OA 标签页。',
  unknown: '无法读取当前标签页地址。请先切到 OA 标签页，再打开本扩展。',
};

function heading(pageKind: PageKind): string {
  return pageKind === 'web' ? '未识别当前页面' : '请先切到 OA 标签页';
}

function description(pageKind: PageKind): string {
  if (pageKind === 'web') {
    return '当前页面不属于任何已配置并启用的 OA 系统。为避免误操作，未自动执行任何流程。';
  }
  return NON_OA_TEXT[pageKind];
}

export interface UnrecognizedPagePanelProps {
  pageKind: PageKind;
  origin: string | null;
  busy?: boolean;
  onOpenOaTab: () => void;
  onShowAllSystems: () => void;
}

/** 未识别态：不渲染普通账号列表，避免静默显示「尚未添加账号」。 */
export function UnrecognizedPagePanel({
  pageKind,
  origin,
  busy,
  onOpenOaTab,
  onShowAllSystems,
}: UnrecognizedPagePanelProps) {
  return (
    <div className="card p-3" data-testid="unrecognized-page">
      <p className="text-[13px] font-medium">{heading(pageKind)}</p>
      <p className="mt-1 text-[11px] text-muted">{description(pageKind)}</p>
      {origin ? <p className="code mt-1 text-[10px] text-muted">origin={origin}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={onOpenOaTab}>
          切到 OA 标签页
        </Button>
        <Button disabled={busy} onClick={onShowAllSystems}>
          查看全部系统
        </Button>
      </div>
    </div>
  );
}
