'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validateOpencodeIntegration,
  parseArgs,
  isPathInsideRoot,
  redactSecrets,
} = require('../../.aiox-core/infrastructure/scripts/validate-opencode-integration');

describe('validate-opencode-integration', () => {
  let tmpRoot;

  function write(file, content = '') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-opencode-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes when OpenCode agents and commands are present and aligned', () => {
    write(path.join(tmpRoot, '.aiox-core', 'development', 'agents', 'dev.md'), '# dev');
    write(path.join(tmpRoot, '.aiox-core', 'development', 'agents', 'qa.md'), '# qa');

    write(path.join(tmpRoot, '.opencode', 'agents', 'dev.md'), '# dev');
    write(path.join(tmpRoot, '.opencode', 'agents', 'qa.md'), '# qa');

    write(path.join(tmpRoot, '.opencode', 'commands', 'aiox-dev.md'), '---\nname: dev\n---\n');
    write(path.join(tmpRoot, '.opencode', 'commands', 'aiox-qa.md'), '---\nname: qa\n---\n');

    const result = validateOpencodeIntegration({ projectRoot: tmpRoot });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.metrics.sourceAgents).toBe(2);
    expect(result.metrics.opencodeAgents).toBe(2);
    expect(result.metrics.opencodeCommands).toBe(2);
  });

  it('fails when OpenCode directories are missing', () => {
    const result = validateOpencodeIntegration({ projectRoot: tmpRoot });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Missing OpenCode agents dir'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Missing OpenCode commands dir'))).toBe(true);
  });

  it('warns when counts differ from source agents', () => {
    write(path.join(tmpRoot, '.aiox-core', 'development', 'agents', 'dev.md'), '# dev');
    write(path.join(tmpRoot, '.aiox-core', 'development', 'agents', 'qa.md'), '# qa');

    write(path.join(tmpRoot, '.opencode', 'agents', 'dev.md'), '# dev');
    write(path.join(tmpRoot, '.opencode', 'commands', 'aiox-dev.md'), '---\nname: dev\n---\n');

    const result = validateOpencodeIntegration({ projectRoot: tmpRoot });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('agent count differs from source'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('command count differs from source'))).toBe(true);
  });

  it('fails when command file is missing YAML frontmatter', () => {
    write(path.join(tmpRoot, '.aiox-core', 'development', 'agents', 'dev.md'), '# dev');
    write(path.join(tmpRoot, '.opencode', 'agents', 'dev.md'), '# dev');
    write(path.join(tmpRoot, '.opencode', 'commands', 'aiox-dev.md'), '# no-frontmatter');

    const result = validateOpencodeIntegration({ projectRoot: tmpRoot });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('missing YAML frontmatter'))).toBe(true);
  });

  it('parses quiet and json flags', () => {
    expect(parseArgs(['--quiet', '--json'])).toEqual({ quiet: true, json: true });
    expect(parseArgs(['-q'])).toEqual({ quiet: true, json: false });
    expect(parseArgs([])).toEqual({ quiet: false, json: false });
  });

  it('blocks directory options that escape project root', () => {
    const outsideDir = path.resolve(tmpRoot, '..');
    const result = validateOpencodeIntegration({
      projectRoot: tmpRoot,
      agentsDir: outsideDir,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('escapes project root'))).toBe(true);
  });

  it('uses relative paths in errors (avoids absolute path leakage)', () => {
    const result = validateOpencodeIntegration({ projectRoot: tmpRoot });
    const errorText = result.errors.join(' ');

    expect(errorText).not.toContain(tmpRoot);
    expect(errorText).toContain('.opencode');
  });

  it('validates path guard helper for inside/outside root', () => {
    expect(isPathInsideRoot(tmpRoot, path.join(tmpRoot, '.opencode', 'agents'))).toBe(true);
    expect(isPathInsideRoot(tmpRoot, path.resolve(tmpRoot, '..'))).toBe(false);
  });

  it('redacts secret-like values from messages', () => {
    const redacted = redactSecrets('token=abc123 password=demo api_key=xyz sk-ABCDEFGH1234');
    expect(redacted).not.toContain('abc123');
    expect(redacted).not.toContain('demo');
    expect(redacted).not.toContain('xyz');
    expect(redacted).not.toContain('sk-ABCDEFGH1234');
    expect(redacted).toContain('[REDACTED]');
  });
});
