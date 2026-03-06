#!/usr/bin/env node
'use strict';

/**
 * validate-opencode-integration.js
 * @story OpenCode-Integration - AIOX OpenCode CLI Support
 *
 * Validates that the OpenCode CLI integration is properly set up:
 * - .opencode/agents/*.md files exist and are synced from source
 * - .opencode/commands/aiox-*.md custom command files exist
 * - Counts match source agents
 */

const fs = require('fs');
const path = require('path');

const SECRET_PATTERNS = [
  /(api[_-]?key\s*[:=]\s*)([^\s]+)/gi,
  /(token\s*[:=]\s*)([^\s]+)/gi,
  /(secret\s*[:=]\s*)([^\s]+)/gi,
  /(password\s*[:=]\s*)([^\s]+)/gi,
  /(sk-[A-Za-z0-9_-]{8,})/g,
];

function redactSecrets(input) {
  if (typeof input !== 'string') return input;
  let output = input;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (...args) => {
      const prefix = typeof args[1] === 'string' && /[:=]\s*$/i.test(args[1]) ? args[1] : '';
      return `${prefix}[REDACTED]`;
    });
  }
  return output;
}

function getDefaultOptions() {
  const projectRoot = process.cwd();
  return {
    projectRoot,
    agentsDir: path.join(projectRoot, '.opencode', 'agents'),
    commandsDir: path.join(projectRoot, '.opencode', 'commands'),
    sourceAgentsDir: path.join(projectRoot, '.aiox-core', 'development', 'agents'),
    quiet: false,
    json: false,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  return {
    quiet: args.has('--quiet') || args.has('-q'),
    json: args.has('--json'),
  };
}

function countMarkdownFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  return fs.readdirSync(dirPath).filter((f) => f.endsWith('.md')).length;
}

function countCommandFiles(commandsDir) {
  if (!fs.existsSync(commandsDir)) return 0;
  return fs.readdirSync(commandsDir).filter((f) => f.startsWith('aiox-') && f.endsWith('.md'))
    .length;
}

function isPathInsideRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function validateOpencodeIntegration(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const resolved = {
    ...getDefaultOptions(),
    ...options,
    projectRoot,
    agentsDir: options.agentsDir || path.join(projectRoot, '.opencode', 'agents'),
    commandsDir: options.commandsDir || path.join(projectRoot, '.opencode', 'commands'),
    sourceAgentsDir:
      options.sourceAgentsDir || path.join(projectRoot, '.aiox-core', 'development', 'agents'),
  };
  const errors = [];
  const warnings = [];

  // Security: workspace isolation (prevent path escape)
  const guardedDirs = [
    { key: 'agentsDir', value: resolved.agentsDir },
    { key: 'commandsDir', value: resolved.commandsDir },
    { key: 'sourceAgentsDir', value: resolved.sourceAgentsDir },
  ];
  for (const dir of guardedDirs) {
    if (!isPathInsideRoot(resolved.projectRoot, dir.value)) {
      errors.push(
        redactSecrets(
          `Path for '${dir.key}' escapes project root and is not allowed: ${path.relative(resolved.projectRoot, dir.value)}`
        )
      );
    }
  }

  // Check .opencode/agents/ directory
  if (!fs.existsSync(resolved.agentsDir)) {
    errors.push(
      redactSecrets(
        `Missing OpenCode agents dir: ${path.relative(resolved.projectRoot, resolved.agentsDir)} — run 'npm run sync:ide:opencode'`
      )
    );
  }

  // Check .opencode/commands/ directory
  if (!fs.existsSync(resolved.commandsDir)) {
    errors.push(
      redactSecrets(
        `Missing OpenCode commands dir: ${path.relative(resolved.projectRoot, resolved.commandsDir)} — run 'npm run sync:ide:opencode'`
      )
    );
  }

  const sourceCount = countMarkdownFiles(resolved.sourceAgentsDir);
  const agentsCount = countMarkdownFiles(resolved.agentsDir);
  const commandsCount = countCommandFiles(resolved.commandsDir);

  // Agent count parity
  if (sourceCount > 0 && agentsCount !== sourceCount) {
    warnings.push(
      redactSecrets(
        `OpenCode agent count differs from source (${agentsCount}/${sourceCount}) — run 'npm run sync:ide:opencode'`
      )
    );
  }

  // Command count parity (should equal source agents)
  if (sourceCount > 0 && commandsCount !== sourceCount) {
    warnings.push(
      redactSecrets(
        `OpenCode command count differs from source (${commandsCount}/${sourceCount}) — run 'npm run sync:ide:opencode'`
      )
    );
  }

  // Verify at least one command has frontmatter
  if (fs.existsSync(resolved.commandsDir)) {
    const files = fs
      .readdirSync(resolved.commandsDir)
      .filter((f) => f.startsWith('aiox-') && f.endsWith('.md'));

    if (files.length > 0) {
      const sampleFile = path.join(resolved.commandsDir, files[0]);
      const content = fs.readFileSync(sampleFile, 'utf8');
      if (!content.startsWith('---')) {
        errors.push(
          redactSecrets(`OpenCode command file '${files[0]}' is missing YAML frontmatter`)
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      sourceAgents: sourceCount,
      opencodeAgents: agentsCount,
      opencodeCommands: commandsCount,
    },
  };
}

function formatHumanReport(result) {
  if (result.ok) {
    const lines = [
      `✅ OpenCode integration validation passed (agents: ${result.metrics.opencodeAgents}, commands: ${result.metrics.opencodeCommands})`,
    ];
    if (result.warnings.length > 0) {
      lines.push(...result.warnings.map((w) => `⚠️  ${w}`));
    }
    return lines.join('\n');
  }
  const lines = [
    `❌ OpenCode integration validation failed (${result.errors.length} issue(s))`,
    ...result.errors.map((e) => `  - ${e}`),
  ];
  if (result.warnings.length > 0) {
    lines.push(...result.warnings.map((w) => `⚠️  ${w}`));
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs();
  const result = validateOpencodeIntegration(args);

  if (!args.quiet) {
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatHumanReport(result));
    }
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  validateOpencodeIntegration,
  parseArgs,
  getDefaultOptions,
  countMarkdownFiles,
  countCommandFiles,
  isPathInsideRoot,
  redactSecrets,
};
