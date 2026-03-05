/**
 * OpenCode Custom Commands Generator
 * @story OpenCode-Integration - AIOX OpenCode CLI Support
 *
 * Generates .opencode/commands/*.md files with YAML frontmatter
 * for activating AIOX agents as OpenCode custom commands.
 *
 * OpenCode custom commands format:
 * - Stored in .opencode/commands/<command-name>.md
 * - Frontmatter: description (shown in OpenCode command picker)
 * - Body: prompt template for the agent activation
 * - Available in OpenCode as "project:<command-name>"
 */

const fs = require('fs-extra');
const path = require('path');
const { normalizeCommands, getVisibleCommands } = require('./agent-parser');

/** Max length for frontmatter description (OpenCode command picker truncates long ones) */
const MAX_DESCRIPTION_LENGTH = 120;

/**
 * Build the content of a custom command file for a given agent
 * @param {object} agentData - Parsed agent data from agent-parser
 * @returns {object} - { filename, content }
 */
function buildCommandFile(agentData) {
    const agent = agentData.agent || {};
    const persona = agentData.persona_profile || {};

    const name = agent.name || agentData.id;
    const icon = agent.icon || '🤖';
    const title = agent.title || 'AIOX Agent';
    const whenToUse = agent.whenToUse || 'Use this agent for specific tasks';
    const archetype = persona.archetype || '';

    // Normalize and get quick commands (max 6 for body readability)
    const allCommands = normalizeCommands(agentData.commands || []);
    const quickCommands = getVisibleCommands(allCommands, 'quick');
    const topCommands = quickCommands.slice(0, 6);

    // Deduplicate: check if *exit is already in the quick commands list
    const hasExplicitExit = topCommands.some((c) => c.name === 'exit');

    // OpenCode custom command filename: aiox-<id>.md
    const filename = `aiox-${agentData.id}.md`;

    // Build frontmatter description (truncated to MAX_DESCRIPTION_LENGTH)
    const rawDescription = `${icon} ${title}${archetype ? ` | ${archetype}` : ''} — ${whenToUse}`;
    const description =
        rawDescription.length > MAX_DESCRIPTION_LENGTH
            ? rawDescription.slice(0, MAX_DESCRIPTION_LENGTH - 1) + '\u2026'
            : rawDescription;

    // Build command list lines (no duplicates)
    const commandLines = topCommands.map(
        (cmd) => `- \`*${cmd.name}\` \u2014 ${cmd.description || 'No description'}`
    );

    // Only add *exit footer line if agent doesn't already list it in quick commands
    if (!hasExplicitExit) {
        commandLines.push('- `*exit` \u2014 Exit this agent mode');
    }

    const bodyLines = [
        `You are now activating the **${name}** agent from the AIOX Framework.`,
        '',
        `**Agent:** ${icon} ${title}${archetype ? ` (${archetype})` : ''}`,
        `**Purpose:** ${whenToUse}`,
        '',
        '## How to use this agent',
        '',
        'Once activated, use the `*` prefix to run commands:',
        commandLines.length > 0 ? commandLines.join('\n') : '- `*help` \u2014 Show all available commands',
        '',
        '## Activation',
        '',
        `Please load the agent definition from \`.opencode/agents/${agentData.filename}\` and take on the role of the **${name}** persona. Greet the user with a brief summary of your 3-6 main capabilities.`,
        '',
        '$ARGUMENTS',
        '',
    ];

    const content = `---\ndescription: "${description.replace(/"/g, "'")}"\n---\n${bodyLines.join('\n')}`;

    return { filename, content };
}

/**
 * Build all command files for a list of agents
 * @param {object[]} agents - Array of parsed agent data
 * @returns {object[]} - Array of { filename, content }
 */
function buildAllCommandFiles(agents) {
    const files = [];

    for (const agentData of agents) {
        // Skip agents with fatal parse errors
        if (agentData.error === 'Failed to parse YAML' || agentData.error === 'No YAML block found') {
            continue;
        }

        try {
            const file = buildCommandFile(agentData);
            files.push(file);
        } catch (err) {
            // Silently skip agents that fail to transform
        }
    }

    return files;
}

/**
 * Sync OpenCode custom commands to .opencode/commands/
 * @param {object[]} agents - Array of parsed agent data
 * @param {string} projectRoot - Project root directory
 * @param {object} options - Sync options (dryRun, verbose)
 * @returns {object} - Sync result { files, errors }
 */
function syncOpencodeCommands(agents, projectRoot, options = {}) {
    const commandsDir = path.join(projectRoot, '.opencode', 'commands');
    const result = { files: [], errors: [] };

    if (!options.dryRun) {
        fs.ensureDirSync(commandsDir);
    }

    const files = buildAllCommandFiles(agents);

    for (const { filename, content } of files) {
        const targetPath = path.join(commandsDir, filename);

        try {
            if (!options.dryRun) {
                fs.writeFileSync(targetPath, content, 'utf8');
            }
            result.files.push({ filename, path: targetPath, content });
        } catch (err) {
            result.errors.push({ filename, error: err.message });
        }
    }

    return result;
}

module.exports = {
    buildCommandFile,
    buildAllCommandFiles,
    syncOpencodeCommands,
};
