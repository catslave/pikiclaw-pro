import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import { ensureManagedBrowser } from '../browser-supervisor.js';

export interface BrowserPanelSnapshot {
  id: string;
  url: string;
  title: string;
  image: string;
  width: number;
  height: number;
  updatedAt: string;
}

interface BrowserPanelSession {
  id: string;
  page: Page;
  createdAt: number;
}

let browser: Browser | null = null;
let context: BrowserContext | null = null;
const sessions = new Map<string, BrowserPanelSession>();

async function getContext(): Promise<BrowserContext> {
  if (context && browser?.isConnected()) return context;

  const snapshot = await ensureManagedBrowser({ force: true });
  const endpoint = snapshot.cdpEndpoint;
  if (!endpoint) throw new Error('Managed browser CDP endpoint is not available');
  browser = await chromium.connectOverCDP(endpoint);
  browser.on('disconnected', () => {
    browser = null;
    context = null;
    sessions.clear();
  });

  context = browser.contexts()[0] || await browser.newContext({ viewport: { width: 1365, height: 768 } });
  return context;
}

function getSession(id: string): BrowserPanelSession {
  const session = sessions.get(id);
  if (!session || session.page.isClosed()) {
    sessions.delete(id);
    throw new Error('browser session not found');
  }
  return session;
}

export async function createBrowserPanelSession(url: string): Promise<BrowserPanelSnapshot> {
  const ctx = await getContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1365, height: 768 }).catch(() => {});
  const id = randomUUID();
  sessions.set(id, { id, page, createdAt: Date.now() });
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  return snapshotBrowserPanelSession(id);
}

export async function snapshotBrowserPanelSession(id: string): Promise<BrowserPanelSnapshot> {
  const session = getSession(id);
  const page = session.page;
  await page.waitForLoadState('domcontentloaded', { timeout: 3_000 }).catch(() => {});
  const viewport = page.viewportSize() || { width: 1365, height: 768 };
  const buffer = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: false });
  return {
    id,
    url: page.url(),
    title: await page.title().catch(() => ''),
    image: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    width: viewport.width,
    height: viewport.height,
    updatedAt: new Date().toISOString(),
  };
}

export async function navigateBrowserPanelSession(id: string, url: string): Promise<BrowserPanelSnapshot> {
  const session = getSession(id);
  await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  return snapshotBrowserPanelSession(id);
}

export async function reloadBrowserPanelSession(id: string): Promise<BrowserPanelSnapshot> {
  const session = getSession(id);
  await session.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  return snapshotBrowserPanelSession(id);
}

export async function clickBrowserPanelSession(id: string, xRatio: number, yRatio: number): Promise<BrowserPanelSnapshot> {
  const session = getSession(id);
  const viewport = session.page.viewportSize() || { width: 1365, height: 768 };
  const x = Math.max(0, Math.min(viewport.width, xRatio * viewport.width));
  const y = Math.max(0, Math.min(viewport.height, yRatio * viewport.height));
  await session.page.mouse.click(x, y);
  await session.page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
  return snapshotBrowserPanelSession(id);
}

export async function typeBrowserPanelSession(id: string, text: string): Promise<BrowserPanelSnapshot> {
  const session = getSession(id);
  await session.page.keyboard.type(text, { delay: 5 });
  return snapshotBrowserPanelSession(id);
}

export async function closeBrowserPanelSession(id: string): Promise<void> {
  const session = sessions.get(id);
  sessions.delete(id);
  if (session && !session.page.isClosed()) await session.page.close().catch(() => {});
}
