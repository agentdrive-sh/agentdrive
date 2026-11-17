import { afterEach, describe, expect, it, vi } from 'vitest';

const calls: string[][] = [];
let marketplaces: string | null = '[]';
vi.mock('node:child_process', () => ({
  spawnSync: (_cmd: string, args: string[]) => {
    calls.push(args);
    return args.includes('list') ? { stdout: marketplaces, status: 0 } : { status: 0 };
  },
}));

const { installClaudePlugin, CLAUDE_MARKETPLACE } = await import('../src/lib/harness-wiring.js');

describe('installClaudePlugin', () => {
  afterEach(() => {
    calls.length = 0;
  });

  it('adds the marketplace when Claude Code does not have it', () => {
    marketplaces = JSON.stringify([{ name: 'cloudflare', repo: 'cloudflare/skills' }]);
    expect(installClaudePlugin('ignore')).toEqual({ status: 'installed' });
    expect(calls.slice(1).map((a) => a.slice(0, 3).join(' '))).toEqual(['plugin marketplace add', 'plugin install agentdrive@agentdrive']);
    expect(calls[1]).toContain(CLAUDE_MARKETPLACE);
  });

  it('keeps an agentdrive marketplace added from the old repo path instead of re-adding it', () => {
    marketplaces = JSON.stringify([{ name: 'agentdrive', repo: 'Rakesh1002/agentdrive-mcp' }]);
    expect(installClaudePlugin('ignore')).toEqual({ status: 'installed' });
    expect(calls.slice(1).map((a) => a.slice(0, 2).join(' '))).toEqual(['plugin install']);
  });

  it('falls back to adding when the list is unreadable', () => {
    marketplaces = null;
    installClaudePlugin('ignore');
    expect(calls[1]?.slice(0, 3)).toEqual(['plugin', 'marketplace', 'add']);
  });
});
