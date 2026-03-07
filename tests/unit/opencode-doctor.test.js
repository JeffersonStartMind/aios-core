'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseArgs,
  getNodeMajor,
  checkPathExists,
  runDoctor,
} = require('../../.aiox-core/infrastructure/scripts/opencode-doctor');

describe('opencode-doctor', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-doctor-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('parses defaults and flags', () => {
    expect(parseArgs([])).toEqual({ json: false, quick: false, timeoutMs: 30000 });
    expect(parseArgs(['--json', '--quick', '--timeout-ms', '4000'])).toEqual({
      json: true,
      quick: true,
      timeoutMs: 4000,
    });
  });

  it('extracts major version number from node string', () => {
    expect(getNodeMajor('v22.20.0')).toBe(22);
    expect(getNodeMajor('18.19.1')).toBe(18);
    expect(getNodeMajor('invalid')).toBe(0);
  });

  it('checks path existence relative to project root', () => {
    fs.mkdirSync(path.join(tmpRoot, '.opencode', 'agents'), { recursive: true });

    const found = checkPathExists(tmpRoot, '.opencode/agents');
    const missing = checkPathExists(tmpRoot, '.opencode/commands');

    expect(found.ok).toBe(true);
    expect(missing.ok).toBe(false);
  });

  it('runs doctor in quick mode and reports missing required paths', () => {
    const report = runDoctor({ projectRoot: tmpRoot, quick: true });

    expect(report.ok).toBe(false);
    expect(report.summary.total).toBeGreaterThanOrEqual(5);
    expect(report.checks.some((check) => check.id === 'path:.opencode/agents' && !check.ok)).toBe(
      true
    );
  });

  it('passes path checks when required directories exist in quick mode', () => {
    fs.mkdirSync(path.join(tmpRoot, '.opencode', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, '.opencode', 'commands'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, '.aiox-core', 'development', 'agents'), { recursive: true });

    const report = runDoctor({ projectRoot: tmpRoot, quick: true });

    expect(report.checks.some((check) => check.id === 'path:.opencode/agents' && check.ok)).toBe(
      true
    );
    expect(report.checks.some((check) => check.id === 'path:.opencode/commands' && check.ok)).toBe(
      true
    );
    expect(
      report.checks.some((check) => check.id === 'path:.aiox-core/development/agents' && check.ok)
    ).toBe(true);
  });
});
