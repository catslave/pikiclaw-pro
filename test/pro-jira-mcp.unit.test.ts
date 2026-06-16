import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proTools } from '../src/agent/mcp/tools/pro.ts';
import { saveUserConfig } from '../src/core/config/user-config.ts';
import proRoutes from '../src/dashboard/routes/pro.ts';
import { applyJiraRemoteUpdate, fetchJiraIssueFromMcp, resolveJiraIssueKeyInput } from '../src/pro/jira-remote.ts';
import { createJiraRemoteUpdateRun, createJiraSyncRun, getJiraSyncRun } from '../src/pro/workflow.ts';
import { captureEnv, makeTmpDir, restoreEnv, type EnvSnapshot } from './support/env.ts';

const ENV_KEYS = [
  'PIKICLAW_CONFIG',
  'PIKICLAW_PRO_WORKFLOW_FILE',
  'PIKICLAW_PRO_TASK_FILE',
  'RC_JIRA_READ_TOKEN',
  'RC_CONFLUENCE_READ_TOKEN',
  'PIKICLAW_JIRA_MCP_SERVICE_URL',
] as const;

interface RecordedMcpRequest {
  url: string;
  method: string;
  authHeader: string | null;
  jiraReadToken: string | null;
  sessionHeader: string | null;
  body: Record<string, any>;
}

let tmpDir: string;
let envSnapshot: EnvSnapshot;

