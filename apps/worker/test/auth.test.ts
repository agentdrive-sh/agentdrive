import { describe, it, expect } from 'vitest';
import { hashApiKey, hasPermission, normalizeApiKey } from '@agentdrive/shared';
import type { Permission } from '@agentdrive/shared';

describe('hashApiKey', () => {
  it('is deterministic for the same input', async () => {
    const a = await hashApiKey('agentdrive_live_abc123');
    const b = await hashApiKey('agentdrive_live_abc123');
    expect(a).toBe(b);
  });

  it('produces a 64-character lowercase hex string (SHA-256)', async () => {
    const hash = await hashApiKey('agentdrive_live_xyz');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different inputs', async () => {
    const a = await hashApiKey('agentdrive_live_aaa');
    const b = await hashApiKey('agentdrive_live_bbb');
    expect(a).not.toBe(b);
  });

  it('normalizes whitespace before hashing (trim)', async () => {
    const a = await hashApiKey('agentdrive_live_abc');
    const b = await hashApiKey('  agentdrive_live_abc  ');
    expect(a).toBe(b);
  });

  it('normalizeApiKey trims surrounding whitespace', () => {
    expect(normalizeApiKey('  key  ')).toBe('key');
  });
});

describe('hasPermission ladder', () => {
  const all: Permission[] = ['view', 'comment', 'edit', 'owner'];

  it('owner satisfies all permission requirements', () => {
    for (const required of all) {
      expect(hasPermission('owner', required)).toBe(true);
    }
  });

  it('edit satisfies view/comment/edit but not owner', () => {
    expect(hasPermission('edit', 'view')).toBe(true);
    expect(hasPermission('edit', 'comment')).toBe(true);
    expect(hasPermission('edit', 'edit')).toBe(true);
    expect(hasPermission('edit', 'owner')).toBe(false);
  });

  it('comment satisfies view/comment but not edit/owner', () => {
    expect(hasPermission('comment', 'view')).toBe(true);
    expect(hasPermission('comment', 'comment')).toBe(true);
    expect(hasPermission('comment', 'edit')).toBe(false);
    expect(hasPermission('comment', 'owner')).toBe(false);
  });

  it('view satisfies only view', () => {
    expect(hasPermission('view', 'view')).toBe(true);
    expect(hasPermission('view', 'comment')).toBe(false);
    expect(hasPermission('view', 'edit')).toBe(false);
    expect(hasPermission('view', 'owner')).toBe(false);
  });

  it('returns false for unknown permission strings', () => {
    expect(hasPermission('garbage' as Permission, 'view')).toBe(false);
    expect(hasPermission('view', 'garbage' as Permission)).toBe(false);
  });
});
