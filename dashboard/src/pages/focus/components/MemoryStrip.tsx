import type { FocusCommandCenter, FocusOutputItem, FocusSessionItem } from '../../../types';
import { Badge, Button } from '../../../components/ui';

export function MemoryStrip({
  command,
  outputs,
  candidates,
  copy,
  onOpenOutput,
  onExtract,
}: {
  command: FocusCommandCenter;
  outputs: FocusOutputItem[];
  candidates: FocusSessionItem[];
  copy: Record<string, string>;
  onOpenOutput: (item: FocusOutputItem) => void;
  onExtract: (item: FocusSessionItem) => void;
}) {
  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <h2 className="text-base font-semibold text-fg">{copy.memory}</h2>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md bg-panel-alt px-3 py-2"><span className="text-fg-5">{copy.knowledge}</span><div className="font-semibold text-fg">{command.memory.knowledgeCount}</div></div>
        <div className="rounded-md bg-panel-alt px-3 py-2"><span className="text-fg-5">{copy.outputs}</span><div className="font-semibold text-fg">{command.memory.outputCount}</div></div>
        <div className="rounded-md bg-panel-alt px-3 py-2"><span className="text-fg-5">{copy.candidates}</span><div className="font-semibold text-fg">{command.memory.candidateCount}</div></div>
        <div className="rounded-md bg-panel-alt px-3 py-2"><span className="text-fg-5">{copy.hidden}</span><div className="font-semibold text-fg">{command.memory.hiddenKnowledgeCount}</div></div>
      </div>
      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-fg">{copy.artifacts}</h3>
          <Badge variant="muted">{outputs.length}</Badge>
        </div>
        <div className="space-y-2">
          {outputs.slice(0, 6).map(item => (
            <button key={item.id} type="button" className="w-full rounded-md border border-edge/70 bg-panel-alt px-3 py-2 text-left" onClick={() => onOpenOutput(item)}>
              <div className="truncate text-sm font-medium text-fg">{item.title}</div>
              <div className="truncate text-xs text-fg-5">{item.summary || item.path || item.url}</div>
            </button>
          ))}
          {!outputs.length && <div className="rounded-md border border-dashed border-edge px-3 py-4 text-center text-xs text-fg-5">{copy.emptyArtifacts}</div>}
        </div>
      </div>
      {candidates.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-fg">{copy.pendingExtract}</h3>
            <Badge variant="muted">{candidates.length}</Badge>
          </div>
          <div className="space-y-2">
            {candidates.slice(0, 5).map(item => (
              <div key={item.key} className="flex items-center justify-between gap-2 rounded-md border border-edge/70 bg-panel-alt px-3 py-2">
                <div className="min-w-0 truncate text-sm text-fg">{item.session.title || item.session.lastQuestion || item.key}</div>
                <Button variant="outline" onClick={() => onExtract(item)}>{copy.extract}</Button>
              </div>
            ))}
          </div>
        </div>
      )}
      {command.git.length > 0 && (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-fg">{copy.git}</h3>
          {command.git.slice(0, 4).map(item => (
            <div key={item.workdir} className="rounded-md border border-edge/70 bg-panel-alt px-3 py-2 text-xs text-fg-4">
              <div className="font-medium text-fg">{item.workspaceName}</div>
              <div>{copy.branch}: {item.branch || '—'} · {copy.changed}: {item.changedFiles}</div>
              {item.lastCommitMessage && <div className="mt-1 truncate text-fg-5">{item.lastCommitMessage}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
