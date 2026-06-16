import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type DashboardActivityType = 'visit' | 'chat' | 'config' | 'command' | 'paired-device-added' | 'paired-device-revoked';

export interface DashboardPairedDevice {
  id: string;
  deviceName: string;
  ua: string;
  ipFirstSeen: string;
  lastSeenAt: number;
  createdAt: number;
  visitCount: number;
}

export interface DashboardActivityEvent {
  id: string;
  type: DashboardActivityType;
  detail: string;
  deviceId?: string;
  path?: string;
  ts: number;
}

interface DashboardAccessFile {
  version: 1;
  devices: DashboardPairedDevice[];
  activity: DashboardActivityEvent[];
}

export interface DashboardAccessSnapshot {
  currentDeviceId: string | null;
  status: DashboardAccessStatus;
  devices: DashboardPairedDevice[];
  activity: DashboardActivityEvent[];
}

export interface DashboardAccessStatus {
  mode: 'local-only';
  localUrl: string;
  currentUrl: string;
  bindHost: string;
  remoteAccess: 'disabled';
  authentication: 'trusted-local';
  qrLogin: 'not-available';
  deviceTracking: 'enabled';
  sessionInvalidation: 'device-list-only';
  detail: string;
}

interface DashboardRequestInput {
  method: string;
  path: string;
  cookieHeader?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}

export interface DashboardRequestRecord {
  deviceId: string;
  setCookie: boolean;
}

const ACCESS_COOKIE = 'pikiclaw_dashboard_device';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;
const ACTIVITY_RING_SIZE = 200;
const VISIT_THROTTLE_MS = 60_000;
const SEEN_THROTTLE_MS = 15_000;

const lastVisitLogged = new Map<string, number>();
const lastSeenWritten = new Map<string, number>();

function normalizeProtocol(value: string | null | undefined): string {
  return String(value || '').toLowerCase().startsWith('https') ? 'https' : 'http';
}

function hostPort(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) return '3939';
  if (trimmed.startsWith('[')) {
    const index = trimmed.lastIndexOf(']:');
    return index >= 0 ? trimmed.slice(index + 2) : '3939';
  }
  const [, port] = trimmed.match(/:(\d+)$/) || [];
  return port || '3939';
}

function accessFilePath(): string {
  return process.env.PIKICLAW_DASHBOARD_ACCESS_FILE
    || path.join(os.homedir(), '.pikiclaw', 'dashboard', 'access.json');
}

function emptyFile(): DashboardAccessFile {
  return { version: 1, devices: [], activity: [] };
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readFile(): DashboardAccessFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(accessFilePath(), 'utf8')) as Partial<DashboardAccessFile>;
    return {
      version: 1,
      devices: Array.isArray(parsed.devices) ? parsed.devices.filter(isDevice) : [],
      activity: Array.isArray(parsed.activity) ? parsed.activity.filter(isActivity) : [],
    };
  } catch {
    return emptyFile();
  }
}

function writeFile(data: DashboardAccessFile) {
  const filePath = accessFilePath();
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function isDevice(value: unknown): value is DashboardPairedDevice {
  const item = value as DashboardPairedDevice;
  return !!item
    && typeof item.id === 'string'
    && typeof item.deviceName === 'string'
    && typeof item.ua === 'string'
    && typeof item.ipFirstSeen === 'string'
    && typeof item.lastSeenAt === 'number'
    && typeof item.createdAt === 'number';
}

function isActivity(value: unknown): value is DashboardActivityEvent {
  const item = value as DashboardActivityEvent;
  return !!item
    && typeof item.id === 'string'
    && typeof item.type === 'string'
    && typeof item.detail === 'string'
    && typeof item.ts === 'number';
}

function parseCookie(header: string | null | undefined, name: string): string | null {
  const parts = String(header || '').split(';');
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rawValue.join('=') || '');
  }
  return null;
}

function compactUserAgent(ua: string): string {
  if (!ua) return 'Unknown Browser';
  const browser = ua.includes('Edg/') ? 'Edge'
    : ua.includes('Chrome/') ? 'Chrome'
      : ua.includes('Firefox/') ? 'Firefox'
        : ua.includes('Safari/') ? 'Safari'
          : 'Browser';
  const platform = ua.includes('Mac OS X') ? 'macOS'
    : ua.includes('Windows') ? 'Windows'
      : ua.includes('Linux') ? 'Linux'
        : ua.includes('iPhone') || ua.includes('iPad') ? 'iOS'
          : ua.includes('Android') ? 'Android'
            : 'Device';
  return `${browser} on ${platform}`;
}

function appendActivity(data: DashboardAccessFile, event: Omit<DashboardActivityEvent, 'id' | 'ts'> & { ts?: number }) {
  data.activity.push({
    id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    ts: event.ts || Date.now(),
    type: event.type,
    detail: event.detail,
    deviceId: event.deviceId,
    path: event.path,
  });
  if (data.activity.length > ACTIVITY_RING_SIZE) {
    data.activity = data.activity.slice(data.activity.length - ACTIVITY_RING_SIZE);
  }
}

