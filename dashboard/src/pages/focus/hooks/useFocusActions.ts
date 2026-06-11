import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api';
import type {
  FocusAction,
  FocusContextPayload,
  FocusOutputItem,
  FocusSandbox,
  KnowledgeSourceRef,
  SessionContextSource,
} from '../../../types';
import { resolveExecutorAgentForSandboxKind } from '../focus-agent-routing';

function contextSource(ref: KnowledgeSourceRef, title?: string | null): SessionContextSource | null {
  if (ref.type !== 'chat' || !ref.workdir || !ref.agent || !ref.sessionId) return null;
  return {
    kind: 'session',
    workdir: ref.workdir,
    agent: ref.agent,
    sessionId: ref.sessionId,
    title: title || ref.title || 'Source chat',
    mode: 'compact',
  };
}

export function useFocusActions(toast: (message: string, ok?: boolean) => void, copy: { failed: string; opened: string; queued: string }) {
  const navigate = useNavigate();
  const [maintaining, setMaintaining] = useState(false);

  const continueWithContext = useCallback((
    ref: KnowledgeSourceRef,
    title: string,
    prompt: string,
    focusContext?: FocusContextPayload,
  ) => {
    const source = contextSource(ref, title);
    if (!source) return;
    navigate('/chat', {
      state: {
        newSessionAgent: ref.agent,
        newSessionPrompt: prompt,
        newSessionAutoSend: false,
        newSessionNonce: Date.now(),
        newSessionContextSource: source,
        newSessionReferenceTitle: title || ref.title || 'Focus context',
        focusContext,
      },
    });
  }, [navigate]);

  const openSource = useCallback((ref: KnowledgeSourceRef) => {
    navigate('/chat', {
      state: {
        openSessionWorkdir: ref.workdir,
        openSessionAgent: ref.agent,
        openSessionId: ref.sessionId,
        openSessionNonce: Date.now(),
      },
    });
  }, [navigate]);

  const openTask = useCallback((taskId: string, focusContext?: FocusContextPayload) => {
    navigate('/tasks', { state: { openTaskId: taskId, openTaskNonce: Date.now(), focusContext } });
  }, [navigate]);

  const openUrl = useCallback(async (url: string) => {
    try {
      const result = await api.openExternalUrl(url);
      if (!result.ok) throw new Error(result.error || copy.failed);
      toast(copy.opened);
    } catch (err) {
      toast(err instanceof Error ? err.message : copy.failed, false);
    }
  }, [copy.failed, copy.opened, toast]);

  const openOutput = useCallback(async (item: FocusOutputItem) => {
    try {
      const result = item.url
        ? await api.openExternalUrl(item.url)
        : item.path
          ? await api.openInEditor(item.path)
          : { ok: false, error: 'No path or URL' };
      if (!result.ok) throw new Error(result.error || copy.failed);
      toast(copy.opened);
    } catch (err) {
      toast(err instanceof Error ? err.message : copy.failed, false);
    }
  }, [copy.failed, copy.opened, toast]);

  const runMaintenance = useCallback(async (reload: () => Promise<void>) => {
    setMaintaining(true);
    try {
      const result = await api.runFocusMaintenance();
      toast(`${copy.queued}: ${result.queued.length}`);
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : copy.failed, false);
    } finally {
      setMaintaining(false);
    }
  }, [copy.failed, copy.queued, toast]);

  const extractCandidate = useCallback(async (workdir: string, agent: string, sessionId: string, reload: () => Promise<void>) => {
    try {
      const result = await api.extractFocusChat({ workdir, agent, sessionId });
      if (!result.ok) throw new Error(result.error || copy.failed);
      toast(copy.queued);
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : copy.failed, false);
    }
  }, [copy.failed, copy.queued, toast]);

  const syncTaskJira = useCallback(async (taskId: string) => {
    try {
      const result = await api.syncFocusTaskJira(taskId);
      if (!result.ok) throw new Error(result.error || copy.failed);
      toast(copy.opened);
    } catch (err) {
      toast(err instanceof Error ? err.message : copy.failed, false);
    }
  }, [copy.failed, copy.opened, toast]);

  const buildFocusContext = useCallback((sandbox: FocusSandbox): FocusContextPayload => ({
    sandboxId: sandbox.id,
    breakpoint: sandbox.breakpoint || sandbox.summary || null,
    suggestedActions: sandbox.nextActions.slice(0, 3),
    sourceRef: sandbox.sourceRef || null,
    resumeMode: true,
    agentHint: resolveExecutorAgentForSandboxKind(sandbox.type),
    taskId: sandbox.taskId || null,
  }), []);

  const runAction = useCallback((action?: FocusAction | null, sandbox?: FocusSandbox | null) => {
    if (!action) return;
    const focusContext = sandbox ? buildFocusContext(sandbox) : undefined;
    if (action.kind === 'continue' && action.sourceRef) {
      continueWithContext(action.sourceRef, action.sourceRef.title, '', focusContext);
      return;
    }
    if (action.kind === 'open-source' && action.sourceRef) {
      openSource(action.sourceRef);
      return;
    }
    if (action.kind === 'open-task' && action.taskId) {
      openTask(action.taskId, focusContext);
      return;
    }
    if (action.kind === 'sync' && action.taskId) {
      void syncTaskJira(action.taskId);
      return;
    }
    if (action.url) void openUrl(action.url);
  }, [buildFocusContext, continueWithContext, openSource, openTask, openUrl, syncTaskJira]);

  const continueSandbox = useCallback((sandbox: FocusSandbox) => {
    const focusContext = buildFocusContext(sandbox);
    if (sandbox.sourceRef) {
      continueWithContext(sandbox.sourceRef, sandbox.title, '', focusContext);
      return;
    }
    if (sandbox.taskId) {
      openTask(sandbox.taskId, focusContext);
      return;
    }
    if (sandbox.jiraUrl) void openUrl(sandbox.jiraUrl);
  }, [buildFocusContext, continueWithContext, openTask, openUrl]);

  const openSandbox = useCallback((sandbox: FocusSandbox) => {
    if (sandbox.sourceRef) {
      openSource(sandbox.sourceRef);
      return;
    }
    if (sandbox.taskId) {
      openTask(sandbox.taskId, buildFocusContext(sandbox));
      return;
    }
    if (sandbox.jiraUrl) void openUrl(sandbox.jiraUrl);
  }, [buildFocusContext, openSource, openTask, openUrl]);

  return {
    maintaining,
    runAction,
    continueSandbox,
    openSandbox,
    openOutput,
    runMaintenance,
    extractCandidate,
    syncTaskJira,
  };
}
