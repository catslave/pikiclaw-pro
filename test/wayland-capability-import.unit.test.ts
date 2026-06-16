import { describe, expect, it } from 'vitest';
import { detectCapabilityImportKind } from '../dashboard/src/pages/wayland/capabilityImport.ts';

describe('Wayland capability import router', () => {
  it('detects workflow markdown from frontmatter', () => {
    expect(detectCapabilityImportKind(`---
name: release-review
type: workflow
---
# Release Review

## Steps

1. Check tests.
`)).toBe('workflow');
  });

  it('detects assistant markdown from agent-profile frontmatter', () => {
    expect(detectCapabilityImportKind(`---
name: incident-commander
type: agent-profile
---
# Incident Commander
`)).toBe('assistant');
  });

  it('defaults ordinary SKILL.md markdown to skill', () => {
    expect(detectCapabilityImportKind(`# Repo Release Check

Use this skill when checking a release.
`)).toBe('skill');
  });

  it('detects wrapped workflow JSON', () => {
    expect(detectCapabilityImportKind(JSON.stringify({
      workflows: [
        { name: 'Ship Review', description: 'Review a release.', steps: ['Check tests'] },
      ],
    }))).toBe('workflow');
  });

  it('detects assistant profile JSON', () => {
    expect(detectCapabilityImportKind(JSON.stringify({
      assistantProfiles: [
        { name: 'Incident Commander', description: 'Coordinate triage.' },
      ],
    }))).toBe('assistant');
  });

  it('honors manual override', () => {
    expect(detectCapabilityImportKind('not json', 'workflow')).toBe('workflow');
  });
});