function activityForRequest(method: string, requestPath: string): { type: DashboardActivityType; detail: string } | null {
  if (method === 'POST' && requestPath === '/api/config') return { type: 'config', detail: 'Saved dashboard configuration' };
  if (method === 'POST' && requestPath === '/api/session-hub/session/send') return { type: 'chat', detail: 'Sent a dashboard chat message' };
  if (method === 'POST' && requestPath.startsWith('/api/pro/assistants/')) return { type: 'chat', detail: 'Launched an assistant from dashboard' };
  if (method === 'POST' && requestPath.startsWith('/api/focus/intent')) return { type: 'command', detail: 'Submitted a focus command' };
  if (method === 'POST' && requestPath.startsWith('/api/session-hub/session/') && requestPath !== '/api/session-hub/session/messages') {
    return { type: 'command', detail: 'Updated a dashboard session' };
  }
  return null;
}

function shouldSkipPath(requestPath: string): boolean {
  return requestPath === '/ws'
    || requestPath.startsWith('/assets/')
    || requestPath.endsWith('.ico')
    || requestPath.endsWith('.png')
    || requestPath.endsWith('.svg')
    || requestPath.endsWith('.map');
}

function isBrowserUserAgent(ua: string | null | undefined): boolean {
  const value = String(ua || '');
  if (!value || /^curl\//i.test(value) || /^node\b/i.test(value)) return false;
  return /Chrome\/|Safari\/|Firefox\/|Edg\/|OPR\//.test(value);
}

export function dashboardDeviceCookieHeader(deviceId: string): string {
  return `${ACCESS_COOKIE}=${encodeURIComponent(deviceId)}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; SameSite=Lax; HttpOnly`;
}

export function dashboardAccessStatus(input: { host?: string | null; protocol?: string | null } = {}): DashboardAccessStatus {
  const protocol = normalizeProtocol(input.protocol);
  const host = String(input.host || '').trim();
  const port = hostPort(host);
  return {
    mode: 'local-only',
    localUrl: `${protocol}://127.0.0.1:${port}`,
    currentUrl: host ? `${protocol}://${host}` : `${protocol}://127.0.0.1:${port}`,
    bindHost: '127.0.0.1',
    remoteAccess: 'disabled',
    authentication: 'trusted-local',
    qrLogin: 'not-available',
    deviceTracking: 'enabled',
    sessionInvalidation: 'device-list-only',
    detail: 'Pikiclaw Dashboard is currently bound to the local machine. Browser devices are tracked for visibility, but remote login and QR pairing are not enabled.',
  };
}

export function recordDashboardRequest(input: DashboardRequestInput): DashboardRequestRecord | null {
  if (shouldSkipPath(input.path)) return null;
  if (!isBrowserUserAgent(input.userAgent)) return null;
  const now = Date.now();
  const data = readFile();
  const cookieDeviceId = parseCookie(input.cookieHeader, ACCESS_COOKIE);
  let device = cookieDeviceId ? data.devices.find(item => item.id === cookieDeviceId) || null : null;
  let setCookie = false;

  if (!device) {
    device = {
      id: randomUUID(),
      deviceName: compactUserAgent(String(input.userAgent || '')),
      ua: String(input.userAgent || ''),
      ipFirstSeen: String(input.ip || 'local'),
      lastSeenAt: now,
      createdAt: now,
      visitCount: 0,
    };
    data.devices.unshift(device);
    setCookie = true;
    appendActivity(data, {
      type: 'paired-device-added',
      detail: `${device.deviceName} paired with Web Dashboard`,
      deviceId: device.id,
      path: input.path,
      ts: now,
    });
  }

  const seenKey = device.id;
  if ((lastSeenWritten.get(seenKey) || 0) + SEEN_THROTTLE_MS <= now) {
    device.lastSeenAt = now;
    device.visitCount = Math.max(0, Number(device.visitCount || 0)) + 1;
    lastSeenWritten.set(seenKey, now);
  }

  const routeActivity = activityForRequest(input.method.toUpperCase(), input.path);
  if (routeActivity) {
    appendActivity(data, { ...routeActivity, deviceId: device.id, path: input.path, ts: now });
  } else if (input.method.toUpperCase() === 'GET' && !input.path.startsWith('/api/')) {
    const visitKey = `${device.id}:${input.path}`;
    if ((lastVisitLogged.get(visitKey) || 0) + VISIT_THROTTLE_MS <= now) {
      lastVisitLogged.set(visitKey, now);
      appendActivity(data, { type: 'visit', detail: `Opened ${input.path}`, deviceId: device.id, path: input.path, ts: now });
    }
  }

  data.devices = data.devices
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, 50);
  writeFile(data);
  return { deviceId: device.id, setCookie };
}

export function listDashboardAccess(
  currentDeviceId: string | null = null,
  limit = 30,
  status: DashboardAccessStatus = dashboardAccessStatus(),
): DashboardAccessSnapshot {
  const data = readFile();
  return {
    currentDeviceId,
    status,
    devices: data.devices.slice().sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    activity: data.activity.slice().sort((a, b) => b.ts - a.ts).slice(0, Math.max(0, limit)),
  };
}

export function currentDashboardDeviceId(cookieHeader: string | null | undefined): string | null {
  return parseCookie(cookieHeader, ACCESS_COOKIE);
}

export function revokeDashboardDevice(id: string, currentDeviceId: string | null = null): boolean {
  const data = readFile();
  const device = data.devices.find(item => item.id === id);
  if (!device) return false;
  data.devices = data.devices.filter(item => item.id !== id);
  appendActivity(data, {
    type: 'paired-device-revoked',
    detail: `${device.deviceName}${currentDeviceId === id ? ' (current)' : ''} was revoked`,
    deviceId: id,
  });
  writeFile(data);
  return true;
}
