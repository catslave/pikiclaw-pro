import { describe, expect, it } from 'vitest';
import {
  parseWorkItemEvidenceSessionRef,
  workItemHasSourceEvidence,
  workItemSourceEvidence,
} from '../dashboard/src/pages/wayland/workItemSourceEvidence';

describe('Wayland work item source evidence', () => {
  it('extracts inbox note, quote, image, session, workspace, and linked chat evidence', () => {
    const evidence = workItemSourceEvidence({
      kind: 'todo',
      description: [
        'Inbox note:',
        'Follow up on the dashboard overflow.',
        '',
        'Quoted source:',
        'The Source tab hides the actual quote.',
        '',
        'Images:',
        '- screenshot.png (42 KB)',
        '- trace.png',
        '',
        'Source session: codex:abc123 turn 4',
        '',
        'Source workspace: /Users/michael.yang/Codes/Personal/pikiclaw',
        '',
        'Linked chat: codex:def456',
      ].join('\n'),
    });

    expect(evidence.map(item => item.kind)).toEqual([
      'note',
      'quote',
      'image',
      'image',
      'session',
      'workspace',
      'linked-chat',
    ]);
    expect(evidence.find(item => item.kind === 'quote')?.value).toBe('The Source tab hides the actual quote.');
    expect(evidence.filter(item => item.kind === 'image').map(item => item.value)).toEqual(['screenshot.png (42 KB)', 'trace.png']);
  });

  it('keeps consecutive source lines as separate evidence items', () => {
    const evidence = workItemSourceEvidence({
      kind: 'todo',
      description: [
        'Source session: codex/session-42',
        'Source workspace: /Users/michael.yang/Codes/Personal/pikiclaw',
        'Linked chat: /chat?session=session-42',
      ].join('\n'),
    });

    expect(evidence.map(item => [item.kind, item.value])).toEqual([
      ['session', 'codex/session-42'],
      ['workspace', '/Users/michael.yang/Codes/Personal/pikiclaw'],
      ['linked-chat', '/chat?session=session-42'],
    ]);
  });

  it('parses actionable session references from source evidence', () => {
    expect(parseWorkItemEvidenceSessionRef('codex/session-42')).toEqual({ agent: 'codex', sessionId: 'session-42' });
    expect(parseWorkItemEvidenceSessionRef('claude:abc123')).toEqual({ agent: 'claude', sessionId: 'abc123' });
    expect(parseWorkItemEvidenceSessionRef('session-only')).toBeNull();
  });

  it('extracts note promotion evidence from note-created work item descriptions', () => {
    const evidence = workItemSourceEvidence({
      kind: 'manual',
      description: 'From note: Daily 2026-06-14\n\nReview the current Work Item source model.',
    });

    expect(evidence).toEqual([
      {
        id: 'note:Daily 2026-06-14',
        kind: 'note',
        label: 'Source note',
        value: 'Daily 2026-06-14',
      },
    ]);
  });

  it('keeps daily planned work item evidence visible', () => {
    const evidence = workItemSourceEvidence({
      kind: 'manual',
      plannedDate: '2026-06-14',
      linkedTaskId: 'task_prev',
    });

    expect(evidence).toEqual([
      {
        id: 'daily:2026-06-14',
        kind: 'daily',
        label: 'Daily plan',
        value: '2026-06-14',
        detail: 'Related task task_prev',
      },
      {
        id: 'linked-task:task_prev',
        kind: 'linked-task',
        label: 'Linked Work Item',
        value: 'task_prev',
      },
    ]);
  });

  it('marks native evidence tasks as Source-first candidates', () => {
    expect(workItemHasSourceEvidence({
      kind: 'todo',
      description: 'Source workspace: /Users/michael.yang/Codes/Personal/pikiclaw',
    })).toBe(true);
    expect(workItemHasSourceEvidence({ kind: 'manual', description: '' })).toBe(false);
  });

  it('extracts Jira ticket, comment, linked issue, and remote link evidence', () => {
    const evidence = workItemSourceEvidence({
      kind: 'jira-bug',
      description: 'Ticket body',
      jiraKey: 'PRO-123',
      jiraUrl: 'https://jira.example/browse/PRO-123',
      jiraFields: {
        issueType: 'Bug',
        status: 'In Progress',
        assignee: 'Michael',
        priority: 'High',
        updatedAt: '2026-06-14T10:00:00.000Z',
        raw: {
          comment: {
            comments: [
              {
                id: 'c1',
                author: { displayName: 'Alice' },
                created: '2026-06-14T09:00:00.000Z',
                body: {
                  type: 'doc',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'Please check the linked trace before coding.' }] },
                  ],
                },
              },
            ],
          },
          issuelinks: [
            {
              type: { outward: 'blocks' },
              outwardIssue: {
                key: 'PRO-456',
                fields: { summary: 'Dependent platform fix' },
              },
            },
          ],
          remoteLinks: [
            {
              object: {
                title: 'Merge request - PRO-123',
                url: 'https://gitlab.example/group/app/-/merge_requests/105',
              },
            },
          ],
        },
      },
    });

    expect(evidence.map(item => item.kind)).toEqual([
      'jira-ticket',
      'jira-comment',
      'jira-link',
      'jira-link',
    ]);
    expect(evidence[0]).toMatchObject({
      label: 'Jira ticket',
      value: 'PRO-123',
      url: 'https://jira.example/browse/PRO-123',
    });
    expect(evidence.find(item => item.kind === 'jira-comment')?.detail).toBe('Please check the linked trace before coding.');
    expect(evidence.find(item => item.value === 'PRO-456')?.url).toBe('https://jira.ringcentral.com/browse/PRO-456');
    expect(evidence.find(item => item.value === 'Merge request - PRO-123')?.url).toBe('https://gitlab.example/group/app/-/merge_requests/105');
    expect(evidence.find(item => item.value === 'Merge request - PRO-123')?.detail).toBe('Merge request - PRO-123\nhttps://gitlab.example/group/app/-/merge_requests/105');
  });

  it('keeps the locally saved MR or PR URL visible as source evidence', () => {
    const evidence = workItemSourceEvidence({
      kind: 'jira-ticket',
      description: '',
      jiraKey: 'PRO-125',
      prUrl: 'https://gitlab.example/group/app/-/merge_requests/125',
    });

    expect(evidence.map(item => [item.kind, item.label, item.value, item.url])).toContainEqual([
      'jira-link',
      'Saved MR / PR',
      'https://gitlab.example/group/app/-/merge_requests/125',
      'https://gitlab.example/group/app/-/merge_requests/125',
    ]);
  });

  it('extracts Jira development panel links for merge requests, branches, and commits', () => {
    const evidence = workItemSourceEvidence({
      kind: 'jira-ticket',
      description: '',
      jiraKey: 'PRO-124',
      jiraFields: {
        raw: {
          development: {
            mergeRequests: {
              values: [
                {
                  type: 'merge request',
                  title: 'PRO-124 implement runtime guard',
                  url: 'https://gitlab.example/group/app/-/merge_requests/124',
                },
              ],
            },
            branches: [
              {
                type: 'branch',
                name: 'feature/PRO-124-runtime-guard',
                url: 'https://gitlab.example/group/app/-/tree/feature/PRO-124-runtime-guard',
              },
            ],
            commits: {
              nodes: [
                {
                  type: 'commit',
                  displayId: 'abc1234',
                  message: 'PRO-124 add runtime guard',
                  url: 'https://gitlab.example/group/app/-/commit/abc1234',
                },
              ],
            },
          },
        },
      },
    });

    expect(evidence.map(item => [item.label, item.value, item.url]).slice(1)).toEqual([
      ['Jira merge request link', 'PRO-124 implement runtime guard', 'https://gitlab.example/group/app/-/merge_requests/124'],
      ['Jira branch link', 'feature/PRO-124-runtime-guard', 'https://gitlab.example/group/app/-/tree/feature/PRO-124-runtime-guard'],
      ['Jira commit link', 'abc1234', 'https://gitlab.example/group/app/-/commit/abc1234'],
    ]);
  });
});
