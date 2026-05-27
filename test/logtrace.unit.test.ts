import { describe, expect, it } from 'vitest';

import { isLogTraceSlash, parseLogTraceArgs } from '../src/platform/logtrace.ts';

describe('logtrace platform skill', () => {
  it('recognizes the slash command', () => {
    expect(isLogTraceSlash('/logtrace env=lab')).toBe(true);
    expect(isLogTraceSlash('/logtracex env=lab')).toBe(false);
  });

  it('uses a trailing bare UUID as id when id= is left empty', () => {
    expect(parseLogTraceArgs('/logtrace env=lab id= last=24h 563b3b11-fcb8-4c21-92e2-df6a5cfe1200'.replace(/^\/logtrace\s*/, ''))).toMatchObject({
      id: '563b3b11-fcb8-4c21-92e2-df6a5cfe1200',
      env: 'lab',
      last: '24h',
    });
  });
});
