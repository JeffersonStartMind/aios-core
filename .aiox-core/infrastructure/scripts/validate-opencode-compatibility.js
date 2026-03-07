#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');

const MAX_RETRIES = 5;
const DEFAULT_TARGETS = {
  successRate: 0.99,
  p95Ms: 2000,
  flakinessRate: 0.02,
  timedOutRuns: 0,
};

const ERROR_CODES = {
  NONE: 'OK',
  PRIVILEGED_BLOCKED: 'SEC_PRIVILEGED_BLOCKED',
  DEPENDENCY_UNAVAILABLE: 'DEP_CMD_NOT_FOUND',
  COMMAND_TIMEOUT: 'RES_TIMEOUT',
  COMMAND_FAILED: 'CMD_EXIT_NONZERO',
};

function hasPrivilegedToken(value) {
  return /(^|\s)(sudo|runas|su)(\s|$)/i.test(String(value || ''));
}

function createSessionId() {
  return `sess-${process.pid}-${Date.now()}`;
}

function createCorrelationId() {
  return randomUUID();
}

function sleepMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }

  try {
    const buffer = new SharedArrayBuffer(4);
    const view = new Int32Array(buffer);
    Atomics.wait(view, 0, 0, Math.floor(ms));
  } catch {
    const start = Date.now();
    while (Date.now() - start < ms) {
      // fallback busy wait
    }
  }
}

function computeBackoffDelay(attempt, options = {}) {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
  const backoffMs = Number.isFinite(options.backoffMs) ? options.backoffMs : 250;
  const maxBackoffMs = Number.isFinite(options.maxBackoffMs) ? options.maxBackoffMs : 3000;
  const jitterMs = Number.isFinite(options.jitterMs) ? options.jitterMs : 150;
  const randomFn = typeof options.randomFn === 'function' ? options.randomFn : Math.random;

  const exponential = Math.min(maxBackoffMs, backoffMs * 2 ** (safeAttempt - 1));
  const jitter = Math.floor(Math.max(0, jitterMs) * randomFn());
  return Math.max(0, Math.floor(exponential + jitter));
}

function emitStructuredLog(event) {
  if (!event || event.enabled === false) {
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level: event.level || 'info',
    component: event.component || 'opencode.compatibility',
    command: event.command || 'validate:integration',
    session_id: event.sessionId || null,
    correlation_id: event.correlationId || null,
    duration_ms: Number.isFinite(event.durationMs) ? event.durationMs : 0,
    result: event.result || 'unknown',
    error_code: event.errorCode || ERROR_CODES.NONE,
    message: event.message || '',
  };

  const optionalFields = {
    attempts: event.attempts,
    retries_used: event.retriesUsed,
    retry_in_ms: event.retryInMs,
    command_line: event.commandLine,
    metadata: event.metadata,
  };

  for (const [key, value] of Object.entries(optionalFields)) {
    if (value !== undefined) {
      payload[key] = value;
    }
  }

  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

function parseArgs(argv = process.argv.slice(2)) {
  let iterations = 1;
  let json = false;
  let retries = 0;
  let timeoutMs = 30000;
  let backoffMs = 250;
  let maxBackoffMs = 3000;
  let jitterMs = 150;
  let outputPath = null;

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
      if (!Number.isFinite(value) || value < 0 || value > MAX_RETRIES) {
        throw new Error(`Invalid --retries value. Use an integer between 0 and ${MAX_RETRIES}.`);
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
      continue;
    }
    if (arg === '--backoff-ms') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('Invalid --backoff-ms value. Use an integer >= 0.');
      }
      backoffMs = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === '--max-backoff-ms') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('Invalid --max-backoff-ms value. Use an integer >= 0.');
      }
      maxBackoffMs = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === '--jitter-ms') {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('Invalid --jitter-ms value. Use an integer >= 0.');
      }
      jitterMs = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === '--output') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Invalid --output value. Use a writable file path.');
      }
      outputPath = value;
      i += 1;
    }
  }

  return {
    iterations,
    json,
    retries,
    timeoutMs,
    backoffMs,
    maxBackoffMs,
    jitterMs,
    outputPath,
  };
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
      dependencyUnavailable: false,
      errorCode: ERROR_CODES.PRIVILEGED_BLOCKED,
      message: 'Privileged command blocked by security guard',
    };
  }

  const executable = command;
  const useShell = command === 'npm';

  const start = Date.now();
  const result = spawnSync(executable, args, {
    shell: useShell,
    stdio: options.stdio || 'inherit',
    env: options.env || process.env,
    timeout: options.timeoutMs,
  });
  const durationMs = Date.now() - start;
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  const dependencyUnavailable = Boolean(result.error && result.error.code === 'ENOENT');
  const errorCode = dependencyUnavailable
    ? ERROR_CODES.DEPENDENCY_UNAVAILABLE
    : timedOut
      ? ERROR_CODES.COMMAND_TIMEOUT
      : result.status === 0
        ? ERROR_CODES.NONE
        : ERROR_CODES.COMMAND_FAILED;

  let message = '';
  if (dependencyUnavailable) {
    message = `Command '${command}' is unavailable in this environment`;
  } else if (timedOut) {
    message = `Command '${commandLine}' timed out after ${options.timeoutMs}ms`;
  } else if (result.status !== 0) {
    message = `Command '${commandLine}' exited with code ${result.status}`;
  }

  return {
    ok: result.status === 0,
    exitCode: result.status,
    signal: result.signal,
    durationMs,
    timedOut,
    blockedPrivilegedCommand: false,
    dependencyUnavailable,
    errorCode,
    message,
    commandLine,
  };
}

