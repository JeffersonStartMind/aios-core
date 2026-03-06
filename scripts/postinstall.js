#!/usr/bin/env node
/**
 * postinstall.js — AIOX Fork (JeffersonStartMind/aios-core)
 *
 * Runs automatically after `npm install` to sync AIOX agents
 * to all configured IDEs, including OpenCode CLI.
 *
 * Skips gracefully if:
 * - Running in CI environment (no interactive sync needed)
 * - Source agents directory does not exist yet
 * - Any sync script fails (never block install)
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const agentsDir = path.join(projectRoot, '.aiox-core', 'development', 'agents');
const syncScript = path.join(
    projectRoot,
    '.aiox-core',
    'infrastructure',
    'scripts',
    'ide-sync',
    'index.js'
);

// Skip in CI environments
const isCI =
    process.env.CI === 'true' ||
    process.env.CONTINUOUS_INTEGRATION === 'true' ||
    process.env.GITHUB_ACTIONS === 'true' ||
    process.env.TRAVIS === 'true';

if (isCI) {
    console.log('[AIOX] CI environment detected — skipping IDE sync');
    process.exit(0);
}

// Skip if source agents don't exist (incomplete install)
if (!fs.existsSync(agentsDir)) {
    console.log('[AIOX] Agents directory not found — skipping IDE sync');
    process.exit(0);
}

// Skip if sync script doesn't exist
if (!fs.existsSync(syncScript)) {
    console.log('[AIOX] Sync script not found — skipping IDE sync');
    process.exit(0);
}

console.log('[AIOX] Running IDE sync (including OpenCode CLI)...');

try {
    execSync(`node "${syncScript}" sync --quiet`, {
        cwd: projectRoot,
        stdio: 'inherit',
    });
    console.log('[AIOX] IDE sync complete. OpenCode agents available in .opencode/');
} catch (err) {
    // Never fail install because of sync errors
    console.warn('[AIOX] IDE sync encountered an issue (non-fatal):', err.message);
    console.warn('[AIOX] Run `npm run sync:ide:opencode` manually to retry.');
}
