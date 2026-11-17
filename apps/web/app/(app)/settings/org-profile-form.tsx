'use client';

import { useMemo, useState } from 'react';
import { ApiClient } from '../../../lib/api-client';
import { getClientSession } from '../../../lib/session';

export function OrgProfileForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(() => ApiClient.fromSession(getClientSession()), []);
  const dirty = name.trim() !== initialName && name.trim().length > 0;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setStatus('idle');
    setError(null);
    try {
      await client.updateOrg(name.trim());
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        className="input"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setStatus('idle');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
        }}
        style={{ width: 260, maxWidth: '100%' }}
      />
      <button
        type="button"
        className="btn"
        disabled={!dirty || saving}
        onClick={save}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {status === 'saved' && (
        <span className="t-xs" style={{ color: 'var(--success, #4ade80)' }}>
          Saved
        </span>
      )}
      {status === 'error' && (
        <span className="t-xs" style={{ color: 'var(--danger, #f87171)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