function runWithRetries(command, args, options = {}) {
  const retries = Number.isFinite(options.retries)
    ? Math.max(0, Math.min(MAX_RETRIES, options.retries))
    : 0;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;
  const sleepFn = typeof options.sleepFn === 'function' ? options.sleepFn : sleepMs;
  const logger = typeof options.logger === 'function' ? options.logger : null;
  const attempts = [];

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const result = runCommand(command, args, {
      timeoutMs,
      env: options.env,
      stdio: options.stdio,
    });
    attempts.push({ ...result, attempt });

    if (result.ok) {
      return {
        ...result,
        attempts,
        retriesUsed: attempt - 1,
      };
    }

    const nonRetriable = result.blockedPrivilegedCommand || result.dependencyUnavailable;
    if (nonRetriable || attempt > retries) {
      break;
    }

    const retryInMs = computeBackoffDelay(attempt, {
      backoffMs: options.backoffMs,
      maxBackoffMs: options.maxBackoffMs,
      jitterMs: options.jitterMs,
      randomFn: options.randomFn,
    });

    if (logger) {
      logger({
        level: 'warn',
        result: 'retrying',
        errorCode: result.errorCode,
        message: `Retry attempt ${attempt}/${retries}`,
        retryInMs,
        attempts: attempt,
        commandLine: result.commandLine,
      });
    }

    sleepFn(retryInMs);
  }

  const last = attempts[attempts.length - 1];
  return {
    ...last,
    attempts,
    retriesUsed: Math.max(0, attempts.length - 1),
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
  const successful = integrationRuns.length - failures;
  const successRate = integrationRuns.length > 0 ? successful / integrationRuns.length : 0;
  const timedOutRuns = integrationRuns.filter((run) => run.timedOut).length;
  const runsWithRetry = integrationRuns.filter((run) => (run.retriesUsed || 0) > 0).length;
  const flakinessRate = integrationRuns.length > 0 ? runsWithRetry / integrationRuns.length : 0;
  const throughputRunsPerMinute =
    total > 0 ? Number(((integrationRuns.length * 60000) / total).toFixed(2)) : 0;
  const failureCodes = integrationRuns
    .filter((run) => !run.ok && run.errorCode)
    .reduce((acc, run) => {
      acc[run.errorCode] = (acc[run.errorCode] || 0) + 1;
      return acc;
    }, {});

  const summary = {
    ok: syncResult.ok && failures === 0,
    sync: syncResult,
    integration: {
      runs: integrationRuns.length,
      failures,
      successRate,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      avgMs: durations.length > 0 ? Math.round(total / durations.length) : 0,
      throughputRunsPerMinute,
      flakinessRate,
      retriesUsed: integrationRuns.reduce((acc, run) => acc + (run.retriesUsed || 0), 0),
      timedOutRuns,
      blockedPrivilegedRuns: integrationRuns.filter((run) => run.blockedPrivilegedCommand).length,
      dependencyUnavailableRuns: integrationRuns.filter((run) => run.dependencyUnavailable).length,
      failureCodes,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      pid: process.pid,
    },
    resources: {
      memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      cpuUserMs: Math.round(process.cpuUsage().user / 1000),
      cpuSystemMs: Math.round(process.cpuUsage().system / 1000),
    },
    targets: {
      ...DEFAULT_TARGETS,
    },
  };

  summary.alerts = buildAlerts(summary);
  return summary;
}

