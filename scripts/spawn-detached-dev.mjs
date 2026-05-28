#!/usr/bin/env node

import fs from 'node:fs';
import { spawn } from 'node:child_process';

const [logFile, scriptPath, ...scriptArgs] = process.argv.slice(2);

if (!logFile || !scriptPath) {
  process.stderr.write('Usage: node scripts/spawn-detached-dev.mjs <log-file> <dev-script> [args...]\n');
  process.exit(1);
}

const logFd = fs.openSync(logFile, 'a');
const child = spawn('bash', [scriptPath, ...scriptArgs], {
  detached: true,
  stdio: ['ignore', logFd, logFd],
  env: {
    ...process.env,
    PIKICLAW_DEV_DETACHED: '1',
  },
  cwd: process.cwd(),
});

child.unref();
fs.closeSync(logFd);
process.stdout.write(String(child.pid || ''));

