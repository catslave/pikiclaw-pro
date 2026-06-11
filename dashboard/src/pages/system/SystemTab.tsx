import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createT } from '../../i18n';
import { useStore } from '../../store';
import { api } from '../../api';
import { buildHostMetricItems, formatHostSummary, SystemInfoList } from '../../components/SystemInfoPanel';
import { Button, Spinner } from '../../components/ui';
import { SectionCard } from '../shared';
import { PermissionsTab } from '../permissions/PermissionsTab';
import { ArchiveTab } from '../archive/ArchiveTab';

type SystemView = 'overview' | 'archive';

export function SystemTab({
  onOpenWorkdir,
}: {
  onOpenWorkdir: () => void;
}) {
  const state = useStore(s => s.state);
  const host = useStore(s => s.host);
  const locale = useStore(s => s.locale);
  const reload = useStore(s => s.reload);
  const toast = useStore(s => s.toast);
  const t = useMemo(() => createT(locale), [locale]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [savingRecallIndex, setSavingRecallIndex] = useState(false);
  const activeView: SystemView = searchParams.get('view') === 'archive' ? 'archive' : 'overview';
  const currentWorkdir = state?.bot?.workdir || state?.runtimeWorkdir || state?.config.workdir || '';
  const chatRecallIndexEnabled = state?.config.chatRecallIndexEnabled === true;
  const hostSummary = formatHostSummary(host);
  const switchView = (view: SystemView) => {
    setSearchParams(view === 'archive' ? { view: 'archive' } : {}, { replace: true });
  };
  const toggleChatRecallIndex = async () => {
    const nextEnabled = !chatRecallIndexEnabled;
    setSavingRecallIndex(true);
    try {
      await api.saveConfig({ chatRecallIndexEnabled: nextEnabled });
      await reload();
      toast(nextEnabled ? t('system.chatRecallEnabled') : t('system.chatRecallDisabled'));
    } catch (err) {
      toast(err instanceof Error ? err.message : t('system.chatRecallSaveFailed'), false);
    } finally {
      setSavingRecallIndex(false);
    }
  };

  return (
    <div className="animate-in space-y-3">
      <SectionCard className="!p-2">
        <div className="flex flex-wrap items-center gap-1">
          {([
            ['overview', t('tab.system')],
            ['archive', t('tab.archive')],
          ] as const).map(([view, label]) => (
            <button
              key={view}
              type="button"
              onClick={() => switchView(view)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                activeView === view
                  ? 'bg-panel-h text-fg shadow-[0_1px_0_rgba(255,255,255,0.03)]'
                  : 'text-fg-4 hover:bg-panel-alt hover:text-fg-2'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </SectionCard>

      {activeView === 'archive' ? (
        <ArchiveTab />
      ) : (
        <>
          <SectionCard className="!p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-semibold tracking-tight text-fg">{t('config.workdir')}</span>
                </div>
                <div className="mt-0.5 break-all font-mono text-[12px] leading-relaxed text-fg-2">
                  {currentWorkdir || t('sidebar.notSet')}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={onOpenWorkdir}>
                {t('sidebar.switchDir')}
              </Button>
            </div>
          </SectionCard>

          <SectionCard className="space-y-2 !p-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[13px] font-semibold tracking-tight text-fg">{t('app.systemInfo')}</span>
                <span className="truncate text-[11px] text-fg-5">{hostSummary || t('status.loading')}</span>
              </div>
              <div className="text-[11px] text-fg-5">
                {state?.version ? `Pikiclaw Pro v${state.version}` : 'Pikiclaw Pro'}
                {state?.nodeVersion ? ` · Node ${state.nodeVersion}` : ''}
              </div>
            </div>

            <SystemInfoList items={buildHostMetricItems(host, t)} loading={!host} />
          </SectionCard>

          <SectionCard className="space-y-3 !p-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold tracking-tight text-fg">{t('system.experimentalFeatures')}</div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-fg-5">{t('system.experimentalFeaturesHint')}</div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge/60 bg-panel-alt/70 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-fg-2">{t('system.chatRecallTitle')}</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-fg-5">{t('system.chatRecallDesc')}</div>
                </div>
                <Button
                  variant={chatRecallIndexEnabled ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => void toggleChatRecallIndex()}
                  disabled={savingRecallIndex}
                  aria-pressed={chatRecallIndexEnabled}
                >
                  {savingRecallIndex && <Spinner className="h-3 w-3" />}
                  <span>{chatRecallIndexEnabled ? t('system.featureOn') : t('system.featureOff')}</span>
                </Button>
              </div>
            </div>
          </SectionCard>

          <SectionCard className="space-y-2 !p-3.5">
            <div className="text-[13px] font-semibold tracking-tight text-fg">{t('tab.permissions')}</div>
            <PermissionsTab />
          </SectionCard>
        </>
      )}
    </div>
  );
}
