#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

function hasPrivilegedToken(value) {
  return /(^|\s)(sudo|runas|su)(\s|$)/i.test(String(value || ''));
}

function parseArgs(argv = process.argv.slice(2)) {
  let iterations = 1;
  let json = false;
  let retries = 0;
  let timeoutMs = 30000;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--iterations' || arg === '-n') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error('Invalid --iterations value. Use an integer >= 1.');
      }
      iterations = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === '--retries' || arg === '-r') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('Invalid --retries value. Use an integer >= 0.');
      }
      retries = Math.floor(value);
      i += 1;
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

  return { iterations, json, retries, timeoutMs };
}

function runCommand(command, args, options = {}) {
  const commandLine = [command, ...(args || [])].join(' ');
  if (hasPrivilegedToken(commandLine)) {
    return {
      ok: false,
      exitCode: 1,
      signal: null,
      durationMs: 0,
      timedOut: false,
      blockedPrivilegedCommand: true,
    };
  }

  const executable = command;
  const useShell = command === 'npm';

  const start = Date.now();
  const result = spawnSync(executable, args, {
    shell: useShell,
    stdio: 'inherit',
    env: process.env,
    timeout: options.timeoutMs,
  });
  const durationMs = Date.now() - start;
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');

  return {
    ok: result.status === 0,
    exitCode: result.status,
    signal: result.signal,
    durationMs,
    timedOut,
  };
}

function runWithRetries(command, args, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 0;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;
  const attempts = [];

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const result = runCommand(command, args, { timeoutMs });
    attempts.push(result);
    if (result.ok) {
      return {
        ...result,
        attempts,
        retriesUsed: attempt - 1,
      };
    }
  }

  const last = attempts[attempts.length - 1];
  return {
    ...last,
    attempts,
    retriesUsed: retries,
  };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function buildSummary(syncResult, integrationRuns) {
  const durations = integrationRuns.map((run) => run.durationMs);
  const failures = integrationRuns.filter((run) => !run.ok).length;
  const total = durations.reduce((acc, ms) => acc + ms, 0);

  return {
    ok: syncResult.ok && failures === 0,
    sync: syncResult,
    integration: {
      runs: integrationRuns.length,
      failures,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      avgMs: durations.length > 0 ? Math.round(total / durations.length) : 0,
      retriesUsed: integrationRuns.reduce((acc, run) => acc + (run.retriesUsed || 0), 0),
      timedOutRuns: integrationRuns.filter((run) => run.timedOut).length,
    },
    environment: {
      node: process.version,
      platform: process.platform,
    },
  };
}

function printHuman(summary) {
  if (summary.ok) {
    console.log('✅ OpenCode compatibility validation passed');
  } else {
    console.log('❌ OpenCode compatibility validation failed');
  }

  console.log(`- Sync check: ${summary.sync.ok ? 'PASS' : 'FAIL'} (${summary.sync.durationMs}ms)`);
  console.log(
    `- Integration checks: ${summary.integration.runs - summary.integration.failures}/${summary.integration.runs} passed`
  );
  console.log(
    `- Latency: p50=${summary.integration.p50Ms}ms p95=${summary.integration.p95Ms}ms avg=${summary.integration.avgMs}ms`
  );
  console.log(
    `- Resilience: retriesUsed=${summary.integration.retriesUsed} timedOutRuns=${summary.integration.timedOutRuns}`
  );
  console.log(
    `- Environment: node=${summary.environment.node} platform=${summary.environment.platform}`
  );
}

function main() {
  const { iterations, json, retries, timeoutMs } = parseArgs();

  console.log('--- OpenCode Compatibility Validation ---');
  const syncResult = runCommand('npm', ['run', 'validate:opencode-sync'], { timeoutMs });

  const integrationRuns = [];
  for (let i = 0; i < iterations; i += 1) {
    console.log(`--- OpenCode Integration Run ${i + 1}/${iterations} ---`);
    integrationRuns.push(
      runWithRetries('npm', ['run', 'validate:opencode-integration'], { retries, timeoutMs })
    );
  }

  const summary = buildSummary(syncResult, integrationRuns);

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHuman(summary);
  }

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  hasPrivilegedToken,
  runCommand,
  runWithRetries,
  percentile,
  buildSummary,
};
