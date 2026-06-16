import type { SessionInfo } from '../agent/types.js';
import type { ProTaskWorkbench, StageSessionRef } from '../pro/tasks.js';

type SessionResolver = (workdir: string, agent: string, sessionId: string) => SessionInfo | null;

function sideChatTitle(refTitle: string | null | undefined, session: SessionInfo | null, sessionId: string): string {
  return refTitle
    || session?.title
    || session?.lastQuestion
    || session?.lastMessageText
    || sessionId.slice(0, 16);
}

function stageSessionKey(session: StageSessionRef): string {
  return `${session.workdir}\0${session.agent}\0${session.sessionId}`;
}

export function enrichWorkbenchSideChats(
  workbench: ProTaskWorkbench,
  resolveSession: SessionResolver,
): ProTaskWorkbench {
  const seen = new Set<string>();
  const sideChats: ProTaskWorkbench['sideChats'] = [];

  for (const run of workbench.task.stageRuns || []) {
    const parent = resolveSession(run.session.workdir, run.session.agent, run.session.sessionId);
    const refs = parent?.sideChats || [];
    const parentWorkdir = parent?.workdir || run.session.workdir;
    for (const ref of refs) {
      if (ref.hidden) continue;
      const child = resolveSession(parentWorkdir, ref.agent, ref.sessionId);
      const entry = {
        workdir: child?.workdir || parentWorkdir,
        agent: child?.agent || ref.agent,
        sessionId: child?.sessionId || ref.sessionId,
        title: sideChatTitle(ref.title, child, ref.sessionId),
        parentStageRunId: run.id,
      };
      const key = stageSessionKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      sideChats.push(entry);
    }
  }

  return {
    ...workbench,
    sideChats,
  };
}
