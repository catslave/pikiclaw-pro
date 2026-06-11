import { Button } from '../../../components/ui';
import type { FocusContextPayload } from '../../../types';

export function FocusResumeBanner({
  focusContext,
  locale,
  onContinue,
  onDismiss,
}: {
  focusContext: FocusContextPayload;
  locale: string;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const zh = locale === 'zh-CN';
  return (
    <div className="border-b border-primary/20 bg-primary/[0.06] px-4 py-3">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            {zh ? 'Focus 断点续传' : 'Focus resume'}
          </div>
          <p className="mt-1 text-sm text-fg">
            {focusContext.breakpoint || (zh ? '欢迎回来，继续上次现场。' : 'Welcome back. Continue where you left off.')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {focusContext.suggestedActions.slice(0, 3).map(action => (
            <Button key={action} variant="outline" onClick={onContinue}>{action}</Button>
          ))}
          <Button variant="primary" onClick={onContinue}>{zh ? '继续现场' : 'Continue'}</Button>
          <Button variant="ghost" onClick={onDismiss}>{zh ? '关闭' : 'Dismiss'}</Button>
        </div>
      </div>
    </div>
  );
}
