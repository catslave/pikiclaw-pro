import { describe, expect, it } from 'vitest';
import {
  appendWorkItemCaptureEvidenceCandidate,
  appendWorkItemCaptureEvidencePreset,
  buildWorkItemCaptureEvidenceCandidates,
  workItemCaptureDescriptionHasCandidate,
  workItemCaptureDescriptionHasPreset,
  workItemCaptureEvidencePresets,
} from '../dashboard/src/pages/wayland/workItemCaptureEvidencePreset';
import { workItemSourceEvidence } from '../dashboard/src/pages/wayland/workItemSourceEvidence';

describe('Wayland Work Item capture evidence presets', () => {
  it('uses source-specific preset order for manual, inbox, and Jira capture', () => {
    expect(workItemCaptureEvidencePresets('manual').map(item => item.key)).toEqual(['quote', 'session', 'workspace', 'images']);
    expect(workItemCaptureEvidencePresets('todo').map(item => item.key)).toEqual(['inbox-note', 'quote', 'linked-chat', 'images']);
    expect(workItemCaptureEvidencePresets('jira-ticket').map(item => item.key)).toEqual(['quote', 'session', 'images', 'workspace']);
  });

  it('appends parser-compatible source evidence sections without duplicating them', () => {
    const quote = workItemCaptureEvidencePresets('todo').find(item => item.key === 'quote');
    const linkedChat = workItemCaptureEvidencePresets('todo').find(item => item.key === 'linked-chat');
    expect(quote).toBeTruthy();
    expect(linkedChat).toBeTruthy();

    const withQuote = appendWorkItemCaptureEvidencePreset('Investigate source health.', quote!);
    const withLinkedChat = appendWorkItemCaptureEvidencePreset(withQuote, linkedChat!);
    const duplicated = appendWorkItemCaptureEvidencePreset(withLinkedChat, quote!);

    expect(duplicated).toBe(withLinkedChat);
    expect(workItemCaptureDescriptionHasPreset(duplicated, quote!)).toBe(true);
    expect(workItemSourceEvidence({
      kind: 'todo',
      description: duplicated
        .replace('Quoted source:', 'Quoted source: Button fails after sync')
        .replace('Linked chat: agent:session-id', 'Linked chat: codex:session-123'),
    }).map(item => [item.kind, item.value])).toEqual([
      ['quote', 'Button fails after sync'],
      ['linked-chat', 'codex:session-123'],
    ]);
  });

  it('keeps image presets compatible with image evidence parsing', () => {
    const image = workItemCaptureEvidencePresets('jira-ticket').find(item => item.key === 'images');
    expect(image).toBeTruthy();

    const description = appendWorkItemCaptureEvidencePreset('', image!)
      .replace('screenshot.png', 'error-modal.png');

    expect(workItemSourceEvidence({
      kind: 'jira-ticket',
      description,
    }).map(item => [item.kind, item.value])).toEqual([
      ['image', 'error-modal.png'],
    ]);
  });

  it('builds real capture evidence candidates from workspace and recent sessions', () => {
    const candidates = buildWorkItemCaptureEvidenceCandidates({
      source: 'todo',
      workdir: '/repo/pikiclaw',
      workspaceName: 'Pikiclaw Pro',
      attachments: [{ name: 'bug.png', type: 'image/png' }],
      references: [{ name: 'README.md', path: '/repo/pikiclaw/README.md' }],
      recent: [
        {
          agent: 'codex',
          sessionId: 'session-a',
          title: 'Investigate source repair',
          workdir: '/repo/pikiclaw',
          workspaceName: 'Pikiclaw Pro',
        },
        {
          agent: 'codex',
          sessionId: 'session-b',
          title: 'Other project',
          workdir: '/repo/other',
        },
      ],
    });

    expect(candidates.map(item => [item.kind, item.label, item.value])).toEqual([
      ['workspace', 'Pikiclaw Pro', '/repo/pikiclaw'],
      ['image', 'bug.png', 'bug.png'],
      ['project-reference', 'README.md', '/repo/pikiclaw/README.md'],
      ['linked-chat', 'Investigate source repair', 'codex:session-a'],
      ['session', 'Other project', 'codex:session-b'],
    ]);
  });

  it('appends real candidates as parser-compatible source evidence lines', () => {
    const candidates = buildWorkItemCaptureEvidenceCandidates({
      source: 'manual',
      workdir: '/repo/pikiclaw',
      workspaceName: 'Pikiclaw Pro',
      recent: [{ agent: 'codex', sessionId: 'session-a', title: 'Recent chat', workdir: '/repo/pikiclaw' }],
    });

    const description = candidates.reduce(
      (current, candidate) => appendWorkItemCaptureEvidenceCandidate(current, candidate),
      'Manual capture',
    );
    const duplicated = appendWorkItemCaptureEvidenceCandidate(description, candidates[1]);

    expect(duplicated).toBe(description);
    expect(workItemSourceEvidence({
      kind: 'manual',
      description,
    }).map(item => [item.kind, item.value])).toEqual([
      ['session', 'codex:session-a'],
      ['workspace', '/repo/pikiclaw'],
    ]);
  });

  it('appends multiple image candidates into one Images section', () => {
    const candidates = buildWorkItemCaptureEvidenceCandidates({
      source: 'manual',
      attachments: [
        { name: 'first.png', type: 'image/png' },
        { name: 'second.webp', type: 'image/webp' },
      ],
    }).filter(item => item.kind === 'image');

    const description = candidates.reduce(
      (current, candidate) => appendWorkItemCaptureEvidenceCandidate(current, candidate),
      'Manual capture',
    );
    const duplicated = appendWorkItemCaptureEvidenceCandidate(description, candidates[0]);

    expect(duplicated).toBe(description);
    expect(description).toContain('Images:\n- first.png\n- second.webp');
    expect(workItemSourceEvidence({
      kind: 'manual',
      description,
    }).map(item => [item.kind, item.value])).toEqual([
      ['image', 'first.png'],
      ['image', 'second.webp'],
    ]);
  });

  it('detects candidates already written into the capture description', () => {
    const candidates = buildWorkItemCaptureEvidenceCandidates({
      source: 'manual',
      workdir: '/repo/pikiclaw',
      workspaceName: 'Pikiclaw Pro',
      attachments: [{ name: 'first.png', type: 'image/png' }],
      references: [{ name: 'README.md', path: '/repo/pikiclaw/README.md' }],
    });
    const description = candidates.reduce(
      (current, candidate) => appendWorkItemCaptureEvidenceCandidate(current, candidate),
      '',
    );

    expect(candidates.map(candidate => workItemCaptureDescriptionHasCandidate(description, candidate))).toEqual([
      true,
      true,
      true,
    ]);
  });
});
