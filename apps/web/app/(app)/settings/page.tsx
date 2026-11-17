import { serverApiClient } from '../../../lib/server-api';
import type { WorkspaceSummary, OrgDetail } from '../../../lib/api-client';
import { requireServerSession } from '../../../lib/server-session';
import { Icon } from '../../../components/icon';
import { SignOutButton } from '../../../components/shared';
import { OrgProfileForm } from './org-profile-form';

export default async function SettingsPage() {
  const session = await requireServerSession();
  const client = serverApiClient(session);

  let workspaces: WorkspaceSummary[] = [];
  let org: OrgDetail | null = null;
  if (session?.api_key) {
    [workspaces, org] = await Promise.all([client.listWorkspaces(), client.getOrg()]);
  }

  const email = session?.email;
  const privacyMail = (subject: string) =>
    `mailto:privacy@agentdrive.sh?subject=${encodeURIComponent(email ? `${subject} for ${email}` : subject)}`;

  return (
    <div className="fade-in" style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="col gap-4">
        <Section title="Profile">
          <Row label="Email">
            <span className="mono">{email ?? 'unknown'}</span>
          </Row>
          <Row label="Organization name">
            <OrgProfileForm initialName={org?.name ?? ''} />
          </Row>
          <Row label="Sign out">
            <SignOutButton />
          </Row>
        </Section>

        <Section title="Workspaces">
          {workspaces.length === 0 ? (
            <div className="t-sm faint">
              No workspaces yet — your first one is created on signup.
            </div>
          ) : (
            workspaces.map((w) => (
              <div
                key={w.id}
                className="row gap-3"
                style={{
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border)',
                  alignItems: 'center',
                }}
              >
                <div className="col grow" style={{ lineHeight: 1.25 }}>
                  <span className="t-sm fg-0 wt-500 mono">{w.name}</span>
                  <span className="t-xs faint mono">{w.id}</span>
                </div>
              </div>
            ))
          )}
        </Section>

        <Section title="Defaults">
          <Row label="Embedding model">
            <span className="mono">@cf/baai/bge-base-en-v1.5</span>{' '}
            <span className="muted">(768 dimensions)</span>
          </Row>
        </Section>

        <Section title="Danger zone">
          <div
            className="row gap-3"
            style={{
              padding: 16,
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border)',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div className="t-sm fg-0 wt-500">Export all data</div>
              <div className="t-xs muted">
                Email us and we send you a copy of every artifact, run, and
                comment.
              </div>
            </div>
            <a className="btn" href={privacyMail('Data export request')}>
              <Icon name="download" size={13} /> Request export
            </a>
          </div>
          <div
            className="row gap-3"
            style={{
              padding: 16,
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border)',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div className="t-sm fg-0 wt-500">Delete account</div>
              <div className="t-xs muted">
                By email request. Removes all artifacts, embeddings, and run
                logs across every workspace. Cannot be undone.
              </div>
            </div>
            <a
              className="btn"
              href={privacyMail('Account deletion request')}
              style={{ color: 'var(--danger)' }}
            >
              Request deletion
            </a>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="surface" style={{ padding: 20 }}>
      <div className="t-md wt-600 fg-0" style={{ marginBottom: 14 }}>
        {title}
      </div>
      <div className="col gap-2">{children}</div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="row gap-4"
      style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}
    >
      <span className="t-sm muted" style={{ minWidth: 160 }}>
        {label}
      </span>
      <span className="t-sm grow">{children}</span>
    </div>
  );
}
