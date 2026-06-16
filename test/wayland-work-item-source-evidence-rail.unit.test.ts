import { describe, expect, it } from 'vitest';
import { buildWorkItemSourceEvidenceRail } from '../dashboard/src/pages/wayland/workItemSourceEvidenceRail.ts';
import type { WorkItemSourceEvidence } from '../dashboard/src/pages/wayland/workItemSourceEvidence.ts';

const evidence = (kind: WorkItemSourceEvidence['kind'], id = kind): WorkItemSourceEvidence => ({
  id,
  kind,
  label: `${kind} label`,
  value: `${kind} value`,
});

describe('Wayland Work Item source evidence rail', () => {
  it('groups Todo, Jira, context, and daily evidence into cockpit lanes', () => {
    const rail = buildWorkItemSourceEvidenceRail([
      evidence('note', 'note-1'),
      evidence('quote', 'quote-1'),
      evidence('image', 'image-1'),
      evidence('jira-ticket', 'ticket-1'),
      evidence('jira-comment', 'comment-1'),
      evidence('jira-link', 'link-1'),
      evidence('session', 'session-1'),
      evidence('linked-chat', 'chat-1'),
      evidence('workspace', 'workspace-1'),
      evidence('linked-task', 'task-1'),
      evidence('daily', 'daily-1'),
    ]);

    expect(rail).toMatchObject({
      title: 'Source graph ready',
      tone: 'ok',
      totalCount: 11,
    });
    expect(rail.lanes.map(lane => [lane.key, lane.evidence.length, lane.tone])).toEqual([
      ['inbox', 3, 'ok'],
      ['remote', 3, 'primary'],
      ['context', 4, 'ok'],
      ['plan', 1, 'primary'],
    ]);
  });

  it('returns a warn state when evidence is missing', () => {
    const rail = buildWorkItemSourceEvidenceRail([]);

    expect(rail).toMatchObject({
      title: 'Source evidence missing',
      tone: 'warn',
      totalCount: 0,
    });
    expect(rail.lanes.every(lane => lane.evidence.length === 0 && lane.tone === 'idle')).toBe(true);
  });
});
