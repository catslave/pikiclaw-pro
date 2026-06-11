/** Client-side mirror of server sandbox kind → executor assistant routing. */
import type { FocusSandboxType } from '../../../types';

export function resolveExecutorAgentForSandboxKind(kind: FocusSandboxType): string | null {
  if (kind === 'bug' || kind === 'todo' || kind === 'review') return 'assistant_coding';
  if (kind === 'jira') return 'assistant_refinement';
  return null;
}
