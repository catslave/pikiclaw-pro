import { describe, expect, it } from 'vitest';

import { isLogTraceSlash, parseLogTraceArgs, stripLogTraceSlash } from '../src/platform/logtrace.ts';

describe('logtrace platform skill', () => {
  it('recognizes the slash command', () => {
    expect(isLogTraceSlash('/logtrace env=lab')).toBe(true);
    expect(isLogTraceSlash('/logstrace env=lab')).toBe(true);
    expect(isLogTraceSlash('/logtracex env=lab')).toBe(false);
  });

  it('strips supported slash command aliases before parsing args', () => {
    expect(stripLogTraceSlash('/logtrace conversationId=abc last=1h')).toBe('conversationId=abc last=1h');
    expect(stripLogTraceSlash('/logstrace conversationId=abc last=1h')).toBe('conversationId=abc last=1h');
  });

  it('uses a trailing bare UUID as id when id= is left empty', () => {
    expect(parseLogTraceArgs('/logtrace env=lab id= last=24h 563b3b11-fcb8-4c21-92e2-df6a5cfe1200'.replace(/^\/logtrace\s*/, ''))).toMatchObject({
      id: '563b3b11-fcb8-4c21-92e2-df6a5cfe1200',
      idField: 'conversationId',
      env: 'lab',
      last: '24h',
      mode: 'trace',
    });
  });

  it('defaults explicit conversation IDs to lab conversationId lookup', () => {
    expect(parseLogTraceArgs('conversationId=563b3b11-fcb8-4c21-92e2-df6a5cfe1200')).toMatchObject({
      id: '563b3b11-fcb8-4c21-92e2-df6a5cfe1200',
      idField: 'conversationId',
      env: 'lab',
      last: '24h',
      mode: 'trace',
    });
  });

  it('accepts the common misspelling of conversationId', () => {
    expect(parseLogTraceArgs('converstaionId=563b3b11-fcb8-4c21-92e2-df6a5cfe1200')).toMatchObject({
      id: '563b3b11-fcb8-4c21-92e2-df6a5cfe1200',
      idField: 'conversationId',
    });
  });

  it('parses log search mode and combines it with an id condition', () => {
    expect(parseLogTraceArgs('search conversationId=563b3b11-fcb8-4c21-92e2-df6a5cfe1200 query="level:ERROR" size=50')).toMatchObject({
      id: '563b3b11-fcb8-4c21-92e2-df6a5cfe1200',
      idField: 'conversationId',
      mode: 'search',
      query: 'level:ERROR',
      size: '50',
    });
  });

  it('keeps bare 32-character values on the default conversationId path', () => {
    expect(parseLogTraceArgs('4a0031017ceb19eab6d3a39468a20000')).toMatchObject({
      id: '4a0031017ceb19eab6d3a39468a20000',
      idField: 'conversationId',
      env: 'lab',
      mode: 'trace',
    });
  });

  it('accepts explicit traceId filters', () => {
    expect(parseLogTraceArgs('traceId=4a0031017ceb19eab6d3a39468a20000 last=1h')).toMatchObject({
      id: '4a0031017ceb19eab6d3a39468a20000',
      idField: 'trace_id',
      last: '1h',
      mode: 'search',
    });
  });

  it('uses explicit field filters without relying on id shape', () => {
    expect(parseLogTraceArgs('field=trace_id 4a0031017ceb19eab6d3a39468a20000')).toMatchObject({
      id: '4a0031017ceb19eab6d3a39468a20000',
      idField: 'trace_id',
      mode: 'search',
    });
    expect(parseLogTraceArgs('field=trace_id id=4a0031017ceb19eab6d3a39468a20000')).toMatchObject({
      id: '4a0031017ceb19eab6d3a39468a20000',
      idField: 'trace_id',
      mode: 'search',
    });
  });

  it('treats explicit non-session fields as log searches', () => {
    expect(parseLogTraceArgs('requestId=req-123')).toMatchObject({
      id: 'req-123',
      idField: 'requestId',
      mode: 'search',
    });
    expect(parseLogTraceArgs('field=taskId id=task-123')).toMatchObject({
      id: 'task-123',
      idField: 'taskId',
      mode: 'search',
    });
  });

  it('infers stats mode from grouping arguments', () => {
    expect(parseLogTraceArgs('conversationId=563b3b11-fcb8-4c21-92e2-df6a5cfe1200 by=level.keyword limit=10')).toMatchObject({
      mode: 'stats',
      groupBy: 'level.keyword',
      limit: '10',
    });
  });
});