function buildAlerts(summary) {
  const alerts = [];
  const { targets, integration } = summary;

  alerts.push({
    id: 'opencode-sync',
    severity: 'critical',
    status: summary.sync.ok ? 'ok' : 'alert',
    threshold: 'sync must pass',
    actual: summary.sync.ok ? 'pass' : 'fail',
    message: summary.sync.ok
      ? 'OpenCode sync validation passed'
      : 'OpenCode sync validation failed',
  });

  alerts.push({
    id: 'success-rate',
    severity: 'high',
    status: integration.successRate >= targets.successRate ? 'ok' : 'alert',
    threshold: `>= ${Math.round(targets.successRate * 100)}%`,
    actual: `${(integration.successRate * 100).toFixed(2)}%`,
    message:
      integration.successRate >= targets.successRate
        ? 'Success rate within SLO'
        : 'Success rate below SLO target',
  });

  alerts.push({
    id: 'p95-latency',
    severity: 'medium',
    status: integration.p95Ms <= targets.p95Ms ? 'ok' : 'alert',
    threshold: `<= ${targets.p95Ms}ms`,
    actual: `${integration.p95Ms}ms`,
    message:
      integration.p95Ms <= targets.p95Ms
        ? 'P95 latency within SLO'
        : 'P95 latency above SLO target',
  });

  alerts.push({
    id: 'flakiness',
    severity: 'medium',
    status: integration.flakinessRate <= targets.flakinessRate ? 'ok' : 'alert',
    threshold: `<= ${(targets.flakinessRate * 100).toFixed(2)}%`,
    actual: `${(integration.flakinessRate * 100).toFixed(2)}%`,
    message:
      integration.flakinessRate <= targets.flakinessRate
        ? 'Flakiness under control'
        : 'Flakiness above acceptable threshold',
  });

  alerts.push({
    id: 'timeouts',
    severity: 'high',
    status: integration.timedOutRuns <= targets.timedOutRuns ? 'ok' : 'alert',
    threshold: `<= ${targets.timedOutRuns}`,
    actual: `${integration.timedOutRuns}`,
    message:
      integration.timedOutRuns <= targets.timedOutRuns
        ? 'No timeout alerts'
        : 'Timeouts detected in integration runs',
  });

  alerts.push({
    id: 'dependency-availability',
    severity: 'critical',
    status: integration.dependencyUnavailableRuns === 0 ? 'ok' : 'alert',
    threshold: '= 0',
    actual: `${integration.dependencyUnavailableRuns}`,
    message:
      integration.dependencyUnavailableRuns === 0
        ? 'Dependencies available'
        : 'Command dependency unavailable',
  });

  return alerts;
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
  console.log(`- Success rate: ${(summary.integration.successRate * 100).toFixed(2)}%`);
  console.log(
    `- Latency: p50=${summary.integration.p50Ms}ms p95=${summary.integration.p95Ms}ms avg=${summary.integration.avgMs}ms`
  );
  console.log(`- Throughput: ${summary.integration.throughputRunsPerMinute} runs/min`);
  console.log(
    `- Resilience: retriesUsed=${summary.integration.retriesUsed} timedOutRuns=${summary.integration.timedOutRuns} dependencyUnavailableRuns=${summary.integration.dependencyUnavailableRuns}`
  );
  console.log(
    `- Environment: node=${summary.environment.node} platform=${summary.environment.platform}`
  );
  console.log(
    `- Resources: rss=${summary.resources.memoryRssMb}MB cpu(user/system)=${summary.resources.cpuUserMs}ms/${summary.resources.cpuSystemMs}ms`
  );

  const activeAlerts = summary.alerts.filter((alert) => alert.status === 'alert');
  if (activeAlerts.length > 0) {
    console.log('- Alerts:');
    for (const alert of activeAlerts) {
      console.log(
        `  - [${alert.severity}] ${alert.id}: ${alert.message} (actual ${alert.actual}, target ${alert.threshold})`
      );
    }
  } else {
    console.log('- Alerts: none');
  }
}

