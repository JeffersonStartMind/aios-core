/**
 * Unit tests for OpenCode transformer and commands generator
 * @story OpenCode-Integration - AIOX OpenCode CLI Support
 */

const opencode = require('../../.aiox-core/infrastructure/scripts/ide-sync/transformers/opencode');
const {
    buildCommandFile,
    buildAllCommandFiles,
} = require('../../.aiox-core/infrastructure/scripts/ide-sync/opencode-commands');

// Shared sample agent data (same shape as other transformer tests)
const sampleAgent = {
    path: '/path/to/dev.md',
    filename: 'dev.md',
    id: 'dev',
    raw: '# dev\n\n```yaml\nagent:\n  name: Dex\n  id: dev\n```\n\nContent',
    yaml: {
        agent: {
            name: 'Dex',
            id: 'dev',
            title: 'Full Stack Developer',
            icon: '💻',
            whenToUse: 'Use for code implementation',
        },
        persona_profile: { archetype: 'Builder' },
        commands: [
            { name: 'help', visibility: ['full', 'quick', 'key'], description: 'Show help' },
            { name: 'develop', visibility: ['full', 'quick'], description: 'Develop story' },
            { name: 'debug', visibility: ['full'], description: 'Debug mode' },
            { name: 'exit', visibility: ['full', 'quick', 'key'], description: 'Exit agent' },
        ],
        dependencies: { tasks: ['task1.md'], tools: ['git'] },
    },
    agent: {
        name: 'Dex',
        id: 'dev',
        title: 'Full Stack Developer',
        icon: '💻',
        whenToUse: 'Use for code implementation',
    },
    persona_profile: { archetype: 'Builder' },
    commands: [
        { name: 'help', visibility: ['full', 'quick', 'key'], description: 'Show help' },
        { name: 'develop', visibility: ['full', 'quick'], description: 'Develop story' },
        { name: 'debug', visibility: ['full'], description: 'Debug mode' },
        { name: 'exit', visibility: ['full', 'quick', 'key'], description: 'Exit agent' },
    ],
    sections: {
        quickCommands: '- `*help` - Show help',
        collaboration: 'Works with @qa and @sm',
        guide: null,
    },
    error: null,
};

const minimalAgent = {
    filename: 'minimal.md',
    id: 'minimal',
    agent: null,
    persona_profile: null,
    commands: [],
    sections: {},
    error: null,
};

// ──────────────────────────────────────────────────────────────────────────────
// OpenCode Transformer Tests
// ──────────────────────────────────────────────────────────────────────────────
describe('opencode transformer', () => {
    it('should use correct format identifier', () => {
        expect(opencode.format).toBe('opencode-rules');
    });

    it('should return correct filename', () => {
        expect(opencode.getFilename(sampleAgent)).toBe('dev.md');
    });

    it('should generate agent heading with alias', () => {
        const result = opencode.transform(sampleAgent);
        expect(result).toContain('# Dex (@dev)');
    });

    it('should include icon and title', () => {
        const result = opencode.transform(sampleAgent);
        expect(result).toContain('💻 **Full Stack Developer**');
    });

    it('should include archetype when present', () => {
        const result = opencode.transform(sampleAgent);
        expect(result).toContain('Builder');
    });

    it('should include whenToUse', () => {
        const result = opencode.transform(sampleAgent);
        expect(result).toContain('Use for code implementation');
    });

    it('should include Quick Commands section', () => {
        const result = opencode.transform(sampleAgent);
        expect(result).toContain('## Quick Commands');
        expect(result).toContain('`*help`');
        expect(result).toContain('`*develop`');
    });

    it('should include All Commands when there are full-only commands', () => {
        const result = opencode.transform(sampleAgent);
        expect(result).toContain('## All Commands');
        expect(result).toContain('`*debug`');
    });

    it('should include collaboration section when present', () => {
        const result = opencode.transform(sampleAgent);
        expect(result).toContain('## Collaboration');
        expect(result).toContain('@qa');
    });

    it('should include sync footer', () => {
        const result = opencode.transform(sampleAgent);
        expect(result).toContain('Synced from .aiox-core/development/agents/dev.md');
    });

    it('should handle minimal agent without throwing', () => {
        expect(() => opencode.transform(minimalAgent)).not.toThrow();
        const result = opencode.transform(minimalAgent);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('should use fallback icon when missing', () => {
        const noIcon = { ...sampleAgent, agent: { ...sampleAgent.agent, icon: undefined } };
        const result = opencode.transform(noIcon);
        expect(result).toContain('🤖');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// OpenCode Commands Generator Tests
// ──────────────────────────────────────────────────────────────────────────────
describe('opencode-commands generator', () => {
    it('should generate filename with aiox- prefix', () => {
        const { filename } = buildCommandFile(sampleAgent);
        expect(filename).toBe('aiox-dev.md');
    });

    it('should start with YAML frontmatter', () => {
        const { content } = buildCommandFile(sampleAgent);
        expect(content.startsWith('---')).toBe(true);
    });

    it('should include description in frontmatter', () => {
        const { content } = buildCommandFile(sampleAgent);
        expect(content).toContain('description:');
        expect(content).toContain('Full Stack Developer');
    });

    it('should include $ARGUMENTS placeholder', () => {
        const { content } = buildCommandFile(sampleAgent);
        expect(content).toContain('$ARGUMENTS');
    });

    it('should reference the agent file path', () => {
        const { content } = buildCommandFile(sampleAgent);
        expect(content).toContain('.opencode/agents/dev.md');
    });

    it('should include quick commands in body (max 6)', () => {
        const { content } = buildCommandFile(sampleAgent);
        expect(content).toContain('`*help`');
        expect(content).toContain('`*develop`');
    });

    it('should include activation instruction', () => {
        const { content } = buildCommandFile(sampleAgent);
        expect(content).toContain('Dex');
        expect(content).toContain('persona');
    });

    it('should build all command files, skipping fatal errors', () => {
        const agents = [
            sampleAgent,
            { ...minimalAgent, error: 'No YAML block found' }, // should be skipped
            { ...minimalAgent, id: 'qa', filename: 'qa.md', agent: { name: 'Quinn', id: 'qa', title: 'QA' } },
        ];
        const files = buildAllCommandFiles(agents);
        expect(files.length).toBe(2); // sampleAgent + qa, not the error one
        expect(files.map((f) => f.filename)).toContain('aiox-dev.md');
        expect(files.map((f) => f.filename)).not.toContain('aiox-minimal.md');
    });

    it('should not throw for minimal agent without commands', () => {
        expect(() => buildCommandFile(minimalAgent)).not.toThrow();
        const { filename, content } = buildCommandFile(minimalAgent);
        expect(filename).toBe('aiox-minimal.md');
        expect(content).toContain('---');
    });
});
