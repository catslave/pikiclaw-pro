import { describe, expect, it } from 'vitest';
import {
  defaultProjectReferenceSelection,
  filterProjectReferencesBySelection,
  projectReferenceContextSources,
  projectReferenceLaunchKey,
} from '../dashboard/src/pages/wayland/projectReferenceLaunch.ts';
import type { ProjectReferenceFile } from '../dashboard/src/types.ts';

function ref(name: string, path = `/tmp/project/.pikiclaw/reference/${name}`): ProjectReferenceFile {
  return {
    name,
    path,
    size: 42,
    updatedAt: '2026-06-13T00:00:00.000Z',
  };
}

describe('wayland project reference launch helpers', () => {
  it('selects project references by stable launch key', () => {
    const references = [ref('brief.md'), ref('schema.sql')];
    const selection = defaultProjectReferenceSelection(references);

    expect(selection).toEqual(references.map(projectReferenceLaunchKey));
    expect(filterProjectReferencesBySelection(references, [projectReferenceLaunchKey(references[1])])).toEqual([references[1]]);
    expect(filterProjectReferencesBySelection(references, [])).toEqual([]);
  });

  it('turns selected project references into chat context sources', () => {
    expect(projectReferenceContextSources('/tmp/project', [ref('brief.md')])).toEqual([
      {
        kind: 'file',
        workdir: '/tmp/project',
        path: '/tmp/project/.pikiclaw/reference/brief.md',
        title: 'brief.md',
        source: 'project-reference',
        size: 42,
      },
    ]);
  });
});
