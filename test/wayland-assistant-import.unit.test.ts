import { describe, expect, it } from 'vitest';
import { parseAssistantImportText } from '../dashboard/src/pages/wayland/assistantImport.ts';

describe('Wayland assistant import parser', () => {
  it('imports assistant profile JSON', () => {
    const assistants = parseAssistantImportText(JSON.stringify({
      assistantProfiles: [
        {
          name: 'Release Captain',
          description: 'Owns release readiness and evidence collection.',
          preferredAgents: ['codex', 'gemini'],
          prompt: 'Check the release, ask for missing context, and recommend ship or hold.',
          labels: ['release', 'qa'],
          allowedActions: ['chat', 'run-tests'],
        },
      ],
    }));

    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({
      name: 'Release Captain',
      responsibility: 'Owns release readiness and evidence collection.',
      preferredAgents: ['codex', 'gemini'],
      kind: 'custom',
      labels: ['release', 'qa', 'imported', 'json-import'],
      allowedActions: ['chat', 'run-tests'],
      enabled: true,
    });
    expect(assistants[0].prompt).toContain('recommend ship or hold');
  });

  it('imports SKILL.md as a custom assistant profile', () => {
    const assistants = parseAssistantImportText(`---
name: incident-commander
title: Incident Commander
type: agent-profile
description: Coordinates production incident triage.
preferredAgents:
  - codex
tags: [incident, ops]
allowedActions:
  - chat
  - inspect-logs
---
# Incident Commander

## Use when

- A production incident needs classification and an action owner.

## Instructions

Ask for the symptom, blast radius, recent changes, and available dashboards.
Keep the output short and action-oriented.
`);

    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({
      name: 'Incident Commander',
      responsibility: 'Coordinates production incident triage.',
      preferredAgents: ['codex'],
      kind: 'custom',
      labels: ['incident', 'ops', 'imported', 'skill-md'],
      allowedActions: ['chat', 'inspect-logs'],
    });
    expect(assistants[0].prompt).toContain('Ask for the symptom');
  });

  it('infers responsibility from Markdown sections', () => {
    const assistants = parseAssistantImportText(`# Migration Coach

## Use when

- A product migration needs staged rollout advice.

## Capabilities

- planning
- risk review
`);

    expect(assistants[0]).toMatchObject({
      name: 'Migration Coach',
      responsibility: 'A product migration needs staged rollout advice.',
      allowedActions: ['planning', 'risk review'],
      labels: ['imported', 'skill-md'],
    });
    expect(assistants[0].defaultPrompt).toContain('Migration Coach');
  });

  it('rejects assistant imports without a name', () => {
    expect(() => parseAssistantImportText(JSON.stringify({ description: 'No name.' }))).toThrow(/missing name/);
  });
});
