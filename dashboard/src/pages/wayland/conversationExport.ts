export interface BatchConversationExportEntry {
  title: string;
  workspaceName: string;
  workdir: string;
  agent: string;
  sessionId: string;
  content: string;
  filename?: string;
}

export interface BatchConversationExportError {
  title: string;
  workspaceName: string;
  workdir: string;
  agent: string;
  sessionId: string;
  error: string;
}

export function batchConversationExportFilename(count: number, now: Date = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `conversations-${Math.max(0, count)}-${timestamp}.md`;
}

export function composeBatchConversationMarkdown(
  entries: BatchConversationExportEntry[],
  opts: { exportedAt?: string; errors?: BatchConversationExportError[] } = {},
): string {
  const exportedAt = opts.exportedAt || new Date().toISOString();
  const errors = opts.errors || [];
  const lines: string[] = [
    '# Pikiclaw Conversation Export',
    '',
    `- Exported: ${exportedAt}`,
    `- Conversations: ${entries.length}`,
    errors.length ? `- Failed: ${errors.length}` : '',
  ].filter(Boolean);

  if (entries.length) {
    lines.push('', '## Index', '');
    entries.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.title} - ${entry.workspaceName} - ${entry.agent}`);
    });
  }

  if (errors.length) {
    lines.push('', '## Failed Exports', '');
    errors.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.title} - ${entry.workspaceName} - ${entry.agent} - ${entry.error}`);
    });
  }

  entries.forEach((entry, index) => {
    lines.push(
      '',
      '---',
      '',
      `## Conversation ${index + 1}: ${entry.title}`,
      '',
      `- Project: ${entry.workspaceName}`,
      `- Workdir: ${entry.workdir}`,
      `- Agent: ${entry.agent}`,
      `- Session: ${entry.sessionId}`,
    );
    if (entry.filename) lines.push(`- Source export: ${entry.filename}`);
    lines.push('', entry.content.trim() || '_No exported content._');
  });

  return `${lines.join('\n')}\n`;
}