function sse(payload: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return new Response(`data: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...headers },
  });
}

function setupAtlassianConfig() {
  saveUserConfig({
    extensions: {
      mcp: {
        atlassian: {
          type: 'http',
          url: 'https://jira-mcp.example/mcp/',
          headers: { Authorization: 'Bearer test-token' },
          enabled: true,
          catalogId: 'atlassian',
        },
      },
    },
  });
}

function mockStatelessMcpServer(options: {
  tools: string[];
  searchIssues?: Record<string, unknown>[];
  issue?: Record<string, unknown>;
}): RecordedMcpRequest[] {
  const requests: RecordedMcpRequest[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
    const url = String(_input);
    const headers = new Headers(init?.headers || {});
    const body = JSON.parse(String(init?.body || '{}'));
    requests.push({
      url,
      method: body.method,
      authHeader: headers.get('Authorization'),
      jiraReadToken: headers.get('jira-read-token'),
      sessionHeader: headers.get('Mcp-Session-Id'),
      body,
    });

    if (body.method === 'initialize') {
      return sse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          serverInfo: { name: 'test-jira-mcp', version: '1.0.0' },
        },
      });
    }
    if (body.method === 'notifications/initialized') {
      return new Response('', { status: 202 });
    }
    if (body.method === 'tools/list') {
      return sse({
        jsonrpc: '2.0',
        id: body.id,
        result: { tools: options.tools.map(name => ({ name })) },
      });
    }
    if (body.method === 'tools/call') {
      if (body.params?.name === 'jira_get_issue') {
        return sse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [
              { type: 'text', text: JSON.stringify(options.issue ?? {}) },
            ],
          },
        });
      }
      const searchIssues = options.searchIssues ?? [];
      return sse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [
            { type: 'text', text: JSON.stringify({ issues: searchIssues }) },
          ],
        },
      });
    }
    return new Response('unknown method', { status: 400 });
  }));
  return requests;
}

beforeEach(() => {
  tmpDir = makeTmpDir('pikiclaw-pro-jira-mcp-');
  envSnapshot = captureEnv(ENV_KEYS);
  process.env.PIKICLAW_CONFIG = path.join(tmpDir, 'setting.json');
  process.env.PIKICLAW_PRO_WORKFLOW_FILE = path.join(tmpDir, 'workflow.json');
  process.env.PIKICLAW_PRO_TASK_FILE = path.join(tmpDir, 'tasks.json');
  delete process.env.RC_JIRA_READ_TOKEN;
  delete process.env.RC_CONFLUENCE_READ_TOKEN;
  delete process.env.PIKICLAW_JIRA_MCP_SERVICE_URL;
  setupAtlassianConfig();
});

afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnv(envSnapshot);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('Jira MCP HTTP transport', () => {
  it('resolves Jira ticket input from links, keys, and numeric ticket numbers', () => {
    expect(resolveJiraIssueKeyInput('IVAS-8158')).toBe('IVAS-8158');
    expect(resolveJiraIssueKeyInput('https://jira.ringcentral.com/browse/ivas-8158')).toBe('IVAS-8158');
    expect(resolveJiraIssueKeyInput('IVAS 8158')).toBe('IVAS-8158');
    expect(resolveJiraIssueKeyInput('8158', 'IVAS')).toBe('IVAS-8158');
    expect(resolveJiraIssueKeyInput('8158', 'IVAS-7043')).toBe('IVAS-8158');
    expect(resolveJiraIssueKeyInput('8158')).toBe('');
  });

  it('pulls Jira sync candidates when initialize omits mcp-session-id', async () => {
    const requests = mockStatelessMcpServer({
      tools: ['jira_search'],
      searchIssues: [
        {
          key: 'PRO-1',
          fields: {
            summary: 'Current sprint task',
            description: 'Implement active work.',
            issuetype: { name: 'Task' },
            status: { name: 'In Progress' },
            assignee: { displayName: 'Michael Yang' },
            reporter: { displayName: 'PM' },
            fixVersions: [{ name: '2026.06' }],
            customfield_10652: {
              value: [
                'com.atlassian.greenhopper.service.sprint.Sprint@old[id=1,name=Sprint 0,state=CLOSED]',
                'com.atlassian.greenhopper.service.sprint.Sprint@new[id=2,name=Sprint 1,state=ACTIVE]',
              ],
            },
            priority: { name: 'Normal' },
            labels: ['air'],
            updated: '2026-06-08T01:00:00.000Z',
          },
        },
      ],
    });
    const run = createJiraSyncRun({ assistantId: 'assistant_ticket_sync', agent: 'codex', workdir: '/repo/app' });

    const result = await proTools.handle('pikiclaw_pro_pull_jira_sync_candidates', {
      runId: run.id,
      jql: 'assignee = currentUser() ORDER BY updated DESC',
    }, {
      workspace: tmpDir,
      stagedFiles: [],
      callbackUrl: '',
    });

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({ ok: true, candidates: 1, ticketCount: 1 });
    expect(getJiraSyncRun(run.id)?.items?.[0]).toMatchObject({
      jiraKey: 'PRO-1',
      title: 'Current sprint task',
      sprint: 'Sprint 0, Sprint 1',
    });
    expect(requests.map(request => request.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/call',
    ]);
    expect(requests.slice(1).map(request => request.sessionHeader)).toEqual([null, null, null]);
  });

  it('uses jira-read-token before the configured Authorization header for Jira search', async () => {
    process.env.RC_JIRA_READ_TOKEN = 'fresh-jira-token';
    process.env.RC_CONFLUENCE_READ_TOKEN = 'fresh-confluence-token';
    process.env.PIKICLAW_JIRA_MCP_SERVICE_URL = 'https://backup.example/mcp/';
    const requests: RecordedMcpRequest[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const url = String(_input);
      const headers = new Headers(init?.headers || {});
      const body = JSON.parse(String(init?.body || '{}'));
      requests.push({
        url,
        method: body.method,
        authHeader: headers.get('Authorization'),
        jiraReadToken: headers.get('jira-read-token'),
        sessionHeader: headers.get('Mcp-Session-Id'),
        body,
      });

      if (body.method === 'initialize') {
        return sse({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-03-26', capabilities: {} },
        });
      }
      if (body.method === 'notifications/initialized') {
        return new Response('', { status: 202 });
      }
      if (body.method === 'tools/list') {
        const tools = url === 'https://backup.example/mcp/' ? ['jira_get_issue'] : ['jira_search'];
        return sse({
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: tools.map(name => ({ name })) },
        });
      }
      if (body.method === 'tools/call') {
        if (headers.get('Authorization')) {
          return sse({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              isError: true,
              content: [{ type: 'text', text: "Error calling tool 'search'" }],
            },
          });
        }
        return sse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  issues: [
                    {
                      key: 'PRO-2',
                      fields: {
                        summary: 'Fresh Jira ticket',
                        status: { name: 'Open' },
                        duedate: '2026-06-30',
                      },
                    },
                  ],
                }),
              },
            ],
          },
        });
      }
      return new Response('unknown method', { status: 400 });
    }));
    const run = createJiraSyncRun({ assistantId: 'assistant_ticket_sync', agent: 'codex', workdir: '/repo/app' });

    const result = await proTools.handle('pikiclaw_pro_pull_jira_sync_candidates', {
      runId: run.id,
      jql: 'assignee = currentUser() ORDER BY updated DESC',
    }, {
      workspace: tmpDir,
      stagedFiles: [],
      callbackUrl: '',
    });

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({
      ok: true,
      source: 'atlassian:jira-read-token: assignee = currentUser() ORDER BY updated DESC',
      candidates: 1,
      ticketCount: 1,
    });
    expect(payload.tried).toEqual(['mcp-atlassian-service: jira_search not available']);
    const atlassianCalls = requests.filter(request => request.url === 'https://jira-mcp.example/mcp/');
    expect(atlassianCalls.map(request => request.authHeader)).toEqual([null, null, null, null]);
    expect(atlassianCalls.map(request => request.jiraReadToken)).toEqual([
      'fresh-jira-token',
      'fresh-jira-token',
      'fresh-jira-token',
      'fresh-jira-token',
    ]);
  });

  it('fetches one Jira issue for a manual single-ticket sync', async () => {
    process.env.RC_JIRA_READ_TOKEN = 'fresh-jira-token';
    process.env.PIKICLAW_JIRA_MCP_SERVICE_URL = 'https://backup.example/mcp/';
    const requests = mockStatelessMcpServer({
      tools: ['jira_get_issue'],
      issue: {
        key: 'PRO-3',
        fields: {
          summary: 'Renamed ticket',
          description: 'Updated Jira description',
          issuetype: { name: 'Bug' },
          status: { name: 'In Progress' },
          fixVersions: [{ name: '2026.07' }],
          customfield_10652: {
            value: [
              'com.atlassian.greenhopper.service.sprint.Sprint@new[id=2,name=Sprint 2,state=ACTIVE]',
            ],
          },
          duedate: '2026-07-15',
          priority: { name: 'High' },
          labels: ['sync'],
          updated: '2026-06-09T01:00:00.000Z',
          comment: {
            comments: [
              {
                id: 'c1',
                author: { displayName: 'Alice' },
                body: 'Please inspect the linked trace before implementation.',
              },
            ],
          },
        },
      },
    });

    const pulled = await fetchJiraIssueFromMcp('PRO-3');

    expect(pulled.source).toBe('mcp-atlassian-service');
    expect(pulled.issue).toMatchObject({
      jiraKey: 'PRO-3',
      title: 'Renamed ticket',
      description: 'Updated Jira description',
      issueType: 'Bug',
      ticketStatus: 'In Progress',
      sprint: 'Sprint 2',
      fixVersions: ['2026.07'],
      dueDate: '2026-07-15',
      priority: 'High',
      labels: ['sync'],
      updatedAt: '2026-06-09T01:00:00.000Z',
    });
    expect(pulled.issue.rawFields?.comment).toMatchObject({
      comments: [
        {
          id: 'c1',
          author: { displayName: 'Alice' },
          body: 'Please inspect the linked trace before implementation.',
        },
      ],
    });
    const toolCall = requests.find(request => request.body.params?.name === 'jira_get_issue');
    expect(toolCall?.body.params?.arguments).toEqual({
      issue_key: 'PRO-3',
      fields: 'summary,description,issuetype,status,assignee,reporter,fixVersions,duedate,priority,labels,updated,issuelinks,customfield_10652',
      comment_limit: 5,
    });
  });

  it('syncs one Jira ticket from the dashboard API', async () => {
    process.env.RC_JIRA_READ_TOKEN = 'fresh-jira-token';
    process.env.PIKICLAW_JIRA_MCP_SERVICE_URL = 'https://backup.example/mcp/';
    mockStatelessMcpServer({
      tools: ['jira_get_issue'],
      issue: {
        key: 'PRO-3',
        fields: {
          summary: 'Single synced ticket',
          description: 'Only this issue should be synced.',
          issuetype: { name: 'Task' },
          status: { name: 'Open' },
          issuelinks: [
            {
              type: { inward: 'mentioned on' },
              object: {
                title: 'Merge request - PRO-3: Sync linked MR.',
                url: 'https://gitlab.example/group/app/-/merge_requests/105/diffs',
              },
            },
          ],
          customfield_10652: {
            value: ['com.atlassian.greenhopper.service.sprint.Sprint@new[id=2,name=Sprint 2,state=ACTIVE]'],
          },
        },
      },
    });

    const response = await proRoutes.request('/api/pro/jira/sync-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '3', projectKey: 'PRO', workdir: '/repo/app' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      action: 'created',
      issueKey: 'PRO-3',
      task: {
        jiraKey: 'PRO-3',
        title: 'Single synced ticket',
        description: 'Only this issue should be synced.',
        sprint: 'Sprint 2',
        workdir: '/repo/app',
        prUrl: 'https://gitlab.example/group/app/-/merge_requests/105',
      },
    });
  });

  it('applies remote Jira updates when initialize omits mcp-session-id', async () => {
    const requests = mockStatelessMcpServer({
      tools: ['jira_update_issue', 'jira_transition_issue'],
    });
    const run = createJiraRemoteUpdateRun({
      taskId: 'task_1',
      jiraKey: 'PRO-1',
      currentFields: { status: 'Open', fixVersions: ['2026.06'] },
      fields: { status: 'In Progress', fixVersions: ['2026.07'] },
    });

    const applied = await applyJiraRemoteUpdate(run);

    expect(applied.remoteTool).toBe('atlassian:jira_update_issue+jira_transition_issue');
    const toolCalls = requests.filter(request => request.method === 'tools/call').map(request => request.body.params);
    expect(toolCalls).toEqual([
      {
        name: 'jira_update_issue',
        arguments: {
          issue_key: 'PRO-1',
          fields: { fixVersions: [{ name: '2026.07' }] },
        },
      },
      {
        name: 'jira_transition_issue',
        arguments: {
          issue_key: 'PRO-1',
          transition_name: 'In Progress',
        },
      },
    ]);
    expect(requests.slice(1).map(request => request.sessionHeader)).toEqual([null, null, null, null]);
  });
});
