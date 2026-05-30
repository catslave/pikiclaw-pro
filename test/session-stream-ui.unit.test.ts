import { describe, expect, it } from 'vitest';
import {
  assistantHasFinalOutput,
  assistantHasProcessOnlyOutput,
  hasRunningTurnForQueue,
  isLiveStreamActive,
  isStaleDoneSnapshotForPending,
  isStaleStreamingSnapshotAfterDone,
  liveStreamAlreadyInHistory,
  resolveEffectiveLiveStream,
  shouldSkipEmptyStreamingHandoff,
  willQueueSendOnStart,
} from '../dashboard/src/pages/sessions/stream-ui.ts';

describe('session stream UI helpers', () => {
  describe('hasRunningTurnForQueue', () => {
    it('treats active streaming as running', () => {
      expect(hasRunningTurnForQueue({
        streaming: true,
        streamPhase: null,
        pendingPrompt: null,
        pendingTaskId: null,
        queuedTaskCount: 0,
      })).toBe(true);
      expect(hasRunningTurnForQueue({
        streaming: false,
        streamPhase: 'streaming',
        pendingPrompt: null,
        pendingTaskId: null,
        queuedTaskCount: 0,
      })).toBe(true);
    });

    it('treats accepted pending task as running before stream starts', () => {
      expect(hasRunningTurnForQueue({
        streaming: false,
        streamPhase: null,
        pendingPrompt: 'hello',
        pendingTaskId: 'task-1',
        queuedTaskCount: 0,
      })).toBe(true);
      expect(hasRunningTurnForQueue({
        streaming: false,
        streamPhase: 'queued',
        pendingPrompt: 'hello',
        pendingTaskId: 'task-1',
        queuedTaskCount: 0,
      })).toBe(true);
    });

    it('does not treat done handoff pending as running', () => {
      expect(hasRunningTurnForQueue({
        streaming: false,
        streamPhase: 'done',
        pendingPrompt: 'hello',
        pendingTaskId: 'task-1',
        queuedTaskCount: 0,
      })).toBe(false);
    });

    it('does not treat pending without taskId as running', () => {
      expect(hasRunningTurnForQueue({
        streaming: false,
        streamPhase: 'queued',
        pendingPrompt: 'hello',
        pendingTaskId: null,
        queuedTaskCount: 0,
      })).toBe(false);
    });
  });

  describe('willQueueSendOnStart', () => {
    it('queues when server already has queued tasks', () => {
      expect(willQueueSendOnStart({
        streaming: false,
        streamPhase: 'done',
        pendingPrompt: 'old',
        pendingTaskId: 'task-1',
        queuedTaskCount: 1,
      })).toBe(true);
    });

    it('allows fresh send during done handoff when queue is empty', () => {
      expect(willQueueSendOnStart({
        streaming: false,
        streamPhase: 'done',
        pendingPrompt: 'old',
        pendingTaskId: 'task-1',
        queuedTaskCount: 0,
      })).toBe(false);
    });
  });

  describe('assistant output classification', () => {
    it('detects final vs process-only assistant output', () => {
      expect(assistantHasFinalOutput({ blocks: [{ type: 'text', content: 'done' }] })).toBe(true);
      expect(assistantHasProcessOnlyOutput({ blocks: [{ type: 'text', content: 'done' }] })).toBe(false);
      expect(assistantHasProcessOnlyOutput({
        blocks: [{ type: 'tool_use', content: '{}', toolName: 'Read' }],
      })).toBe(true);
      expect(assistantHasFinalOutput({
        blocks: [{ type: 'tool_use', content: '{}', toolName: 'Read' }],
      })).toBe(false);
    });
  });

  describe('resolveEffectiveLiveStream', () => {
    it('reuses live stream when prompt and task match pending', () => {
      const live = { taskId: 't1', prompt: 'hello', phase: 'streaming' as const, text: 'partial' };
      expect(resolveEffectiveLiveStream({
        liveStream: live,
        pendingPrompt: 'hello',
        pendingTaskId: 't1',
        streamSnapshotActive: true,
        streamTaskId: 't1',
        displayModel: 'gpt',
        displayEffort: 'medium',
      })).toBe(live);
    });

    it('drops stale live stream when pending prompt changed', () => {
      const shell = resolveEffectiveLiveStream({
        liveStream: { taskId: 't-old', prompt: 'old prompt', text: 'stale' },
        pendingPrompt: 'new prompt',
        pendingTaskId: null,
        streamSnapshotActive: true,
        streamTaskId: 't-new',
        displayModel: null,
        displayEffort: null,
      });
      expect(shell).toMatchObject({
        taskId: 't-new',
        prompt: 'new prompt',
        phase: 'streaming',
        text: '',
      });
    });

    it('keeps live stream content when slash command display prompt differs but task matches', () => {
      const live = {
        taskId: 't-plan',
        prompt: 'Continue planning mode for the current session. Do not implement yet.',
        phase: 'streaming' as const,
        text: '',
        activity: 'Search: dashboard session stream',
      };
      expect(resolveEffectiveLiveStream({
        liveStream: live,
        pendingPrompt: '/plan clarify dashboard session stream',
        pendingTaskId: 't-plan',
        streamSnapshotActive: true,
        streamTaskId: 't-plan',
        displayModel: 'gpt',
        displayEffort: 'medium',
      })).toBe(live);
    });

    it('returns null when snapshot is inactive and live stream mismatches', () => {
      expect(resolveEffectiveLiveStream({
        liveStream: { taskId: 't-old', prompt: 'old', text: 'stale' },
        pendingPrompt: 'new',
        pendingTaskId: null,
        streamSnapshotActive: false,
        streamTaskId: null,
        displayModel: null,
        displayEffort: null,
      })).toBeNull();
    });
  });

  describe('shouldSkipEmptyStreamingHandoff', () => {
    it('skips empty overwrite while previous task handoff is in flight', () => {
      expect(shouldSkipEmptyStreamingHandoff({
        clearLiveStreamOnLoad: true,
        liveStreamTaskId: 'task-a',
        incomingTaskId: 'task-b',
        incomingText: '',
        pendingPrompt: 'same prompt',
        liveStreamPrompt: 'same prompt',
      })).toBe(true);
    });

    it('allows empty overwrite when pending prompt owns a new turn', () => {
      expect(shouldSkipEmptyStreamingHandoff({
        clearLiveStreamOnLoad: true,
        liveStreamTaskId: 'task-a',
        incomingTaskId: 'task-b',
        incomingText: '',
        pendingPrompt: 'fresh send',
        liveStreamPrompt: 'old prompt',
      })).toBe(false);
    });
  });

  describe('isStaleDoneSnapshotForPending', () => {
    it('ignores a previous done snapshot after a fresh send starts locally', () => {
      expect(isStaleDoneSnapshotForPending({
        phase: 'done',
        pendingPrompt: 'new message',
        pendingTaskId: null,
        pendingCreatedAt: '2026-05-29T09:00:10.000Z',
        snapshotTaskId: 'old-task',
        snapshotPrompt: 'old message',
        snapshotCompletedAt: '2026-05-29T09:00:00.000Z',
        snapshotUpdatedAt: '2026-05-29T09:00:00.000Z',
      })).toBe(true);
    });

    it('keeps the done snapshot for the accepted pending task', () => {
      expect(isStaleDoneSnapshotForPending({
        phase: 'done',
        pendingPrompt: 'new message',
        pendingTaskId: 'new-task',
        pendingCreatedAt: '2026-05-29T09:00:00.000Z',
        snapshotTaskId: 'new-task',
        snapshotPrompt: 'new message',
        snapshotCompletedAt: '2026-05-29T09:00:10.000Z',
        snapshotUpdatedAt: '2026-05-29T09:00:10.000Z',
      })).toBe(false);
    });

    it('treats a different completed task id as stale once the new task is assigned', () => {
      expect(isStaleDoneSnapshotForPending({
        phase: 'done',
        pendingPrompt: 'new message',
        pendingTaskId: 'new-task',
        pendingCreatedAt: '2026-05-29T09:00:00.000Z',
        snapshotTaskId: 'old-task',
        snapshotPrompt: null,
        snapshotCompletedAt: null,
        snapshotUpdatedAt: null,
      })).toBe(true);
    });
  });

  describe('isLiveStreamActive', () => {
    it('treats a local send without task id as active before the server accepts it', () => {
      expect(isLiveStreamActive({
        streaming: false,
        streamPhase: null,
        liveStreamPhase: null,
        pendingPrompt: 'new message',
        pendingTaskId: null,
        pendingImageCount: 0,
      })).toBe(true);
    });

    it('does not keep a done snapshot active just because pending text is still visible during handoff', () => {
      expect(isLiveStreamActive({
        streaming: false,
        streamPhase: 'done',
        liveStreamPhase: 'done',
        pendingPrompt: 'new message',
        pendingTaskId: 'task-1',
        pendingImageCount: 0,
      })).toBe(false);
    });

    it('keeps true streaming snapshots active', () => {
      expect(isLiveStreamActive({
        streaming: false,
        streamPhase: 'streaming',
        liveStreamPhase: 'done',
        pendingPrompt: null,
        pendingTaskId: null,
        pendingImageCount: 0,
      })).toBe(true);
    });
  });

  describe('isStaleStreamingSnapshotAfterDone', () => {
    it('ignores a streaming replay for a task already handed off as done', () => {
      expect(isStaleStreamingSnapshotAfterDone({
        phase: 'streaming',
        snapshotTaskId: 'task-1',
        doneHandoffTaskId: 'task-1',
      })).toBe(true);
    });

    it('allows a different task to start streaming after done handoff', () => {
      expect(isStaleStreamingSnapshotAfterDone({
        phase: 'streaming',
        snapshotTaskId: 'task-2',
        doneHandoffTaskId: 'task-1',
      })).toBe(false);
    });
  });

  describe('liveStreamAlreadyInHistory', () => {
    it('hides live preview when final assistant is already persisted', () => {
      expect(liveStreamAlreadyInHistory({
        hasEffectiveLiveStream: true,
        lastTurnUserText: 'hello',
        lastAssistantHasFinalOutput: true,
        activeLivePrompt: 'hello',
        effectiveTaskId: 't1',
        doneHandoffTaskId: 't1',
      })).toBe(true);
    });

    it('keeps live preview when assistant only has process output', () => {
      expect(liveStreamAlreadyInHistory({
        hasEffectiveLiveStream: true,
        lastTurnUserText: 'hello',
        lastAssistantHasFinalOutput: false,
        activeLivePrompt: 'hello',
        effectiveTaskId: 't1',
        doneHandoffTaskId: 't1',
      })).toBe(false);
    });
  });
});
