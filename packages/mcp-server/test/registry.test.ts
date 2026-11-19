import { describe, it, expect } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../src/registry.js';

describe('SERVER_INSTRUCTIONS', () => {
  it('limits the Private Workspace encryption claim to what the CLI syncs', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/only content the `adrive` CLI syncs/);
    expect(SERVER_INSTRUCTIONS).toMatch(/`drive_write` and other MCP writes are not encrypted/);
    expect(SERVER_INSTRUCTIONS).not.toMatch(/only stores ciphertext/);
  });
});
