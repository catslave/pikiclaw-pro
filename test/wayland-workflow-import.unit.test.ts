import { describe, expect, it } from 'vitest';
import { parseWorkflowImportText } from '../dashboard/src/pages/wayland/workflowImport.ts';

describe('Wayland workflow import parser', () => {
  it('keeps Pikiclaw workflow JSON import compatible', () => {
    const workflows = parseWorkflowImportText(JSON.stringify({
      workflows: [
        {
          name: 'Release Gate',
          description: 'Collect release evidence before shipping.',
          category: 'Release',
          tags: ['release', 'qa'],
          outputs: ['ship recommendation'],
          steps: ['Inspect diff', 'Run checks'],
          capabilities: ['Tests'],
          defaultEffort: 'high',
        },
      ],
    }));

    expect(workflows).toHaveLength(1);
    expect(workflows[0]).toMatchObject({
      name: 'Release Gate',
      category: 'Release',
      tags: ['release', 'qa'],
      outputs: ['ship recommendation'],
      steps: ['Inspect diff', 'Run checks'],
      capabilities: ['Tests'],
      defaultEffort: 'high',
    });
  });

  it('imports Wayland-style SKILL.md workflow frontmatter and step headers', () => {
    const workflows = parseWorkflowImportText(`---
name: repo-review
title: Repository Review
type: workflow
description: Review a repository and produce a concise migration note.
category: Engineering
tags: [repo, audit]
depends:
  - browser
  - tests
defaultEffort: high
---
# Repository Review

## Step 1: Inspect project structure (uses: ripgrep)

Read the main files and map the current architecture.

## Step 2: Compare implementation to the product goal

Find missing behavior.

## Expected outputs

- gap list
- migration recommendation
`);

    expect(workflows).toHaveLength(1);
    expect(workflows[0]).toMatchObject({
      name: 'Repository Review',
      description: 'Review a repository and produce a concise migration note.',
      category: 'Engineering',
      tags: ['repo', 'audit', 'workflow', 'skill-md'],
      steps: ['Inspect project structure', 'Compare implementation to the product goal'],
      outputs: ['gap list', 'migration recommendation'],
      defaultEffort: 'high',
    });
    expect(workflows[0].capabilities).toEqual(['browser', 'tests', 'ripgrep']);
    expect(workflows[0].promptHint).toContain('## Step 1');
  });

  it('imports Markdown workflows with a Steps section and inferred description', () => {
    const workflows = parseWorkflowImportText(`# Incident Triage

## Use when

- A production symptom needs fast classification.

## Steps

1. Capture the symptom and blast radius.
2. Check recent deploys.
3. Recommend the next action.

## Capabilities

- Logs
- Metrics
`);

    expect(workflows).toHaveLength(1);
    expect(workflows[0]).toMatchObject({
      name: 'Incident Triage',
      description: 'A production symptom needs fast classification.',
      category: 'Imported',
      tags: ['workflow', 'skill-md'],
      steps: ['Capture the symptom and blast radius.', 'Check recent deploys.', 'Recommend the next action.'],
      capabilities: ['Logs', 'Metrics'],
      defaultEffort: 'medium',
    });
  });

  it('rejects workflow Markdown without runnable steps', () => {
    expect(() => parseWorkflowImportText('# Notes only\n\nThis is not a workflow.')).toThrow(/missing steps/);
  });
});
