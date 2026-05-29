#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const ENVIRONMENTS = {
  lab01: {
    workersUrl: 'https://assistant-lab01.ai.mvp.rclabenv.com/workers',
    callPlatformUrl: 'https://rc-a-develop.jupiter.int.rclabenv.com/',
    username: '17314277792',
    password: 'Test!123',
    callPlatformFrom: 'XMN-UP',
    callPlatformTo: 'XMN-UP-XMN',
  },
};

function parseArgs(argv) {
  const args = {
    env: 'lab01',
    headed: true,
    keepOpenMs: 300000,
    close: false,
    slowMo: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--env') {
      args.env = argv[++i];
    } else if (arg === '--headless') {
      args.headed = false;
    } else if (arg === '--headed') {
      args.headed = true;
    } else if (arg === '--close') {
      args.close = true;
      args.keepOpenMs = 0;
    } else if (arg === '--keep-open-ms') {
      args.keepOpenMs = Number(argv[++i]);
    } else if (arg === '--slow-mo') {
      args.slowMo = Number(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.keepOpenMs) || args.keepOpenMs < 0) {
    throw new Error('--keep-open-ms must be a non-negative number');
  }
  if (!Number.isFinite(args.slowMo) || args.slowMo < 0) {
    throw new Error('--slow-mo must be a non-negative number');
  }
  return args;
}

function printHelp() {
  console.log(`AIR Pro lab login helper

Usage:
  node .pikiclaw/skills/air-pro-login/scripts/air-pro-login.mjs [options]

Options:
  --env <name>             Environment name. Default: lab01
  --headed                 Show Chrome. Default.
  --headless               Run headless.
  --keep-open-ms <ms>      Keep browser open after automation. Default: 300000
  --close                  Close immediately after automation.
  --slow-mo <ms>           Playwright slow motion delay.
  -h, --help               Show this help.
`);
}

async function visible(locator) {
  try {
    return await locator.first().isVisible({ timeout: 1000 });
  } catch {
    return false;
  }
}

async function fillFirst(page, locators, value, label) {
  for (const locator of locators) {
    if (await visible(locator)) {
      await locator.first().fill(value);
      return true;
    }
  }
  console.warn(`[warn] Could not find ${label} field on ${page.url()}`);
  return false;
}

async function clickFirst(page, locators, label) {
  for (const locator of locators) {
    if (await visible(locator)) {
      await locator.first().click();
      return true;
    }
  }
  console.warn(`[warn] Could not find ${label} on ${page.url()}`);
  return false;
}

async function maybeLogin(page, config, label) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

  const passwordVisible = await visible(page.locator('input[type="password"]'));
  const loginTextVisible = await visible(page.getByText(/登录|Login|Sign in|Sign In|Submit/i));
  if (!passwordVisible && !loginTextVisible) {
    console.log(`[ok] ${label}: no visible login form detected`);
    return;
  }

  console.log(`[info] ${label}: login form detected, filling credentials`);
  await fillFirst(page, [
    page.getByLabel(/账号|手机号|手机|用户名|用户名\/手机号|Account|Username|Mobile|Phone/i),
    page.getByPlaceholder(/账号|手机号|手机|用户名|请输入|Account|Username|Mobile|Phone/i),
    page.locator('input[name*="user" i]'),
    page.locator('input[name*="phone" i]'),
    page.locator('input[name*="mobile" i]'),
    page.locator('input[type="tel"]'),
    page.locator('input[type="text"]'),
    page.locator('input:not([type]), input[type="email"]'),
  ], config.username, 'username');

  await fillFirst(page, [
    page.getByLabel(/密码|Password/i),
    page.getByPlaceholder(/密码|Password/i),
    page.locator('input[type="password"]'),
  ], config.password, 'password');

  const clicked = await clickFirst(page, [
    page.getByRole('button', { name: /登录|Login|Sign in|Sign In|Submit/i }),
    page.locator('button[type="submit"]'),
    page.locator('input[type="submit"]'),
    page.getByText(/登录|Login|Sign in|Sign In|Submit/i),
  ], 'login submit');

  if (clicked) {
    await Promise.race([
      page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}),
      page.waitForTimeout(3000),
    ]);
  }
}

async function switchCallPlatform(page, config) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

  if (await visible(page.getByText(config.callPlatformTo, { exact: true }))) {
    console.log(`[ok] call platform already shows ${config.callPlatformTo}`);
    return;
  }

  const current = page.getByText(config.callPlatformFrom, { exact: true });
  if (!(await visible(current))) {
    console.warn(`[warn] call platform selector text ${config.callPlatformFrom} was not visible`);
    return;
  }

  console.log(`[info] switching call platform: ${config.callPlatformFrom} -> ${config.callPlatformTo}`);
  await current.first().click();
  await page.waitForTimeout(800);

  const targetLocators = [
    page.getByRole('option', { name: config.callPlatformTo }),
    page.getByRole('menuitem', { name: config.callPlatformTo }),
    page.getByText(config.callPlatformTo, { exact: true }),
  ];

  const clicked = await clickFirst(page, targetLocators, `call platform option ${config.callPlatformTo}`);
  if (!clicked) return;

  await Promise.race([
    page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}),
    page.waitForTimeout(2000),
  ]);

  if (await visible(page.getByText(config.callPlatformTo, { exact: true }))) {
    console.log(`[ok] call platform switched to ${config.callPlatformTo}`);
  } else {
    console.warn(`[warn] did not verify visible ${config.callPlatformTo} after switch`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = ENVIRONMENTS[args.env];
  if (!config) {
    throw new Error(`Unknown env "${args.env}". Available: ${Object.keys(ENVIRONMENTS).join(', ')}`);
  }

  const userDataDir = path.join(os.homedir(), '.pikiclaw', 'air-pro-login', args.env);
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: !args.headed,
    ignoreHTTPSErrors: true,
    slowMo: args.slowMo,
    viewport: { width: 1440, height: 1000 },
  });

  try {
    const workersPage = context.pages()[0] || await context.newPage();
    await workersPage.goto(config.workersUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await maybeLogin(workersPage, config, 'AIR workers');

    const callPage = await context.newPage();
    await callPage.goto(config.callPlatformUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await maybeLogin(callPage, config, 'call platform');
    await switchCallPlatform(callPage, config);

    console.log(`[done] AIR workers: ${workersPage.url()}`);
    console.log(`[done] Call platform: ${callPage.url()}`);

    if (!args.close && args.keepOpenMs > 0) {
      console.log(`[info] keeping browser open for ${args.keepOpenMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, args.keepOpenMs));
    }
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(`[error] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