function writeSummaryFile(summary, outputPath) {
  if (!outputPath) {
    return null;
  }

  const absolutePath = path.isAbsolute(outputPath)
    ? outputPath
    : path.join(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return absolutePath;
}

function main() {
  const { iterations, json, retries, timeoutMs, backoffMs, maxBackoffMs, jitterMs, outputPath } =
    parseArgs();

  const sessionId = process.env.AIOX_SESSION_ID || createSessionId();
  const correlationId = process.env.AIOX_CORRELATION_ID || createCorrelationId();
  const commandEnv = {
    ...process.env,
    AIOX_SESSION_ID: sessionId,
    AIOX_CORRELATION_ID: correlationId,
  };

  emitStructuredLog({
    level: 'info',
    sessionId,
    correlationId,
    result: 'started',
    message: 'Starting OpenCode compatibility validation',
    metadata: { iterations, retries, timeoutMs, backoffMs, maxBackoffMs, jitterMs },
  });

  console.log('--- OpenCode Compatibility Validation ---');
  const syncResult = runCommand('npm', ['run', 'validate:opencode-sync'], {
    timeoutMs,
    env: commandEnv,
  });

  const integrationRuns = [];
  for (let i = 0; i < iterations; i += 1) {
    console.log(`--- OpenCode Integration Run ${i + 1}/${iterations} ---`);
    integrationRuns.push(
      runWithRetries('npm', ['run', 'validate:opencode-integration'], {
        retries,
        timeoutMs,
        backoffMs,
        maxBackoffMs,
        jitterMs,
        env: commandEnv,
        logger: (event) => {
          emitStructuredLog({
            ...event,
            sessionId,
            correlationId,
          });
        },
      })
    );
  }

  const summary = buildSummary(syncResult, integrationRuns);
  summary.session = {
    sessionId,
    correlationId,
  };

  const writtenPath = writeSummaryFile(summary, outputPath);
  if (writtenPath) {
    emitStructuredLog({
      level: 'info',
      sessionId,
      correlationId,
      result: 'artifact_written',
      message: 'Wrote compatibility summary artifact',
      metadata: { outputPath: writtenPath },
    });
  }

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHuman(summary);
  }

  emitStructuredLog({
    level: summary.ok ? 'info' : 'error',
    sessionId,
    correlationId,
    durationMs:
      summary.sync.durationMs +
      summary.integration.runs * summary.integration.avgMs +
      summary.integration.retriesUsed,
    result: summary.ok ? 'success' : 'failed',
    errorCode: summary.ok ? ERROR_CODES.NONE : summary.integration.failureCodes,
    message: 'OpenCode compatibility validation finished',
    metadata: {
      runs: summary.integration.runs,
      failures: summary.integration.failures,
      alerts: summary.alerts.filter((alert) => alert.status === 'alert').length,
    },
  });

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
  computeBackoffDelay,
  sleepMs,
  percentile,
  buildSummary,
  buildAlerts,
  emitStructuredLog,
  MAX_RETRIES,
  ERROR_CODES,
};
