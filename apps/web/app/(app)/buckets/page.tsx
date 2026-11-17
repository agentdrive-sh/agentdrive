'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../../../lib/api-client';
import type {
  BucketConfig,
  BucketHealth,
  BucketProvider,
  CreateBucketConfigInput,
} from '../../../lib/api-client';
import { getClientSession } from '../../../lib/session';
import { humanTime } from '../../../lib/time';
import { Icon } from '../../../components/icon';
import { PageHead } from '../../../components/shared';

interface ProviderMeta {
  id: BucketProvider;
  label: string;
  sub: string;
  requiresCredentials: boolean;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'agentdrive-r2',
    label: 'AgentDrive R2 (default)',
    sub: 'Shared multi-tenant bucket. No credentials. Egress-free.',
    requiresCredentials: false,
  },
  {
    id: 'cf-r2-cross-account',
    label: 'Cloudflare R2 (cross-account)',
    sub: 'Your own R2 bucket. Provide S3-compat access keys + jurisdiction endpoint.',
    requiresCredentials: true,
  },
  {
    id: 's3-hmac',
    label: 'AWS S3 (HMAC)',
    sub: 'Any S3-compatible endpoint. Useful for AWS, Backblaze B2, Wasabi, MinIO.',
    requiresCredentials: true,
  },
];

const EMPTY_FORM: CreateBucketConfigInput = {
  name: '',
  provider: 'cf-r2-cross-account',
  endpoint: '',
  region: '',
  bucket: '',
  access_key_id: '',
  secret_access_key: '',
};

