#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');

function parseArgs(argv = process.argv.slice(2)) {
  let json = false;
  let quick = false;
  let timeoutMs = 30000;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--quick') {
      quick = true;
      continue;
    }
    if (arg === '--timeout-ms') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value < 1000) {
        throw new Error('Invalid --timeout-ms value. Use an integer >= 1000.');
      }
      timeoutMs = Math.floor(value);
      i += 1;
    }
  }

  return {
    json,
    quick,
    timeoutMs,
  };
}

function createSessionId() {
  return `sess-${process.pid}-${Date.now()}`;
}

function createCorrelationId() {
  return randomUUID();
}

function getNodeMajor(version = process.version) {
  const major = Number(String(version).replace(/^v/, '').split('.')[0]);
  return Number.isFinite(major) ? major : 0;
}

function runCommand(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    shell: command === 'npm',
    encoding: 'utf8',
    timeout: options.timeoutMs,
    env: options.env || process.env,
    stdio: options.stdio || 'pipe',
  });

  const durationMs = Date.now() - startedAt;
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  const dependencyUnavailable = Boolean(result.error && result.error.code === 'ENOENT');

  return {
    ok: result.status === 0,
    status: result.status,
    durationMs,
    timedOut,
    dependencyUnavailable,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function checkPathExists(projectRoot, relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  const ok = fs.existsSync(absolutePath);
  return {
    id: `path:${relativePath}`,
    ok,
    severity: ok ? 'info' : 'high',
    message: ok ? `Found ${relativePath}` : `Missing required path: ${relativePath}`,
    durationMs: 0,
  };
}

function checkNodeVersion() {
  const major = getNodeMajor();
  const ok = major >= 18;
  return {
    id: 'runtime:node',
    ok,
    severity: ok ? 'info' : 'high',
    message: ok
      ? `Node version supported (${process.version})`
      : `Node version not supported (${process.version})`,
    durationMs: 0,
  };
}

function checkNpmVersion(timeoutMs) {
  const result = runCommand('npm', ['--version'], { timeoutMs });
  if (!result.ok) {
    return {
      id: 'runtime:npm',
      ok: false,
      severity: 'high',
      message: result.dependencyUnavailable
        ? 'npm command unavailable in this environment'
        : 'Failed to read npm version',
      durationMs: result.durationMs,
    };
  }

  const major = Number(String(result.stdout).trim().split('.')[0]);
  const ok = Number.isFinite(major) && major >= 9;
  return {
    id: 'runtime:npm',
    ok,
    severity: ok ? 'info' : 'medium',
    message: ok
      ? `npm version supported (${String(result.stdout).trim()})`
      : `npm version below requirement (${String(result.stdout).trim()})`,
    durationMs: result.durationMs,
  };
}

function checkValidationCommand(scriptName, timeoutMs, env) {
  const result = runCommand('npm', ['run', scriptName], { timeoutMs, env, stdio: 'pipe' });
  return {
    id: `command:${scriptName}`,
    ok: result.ok,
    severity: result.ok ? 'info' : 'high',
    message: result.ok
      ? `Command '${scriptName}' passed`
      : `Command '${scriptName}' failed${result.timedOut ? ' (timeout)' : ''}`,
    durationMs: result.durationMs,
  };
}

function runDoctor(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;
  const sessionId = options.sessionId || process.env.AIOX_SESSION_ID || createSessionId();
  const correlationId =
    options.correlationId || process.env.AIOX_CORRELATION_ID || createCorrelationId();

  const checks = [];
  checks.push(checkNodeVersion());
  checks.push(checkNpmVersion(timeoutMs));
  checks.push(checkPathExists(projectRoot, '.opencode/agents'));
  checks.push(checkPathExists(projectRoot, '.opencode/commands'));
  checks.push(checkPathExists(projectRoot, '.aiox-core/development/agents'));

  const skipCommandChecks = options.skipCommandChecks || options.quick;
  if (!skipCommandChecks) {
    const commandEnv = {
      ...process.env,
      AIOX_SESSION_ID: sessionId,
      AIOX_CORRELATION_ID: correlationId,
    };
    checks.push(checkValidationCommand('validate:opencode-sync', timeoutMs, commandEnv));
    checks.push(checkValidationCommand('validate:opencode-integration', timeoutMs, commandEnv));
  }

  const failures = checks.filter((check) => !check.ok);
  const totalDurationMs = checks.reduce((acc, check) => acc + (check.durationMs || 0), 0);

  return {
    ok: failures.length === 0,
    session: {
      sessionId,
      correlationId,
    },
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failures.length,
      failed: failures.length,
      totalDurationMs,
    },
  };
}

function printHuman(report) {
  console.log('--- OpenCode Doctor ---');
  console.log(report.ok ? 'OK: integration is healthy' : 'FAIL: integration checks found issues');

  for (const check of report.checks) {
    const status = check.ok ? 'PASS' : 'FAIL';
    console.log(`- [${status}] ${check.id}: ${check.message}`);
  }

  console.log(
    `- Summary: ${report.summary.passed}/${report.summary.total} checks passed in ${report.summary.totalDurationMs}ms`
  );
}

function main() {
  const args = parseArgs();
  const report = runDoctor(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  getNodeMajor,
  runCommand,
  checkPathExists,
  checkNodeVersion,
  checkNpmVersion,
  checkValidationCommand,
  runDoctor,
  printHuman,
};
