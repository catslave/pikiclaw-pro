import { describe, expect, it } from 'vitest';
import type { ProTask } from '../dashboard/src/types';
import { resolveWorkItemSourceEvidenceDisplay } from '../dashboard/src/pages/wayland/workItemSourceEvidenceDisplay';

describe('Wayland work item source evidence display', () => {
  it('keeps regular evidence unchanged', () => {
    expect(resolveWorkItemSourceEvidenceDisplay({
      id: 'quote',
      kind: 'quote',
      label: 'Quote',
      value: 'Original user request',
      detail: 'Original user request with more context',
    })).toEqual({
      label: 'Quote',
      value: 'Original user request',
      detail: 'Original user request with more context',
    });
  });

  it('resolves linked task evidence into a readable work object', () => {
    const linkedTask = {
      id: 'task_evidence',
      localKey: 'PCL-27',
      title: 'Evidence capture for Todo source',
      status: 'backlog',
      stage: 'triage',
      workdir: '/Users/michael.yang/Codes/Personal/pikiclaw',
    } as ProTask;

    expect(resolveWorkItemSourceEvidenceDisplay({
      id: 'linked-task:task_evidence',
      kind: 'linked-task',
      label: 'Linked Work Item',
      value: 'task_evidence',
    }, linkedTask)).toEqual({
      label: 'Linked Work Item',
      value: 'PCL-27 - Evidence capture for Todo source',
      detail: 'backlog - triage - /Users/michael.yang/Codes/Personal/pikiclaw',
    });
  });

  it('keeps missing linked task evidence inspectable', () => {
    expect(resolveWorkItemSourceEvidenceDisplay({
      id: 'linked-task:missing',
      kind: 'linked-task',
      label: 'Linked Work Item',
      value: 'missing',
    }, null)).toEqual({
      label: 'Linked Work Item',
      value: 'missing',
      detail: 'Linked Work Item is not loaded in the current task index.',
    });
  });
});
