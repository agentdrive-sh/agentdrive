import type { Env, AuthContext } from '../env.js';
import { StorageService } from '../services/storage.js';
import { EmailService } from '../services/email.js';

// Helpers shared by the split routes/*.ts. Previously lived inline in
// index.ts; extracted as part of the Phase 0.5 route-split refactor so
// every route file pulls from one place.

export function storage(c: { env: Env }): StorageService {
  return new StorageService(c.env.KV, c.env.R2);
}

export function emailService(c: { env: Env }): EmailService {
  return new EmailService(c.env);
}

export function requireAgent(auth: AuthContext): { success: false; error: string } | null {
  if (auth.type !== 'agent') {
    return { success: false, error: 'Only agents can perform this action' };
  }
  return null;
}

// Agent keys are never owners: only a human owner's session may grant or take away ownership.
export async function callerIsOwner(s: StorageService, auth: AuthContext, orgId: string): Promise<boolean> {
  return auth.type === 'session' && (await s.getOrgMember(orgId, auth.email.toLowerCase()))?.role === 'owner';
}

// Org storage settings belong to human owners/admins and their delegated keys.
// A self-registered org's founding agent is its bootstrap administrator.
export async function canManageOrg(s: StorageService, auth: AuthContext, orgId: string): Promise<boolean> {
  if (auth.type === 'share' || auth.org_id !== orgId) return false;
  // CLI/OAuth and /keys write a raw creator email; older metadata may prefix it.
  // Re-read current membership so a role downgrade cannot retain admin powers.
  const creator = auth.type === 'session' ? auth.email : auth.created_by;
  const email = creator?.startsWith('member:') ? creator.slice('member:'.length) : creator;
  if (email) {
    const member = await s.getOrgMember(orgId, email.toLowerCase());
    return member?.role === 'owner' || member?.role === 'admin';
  }
  return auth.type === 'agent' && (await s.getOrg(orgId))?.created_by === auth.agent_id;
}
