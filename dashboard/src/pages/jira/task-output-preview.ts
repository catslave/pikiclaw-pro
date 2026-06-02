import { buildGeneratedOutputInsights } from '../sessions/GeneratedOutputCards';

export function isMarkdownOutputPath(path?: string | null): boolean {
  if (!path) return false;
  const clean = path.split('#')[0].split('?')[0].toLowerCase();
  return clean.endsWith('.md') || clean.endsWith('.markdown');
}

export function outputMarkdownPath(output: { path?: string; summary?: string }): string | null {
  if (isMarkdownOutputPath(output.path)) return output.path!.trim();
  const fromSummary = buildGeneratedOutputInsights(output.summary || '').files
    .map(file => file.target.path)
    .find(isMarkdownOutputPath);
  return fromSummary || null;
}
