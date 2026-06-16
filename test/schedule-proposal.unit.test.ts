import { describe, expect, it } from 'vitest';
import {
  extractScheduleProposalMarkers,
  scheduleProposalSignature,
  stripScheduleProposalMarkers,
} from '../dashboard/src/pages/sessions/scheduleProposal.ts';

describe('schedule proposal parser', () => {
  it('extracts and strips chat-native schedule proposals', () => {
    const text = [
      'I can automate this follow-up.',
      '<schedule-proposal name="Trace digest" schedule="weekly@1@09:30" enabled="true" include-project-references="true" project-reference-names="context.md, decision-log.md">',
      'Summarize the latest trace findings and list any unresolved follow-ups.',
      '</schedule-proposal>',
      'The card above should become an action.',
    ].join('\n');

    expect(extractScheduleProposalMarkers(text)).toEqual([
      {
        name: 'Trace digest',
        schedule: 'weekly@1@09:30',
        prompt: 'Summarize the latest trace findings and list any unresolved follow-ups.',
        enabled: true,
        includeProjectReferences: true,
        projectReferenceNames: ['context.md', 'decision-log.md'],
      },
    ]);
    expect(stripScheduleProposalMarkers(text)).toBe([
      'I can automate this follow-up.',
      '',
      'The card above should become an action.',
    ].join('\n'));
  });

  it('ignores schedule-shaped text inside code spans and fenced code blocks', () => {
    const text = [
      'Use `<schedule-proposal name="Example">No card</schedule-proposal>` as syntax.',
      '```xml',
      '<schedule-proposal name="Fake" schedule="daily@09:00">Do not parse.</schedule-proposal>',
      '```',
      '<schedule-proposal name="Real" schedule="daily@10:00">Create the real task.</schedule-proposal>',
    ].join('\n');

    expect(extractScheduleProposalMarkers(text).map(item => item.name)).toEqual(['Real']);
    const stripped = stripScheduleProposalMarkers(text);
    expect(stripped).toContain('`<schedule-proposal name="Example">No card</schedule-proposal>`');
    expect(stripped).toContain('<schedule-proposal name="Fake" schedule="daily@09:00">Do not parse.</schedule-proposal>');
    expect(stripped).not.toContain('Create the real task.');
  });

  it('recovers escaped proposals and normalizes unsafe schedules', () => {
    const text = [
      '&lt;schedule-proposal name=&quot;Escaped&quot; schedule=&quot;cron * * * *&quot; enabled=&quot;no&quot;&gt;',
      'Run only after review.',
      '&lt;/schedule-proposal&gt;',
    ].join('\n');

    const [proposal] = extractScheduleProposalMarkers(text);
    expect(proposal).toMatchObject({
      name: 'Escaped',
      schedule: 'manual',
      enabled: false,
      prompt: 'Run only after review.',
    });
    expect(scheduleProposalSignature(proposal)).toContain('Escaped|manual|Run only after review.');
    expect(stripScheduleProposalMarkers(text)).toBe('');
  });

  it('accepts Wayland-style cron proposal blocks as a compatibility input', () => {
    const text = [
      'I can schedule that.',
      '[CRON_PROPOSE]',
      'name: Weekly trace review',
      'schedule: 30 9 * * MON',
      'schedule_description: Every Monday at 9:30',
      'message: Review the latest trace evidence and summarize unresolved risks.',
      '[/CRON_PROPOSE]',
    ].join('\n');

    expect(extractScheduleProposalMarkers(text)).toEqual([
      {
        name: 'Weekly trace review',
        schedule: 'weekly@1@09:30',
        prompt: 'Review the latest trace evidence and summarize unresolved risks.',
        enabled: true,
        includeProjectReferences: false,
        projectReferenceNames: [],
      },
    ]);
    expect(stripScheduleProposalMarkers(text)).toBe('I can schedule that.');
  });

  it('downgrades complex cron proposals to manual review', () => {
    const text = [
      '[CRON_PROPOSE]',
      'name: Weekday digest',
      'schedule: 0 9 * * MON-FRI',
      'schedule_description: Every weekday at 9',
      'message: Prepare the digest.',
      '[/CRON_PROPOSE]',
    ].join('\n');

    const [proposal] = extractScheduleProposalMarkers(text);
    expect(proposal.schedule).toBe('manual');
    expect(proposal.prompt).toBe('Prepare the digest.');
  });
});