export default function BucketsPage() {
  const [configs, setConfigs] = useState<BucketConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CreateBucketConfigInput>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);

  const client = useMemo(() => {
    const session = getClientSession();
    return ApiClient.fromSession(session);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const page = await client.listBucketConfigs();
      setConfigs(page.items);
      setCursor(page.cursor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await client.listBucketConfigs(cursor);
      setConfigs((prev) => [...prev, ...page.items]);
      setCursor(page.cursor);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [client, cursor]);

  const provider = PROVIDERS.find((p) => p.id === form.provider)!;
  const credentialsRequired = provider.requiresCredentials;

  const canSubmit =
    form.name.trim().length > 0 &&
    (!credentialsRequired ||
      (form.endpoint &&
        form.region &&
        form.bucket &&
        form.access_key_id &&
        form.secret_access_key));

  async function submit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const payload: CreateBucketConfigInput = credentialsRequired
        ? form
        : { name: form.name.trim(), provider: form.provider };
      await client.createBucketConfig(payload);
      setForm(EMPTY_FORM);
      setFormOpen(false);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function verify(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const updated = await client.verifyBucketConfig(id);
      setConfigs((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setConfigs((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, health: 'degraded', last_error: msg } : c,
        ),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (busyId) return;
    const ok = window.confirm(
      'Delete this bucket config? Files already written to it remain accessible via their stored locator, but no new writes will route here.',
    );
    if (!ok) return;
    setBusyId(id);
    try {
      await client.deleteBucketConfig(id);
      setConfigs((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fade-in" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <PageHead
        sub="Route writes to your own R2 or S3 bucket. Egress stays $0. Files keep their content-addressed locator forever."
        actions={
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setForm(EMPTY_FORM);
              setFormError(null);
              setFormOpen((v) => !v);
            }}
          >
            <Icon name="plus" size={13} /> {formOpen ? 'Close' : 'Add bucket'}
          </button>
        }
      />

      {formOpen && (
        <div
          className="surface"
          style={{ padding: 20, marginBottom: 16 }}
        >
          <div
            className="t-xs muted wt-600"
            style={{
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 14,
            }}
          >
            New bucket config
          </div>

          <div className="col gap-3">
            <Field label="Name">
              <input
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value })
                }
                placeholder="prod-us-east"
                className="input"
              />
            </Field>

            <Field label="Provider">
              <div className="col gap-2">
                {PROVIDERS.map((p) => {
                  const active = p.id === form.provider;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          provider: p.id,
                          endpoint: p.requiresCredentials ? form.endpoint : '',
                          region: p.requiresCredentials ? form.region : '',
                          bucket: p.requiresCredentials ? form.bucket : '',
                          access_key_id: p.requiresCredentials
                            ? form.access_key_id
                            : '',
                          secret_access_key: p.requiresCredentials
                            ? form.secret_access_key
                            : '',
                        })
                      }
                      className="row gap-3"
                      style={{
                        padding: 12,
                        borderRadius: 'var(--r-md)',
                        background: active
                          ? 'var(--accent-soft)'
                          : 'var(--bg-2)',
                        border:
                          '1px solid ' +
                          (active ? 'transparent' : 'var(--border)'),
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          border:
                            '1.5px solid ' +
                            (active ? 'var(--accent)' : 'var(--border)'),
                          marginTop: 2,
                          flexShrink: 0,
                          position: 'relative',
                        }}
                      >
                        {active && (
                          <span
                            style={{
                              position: 'absolute',
                              inset: 3,
                              borderRadius: '50%',
                              background: 'var(--accent)',
                            }}
                          />
                        )}
                      </div>
                      <div className="col grow" style={{ lineHeight: 1.3 }}>
                        <span className="t-sm wt-600 fg-0">{p.label}</span>
                        <span className="t-xs muted">{p.sub}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Field>

            {credentialsRequired && (
              <div
                className="grid"
                style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}
              >
                <Field label="Endpoint" full>
                  <input
                    value={form.endpoint ?? ''}
                    onChange={(e) =>
                      setForm({ ...form, endpoint: e.target.value })
                    }
                    placeholder="https://<account>.r2.cloudflarestorage.com"
                    className="input"
                  />
                </Field>
                <Field label="Region">
                  <input
                    value={form.region ?? ''}
                    onChange={(e) =>
                      setForm({ ...form, region: e.target.value })
                    }
                    placeholder="auto / us-east-1"
                    className="input"
                  />
                </Field>
                <Field label="Bucket">
                  <input
                    value={form.bucket ?? ''}
                    onChange={(e) =>
                      setForm({ ...form, bucket: e.target.value })
                    }
                    placeholder="my-agent-artifacts"
                    className="input"
                  />
                </Field>
                <Field label="Access key ID">
                  <input
                    value={form.access_key_id ?? ''}
                    onChange={(e) =>
                      setForm({ ...form, access_key_id: e.target.value })
                    }
                    placeholder="AKIA…"
                    className="input"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Secret access key" full>
                  <input
                    type="password"
                    value={form.secret_access_key ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        secret_access_key: e.target.value,
                      })
                    }
                    placeholder="••••••••"
                    className="input"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
              </div>
            )}

            {credentialsRequired && (
              <div
                className="t-xs muted"
                style={{
                  padding: 10,
                  background: 'var(--bg-2)',
                  borderRadius: 'var(--r-md)',
                  lineHeight: 1.5,
                }}
              >
                The secret is stored encrypted at rest and is never returned
                by reads. Use{' '}
                <span className="fg-0">Verify</span> after saving to confirm
                credentials before any production write.
              </div>
            )}

            {formError && (
              <div
                className="t-xs"
                style={{
                  padding: 10,
                  background: 'var(--danger-soft, var(--bg-2))',
                  color: 'var(--danger, #f87171)',
                  borderRadius: 'var(--r-md)',
                }}
              >
                {formError}
              </div>
            )}

            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setFormOpen(false);
                  setFormError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!canSubmit || submitting}
                onClick={submit}
              >
                {submitting ? 'Saving…' : 'Save bucket'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="surface table-scroll">
        <div
          className="row-item"
          style={{
            gridTemplateColumns: '1.4fr 1fr 130px 150px 180px',
            gap: 14,
            padding: '8px 18px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
            fontSize: 10.5,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-3)',
            fontWeight: 600,
          }}
        >
          <span>Name</span>
          <span>Provider</span>
          <span>Health</span>
          <span>Verified</span>
          <span />
        </div>

        {loading ? (
          <div className="empty">
            <Icon name="archive" size={24} />
            <p>Loading buckets…</p>
          </div>
        ) : loadError ? (
          <div className="empty">
            <Icon name="x" size={24} />
            <h3>Couldn&apos;t load buckets</h3>
            <p>{loadError}</p>
            <button
              type="button"
              className="btn"
              onClick={refresh}
              style={{ marginTop: 12 }}
            >
              Retry
            </button>
          </div>
        ) : configs.length === 0 ? (
          <div className="empty">
            <Icon name="archive" size={24} />
            <h3>No custom buckets yet</h3>
            <p>
              You&apos;re writing to the shared AgentDrive R2 bucket. Add
              your own for data-residency, egress, or compliance reasons.
              Files keep their content-addressed locator after you switch.
            </p>
          </div>
        ) : (
          configs.map((c) => (
            <BucketRow
              key={c.id}
              config={c}
              busy={busyId === c.id}
              onVerify={() => verify(c.id)}
              onDelete={() => remove(c.id)}
            />
          ))
        )}

        {cursor && (
          <div
            className="row"
            style={{
              padding: '12px 18px',
              borderTop: '1px solid var(--border)',
              justifyContent: 'center',
            }}
          >
            <button type="button" className="btn ghost" onClick={loadMore}>
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}

function Field({ label, children, full }: FieldProps) {
  return (
    <label
      className="col"
      style={{ gap: 6, gridColumn: full ? '1 / -1' : undefined }}
    >
      <span
        className="t-xs muted wt-600"
        style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

interface BucketRowProps {
  config: BucketConfig;
  busy: boolean;
  onVerify: () => void;
  onDelete: () => void;
}

function BucketRow({ config, busy, onVerify, onDelete }: BucketRowProps) {
  const provider = PROVIDERS.find((p) => p.id === config.provider);
  return (
    <div
      className="row-item"
      style={{
        gridTemplateColumns: '1.4fr 1fr 130px 150px 180px',
        gap: 14,
        padding: '12px 18px',
        borderBottom: '1px solid var(--border)',
        alignItems: 'center',
      }}
    >
      <div className="col" style={{ lineHeight: 1.3 }}>
        <span className="t-sm wt-600 fg-0">{config.name}</span>
        {config.bucket && (
          <span className="t-xs muted mono">{config.bucket}</span>
        )}
      </div>

      <div className="col" style={{ lineHeight: 1.3 }}>
        <span className="t-sm fg-0">{provider?.label ?? config.provider}</span>
        {config.region && (
          <span className="t-xs muted mono">{config.region}</span>
        )}
      </div>

      <HealthPill health={config.health} error={config.last_error} />

      <span className="t-xs muted">
        {config.last_verified_at
          ? humanTime(config.last_verified_at)
          : 'never'}
      </span>

      <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn sm"
          onClick={onVerify}
          disabled={busy}
        >
          {busy ? 'Verifying…' : 'Verify'}
        </button>
        <button
          type="button"
          className="btn ghost sm"
          onClick={onDelete}
          disabled={busy}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function HealthPill({
  health,
  error,
}: {
  health: BucketHealth;
  error?: string;
}) {
  const map: Record<BucketHealth, { cls: string; label: string }> = {
    healthy: { cls: 'success', label: 'healthy' },
    degraded: { cls: 'danger', label: 'degraded' },
    unverified: { cls: 'warning', label: 'unverified' },
  };
  const m = map[health];
  return (
    <span
      className={'pill ' + m.cls}
      title={health === 'degraded' && error ? error : undefined}
    >
      <span className="dot" />
      {m.label}
    </span>
  );
}
