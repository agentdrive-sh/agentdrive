import { StatusPill } from '../shared';

export interface Member {
  id: string;
  name?: string;
  email: string;
  role: string;
  avatar?: string;
  agentCount?: number;
  joinedAt?: string | null;
  pending?: boolean;
}

interface Props {
  member: Member;
}

function initialsFor(m: Member): string {
  if (m.avatar) return m.avatar.toUpperCase();
  const base = m.name ?? m.email;
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2)
    return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export function MemberRow({ member }: Props) {
  const joined = member.joinedAt
    ? 'joined ' + new Date(member.joinedAt).toISOString().split('T')[0]
    : 'pending';
  return (
    <div
      className="row-item"
      style={{
        gridTemplateColumns: '36px 1.4fr 1fr 100px 120px 90px',
        gap: 14,
        padding: '14px 18px',
      }}
    >
      <div className="avatar lg">{initialsFor(member)}</div>
      <div className="col" style={{ lineHeight: 1.25 }}>
        <span className="t-sm fg-0 wt-500">
          {member.name ?? member.email}
        </span>
        <span className="t-xs faint mono">{member.email}</span>
      </div>
      <span className="mono t-sm muted">
        {member.agentCount ?? 0} agents
      </span>
      <span className="pill">{member.role}</span>
      <span className="t-xs muted mono">{joined}</span>
      {member.pending ? <StatusPill status="pending" /> : <span />}
    </div>
  );
}
