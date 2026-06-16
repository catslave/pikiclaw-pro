import type { ProjectReferenceFile, SessionContextSource } from '../../types';

export const PROJECT_REFERENCE_CONTEXT_LIMIT = 20;

export function projectReferenceLaunchKey(file: Pick<ProjectReferenceFile, 'name' | 'path'>): string {
  return `${file.name}\u001f${file.path}`;
}

export function defaultProjectReferenceSelection(references: ProjectReferenceFile[]): string[] {
  return references
    .slice(0, PROJECT_REFERENCE_CONTEXT_LIMIT)
    .map(projectReferenceLaunchKey);
}

export function filterProjectReferencesBySelection(
  references: ProjectReferenceFile[],
  selectedKeys: readonly string[],
): ProjectReferenceFile[] {
  if (!references.length || !selectedKeys.length) return [];
  const selected = new Set(selectedKeys);
  return references.filter(file => selected.has(projectReferenceLaunchKey(file)));
}

export function projectReferenceContextSources(
  workdir: string,
  references: ProjectReferenceFile[] | null | undefined,
): SessionContextSource[] {
  const base = String(workdir || '').trim();
  if (!base || !references?.length) return [];
  return references
    .filter(file => file?.path && file?.name)
    .slice(0, PROJECT_REFERENCE_CONTEXT_LIMIT)
    .map(file => ({
      kind: 'file',
      workdir: base,
      path: file.path,
      title: file.name,
      source: 'project-reference',
      size: typeof file.size === 'number' ? file.size : null,
    }));
}
