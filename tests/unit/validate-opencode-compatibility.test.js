'use strict';

const {
  parseArgs,
  hasPrivilegedToken,
  runCommand,
  runWithRetries,
  computeBackoffDelay,
  percentile,
  buildSummary,
  MAX_RETRIES,
  ERROR_CODES,
} = require('../../.aiox-core/infrastructure/scripts/validate-opencode-compatibility');

describe('validate-opencode-compatibility', () => {
  describe('parseArgs', () => {
    it('uses defaults when no args are provided', () => {
      expect(parseArgs([])).toEqual({
        iterations: 1,
        json: false,
        retries: 0,
        timeoutMs: 30000,
        backoffMs: 250,
        maxBackoffMs: 3000,
        jitterMs: 150,
        outputPath: null,
      });
    });

    it('parses iterations and json flags', () => {
      expect(
        parseArgs([
          '--iterations',
          '3',
          '--json',
          '--retries',
          '1',
          '--timeout-ms',
          '8000',
          '--backoff-ms',
          '100',
          '--max-backoff-ms',
          '1500',
          '--jitter-ms',
          '50',
          '--output',
          'reports/summary.json',
        ])
      ).toEqual({
        iterations: 3,
        json: true,
        retries: 1,
        timeoutMs: 8000,
        backoffMs: 100,
        maxBackoffMs: 1500,
        jitterMs: 50,
        outputPath: 'reports/summary.json',
      });
      expect(parseArgs(['-n', '2', '-r', '2'])).toEqual({
        iterations: 2,
        json: false,
        retries: 2,
        timeoutMs: 30000,
        backoffMs: 250,
        maxBackoffMs: 3000,
        jitterMs: 150,
        outputPath: null,
      });
    });

    it('throws on invalid iterations', () => {
      expect(() => parseArgs(['--iterations', '0'])).toThrow('Invalid --iterations value');
      expect(() => parseArgs(['-n', 'abc'])).toThrow('Invalid --iterations value');
      expect(() => parseArgs(['--retries', '-1'])).toThrow('Invalid --retries value');
      expect(() => parseArgs(['--retries', String(MAX_RETRIES + 1)])).toThrow(
        'Invalid --retries value'
      );
      expect(() => parseArgs(['--timeout-ms', '0'])).toThrow('Invalid --timeout-ms value');
    });
  });

  describe('runWithRetries', () => {
    it('returns success without retries for a passing command', () => {
      const result = runWithRetries('node', ['-e', 'process.exit(0)'], {
        retries: 2,
        timeoutMs: 5000,
        sleepFn: () => {},
      });
      expect(result.ok).toBe(true);
      expect(result.retriesUsed).toBe(0);
      expect(result.attempts.length).toBe(1);
    });

    it('exhausts retries for a failing command', () => {
      const result = runWithRetries('node', ['-e', 'process.exit(1)'], {
        retries: 2,
        timeoutMs: 5000,
        backoffMs: 1,
        maxBackoffMs: 2,
        jitterMs: 0,
        sleepFn: () => {},
        randomFn: () => 0,
      });
      expect(result.ok).toBe(false);
      expect(result.retriesUsed).toBe(2);
      expect(result.attempts.length).toBe(3);
    });

    it('does not retry when command dependency is unavailable', () => {
      const result = runWithRetries('__definitely_missing_command__', ['--version'], {
        retries: 3,
        timeoutMs: 1000,
        sleepFn: () => {},
      });

      expect(result.ok).toBe(false);
      expect(result.dependencyUnavailable).toBe(true);
      expect(result.retriesUsed).toBe(0);
      expect(result.attempts.length).toBe(1);
      expect(result.errorCode).toBe(ERROR_CODES.DEPENDENCY_UNAVAILABLE);
    });
  });

  describe('computeBackoffDelay', () => {
    it('applies exponential backoff with upper bound', () => {
      expect(
        computeBackoffDelay(1, {
          backoffMs: 100,
          maxBackoffMs: 500,
          jitterMs: 0,
          randomFn: () => 0,
        })
      ).toBe(100);
      expect(
        computeBackoffDelay(2, {
          backoffMs: 100,
          maxBackoffMs: 500,
          jitterMs: 0,
          randomFn: () => 0,
        })
      ).toBe(200);
      expect(
        computeBackoffDelay(5, {
          backoffMs: 100,
          maxBackoffMs: 500,
          jitterMs: 0,
          randomFn: () => 0,
        })
      ).toBe(500);
    });
  });

  describe('privilege safety', () => {
    it('detects privileged tokens in command strings', () => {
      expect(hasPrivilegedToken('sudo npm test')).toBe(true);
      expect(hasPrivilegedToken('runas /user:Administrator cmd')).toBe(true);
      expect(hasPrivilegedToken('npm run validate:integration')).toBe(false);
    });

    it('blocks privileged command execution', () => {
      const result = runCommand('sudo', ['npm', 'test'], { timeoutMs: 5000 });
      expect(result.ok).toBe(false);
      expect(result.blockedPrivilegedCommand).toBe(true);
      expect(result.errorCode).toBe(ERROR_CODES.PRIVILEGED_BLOCKED);
    });
  });

  describe('percentile', () => {
    it('returns expected percentile for sorted/unsorted arrays', () => {
      expect(percentile([100, 300, 200], 50)).toBe(200);
      expect(percentile([100, 300, 200], 95)).toBe(300);
    });

    it('returns 0 for empty arrays', () => {
      expect(percentile([], 95)).toBe(0);
    });
  });

  describe('buildSummary', () => {
    it('marks summary as ok when all checks pass', () => {
      const sync = { ok: true, durationMs: 100, exitCode: 0, signal: null };
      const runs = [
        { ok: true, durationMs: 800, exitCode: 0, signal: null },
        { ok: true, durationMs: 1200, exitCode: 0, signal: null },
      ];

      const summary = buildSummary(sync, runs);
      expect(summary.ok).toBe(true);
      expect(summary.integration.failures).toBe(0);
      expect(summary.integration.p50Ms).toBe(800);
      expect(summary.integration.p95Ms).toBe(1200);
      expect(summary.integration.avgMs).toBe(1000);
      expect(summary.integration.retriesUsed).toBe(0);
      expect(summary.integration.timedOutRuns).toBe(0);
      expect(summary.integration.throughputRunsPerMinute).toBeGreaterThan(0);
      expect(summary.alerts).toBeDefined();
      expect(Array.isArray(summary.alerts)).toBe(true);
    });

    it('marks summary as failed when sync or runs fail', () => {
      const sync = { ok: false, durationMs: 100, exitCode: 1, signal: null };
      const runs = [
        { ok: true, durationMs: 900, exitCode: 0, signal: null },
        { ok: false, durationMs: 1500, exitCode: 1, signal: null },
      ];

      const summary = buildSummary(sync, runs);
      expect(summary.ok).toBe(false);
      expect(summary.integration.failures).toBe(1);
      expect(summary.integration.runs).toBe(2);
      expect(summary.integration.retriesUsed).toBe(0);
      expect(summary.alerts.some((alert) => alert.id === 'success-rate')).toBe(true);
    });
  });
});
