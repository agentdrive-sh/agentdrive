'use client';

import { useId, useState } from 'react';
import { ApiClient, ApiError } from '@/lib/api-client';

interface EmailMagicLinkProps {
  onVerified: (result: {
    session_id: string;
    email: string;
    org_id?: string;
  }) => void | Promise<void>;
  disabled?: boolean;
}

type Step = 'email' | 'code';

export function EmailMagicLink({ onVerified, disabled }: EmailMagicLinkProps) {
  const emailId = useId();
  const codeId = useId();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const client = new ApiClient();

  async function handleSendCode() {
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      await client.sendMagicCode(email.trim(), 'login');
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send code');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (code.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const result = await client.verifyMagicCode(email.trim(), code);
      await onVerified({
        session_id: result.session_id,
        email: result.email,
        org_id: result.org_id,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'email') {
    return (
      <div className="col gap-3">
        <div className="col gap-1">
          <label
            htmlFor={emailId}
            className="t-xs muted wt-600"
            style={{ letterSpacing: '0.04em' }}
          >
            Email
          </label>
          <input
            id={emailId}
            type="email"
            value={email}
            disabled={disabled || loading}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSendCode();
            }}
            placeholder="you@company.com"
            className="auth-input"
            autoComplete="email"
          />
        </div>
        <button
          type="button"
          onClick={() => void handleSendCode()}
          disabled={disabled || !email.trim() || loading}
          className="btn primary"
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {loading ? 'Sending...' : 'Continue with email'}
        </button>
        {error && (
          <p role="alert" className="t-sm" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        <style>{authInputCSS}</style>
      </div>
    );
  }

  return (
    <div className="col gap-3">
      <div className="col gap-1">
        <label
          htmlFor={codeId}
          className="t-xs muted wt-600"
          style={{ letterSpacing: '0.04em' }}
        >
          Code sent to <span style={{ color: 'var(--text-0)' }}>{email}</span>
        </label>
        <input
          id={codeId}
          autoComplete="one-time-code"
          type="text"
          inputMode="numeric"
          value={code}
          disabled={loading}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleVerify();
          }}
          placeholder="000000"
          maxLength={6}
          className="auth-input mono"
          style={{
            textAlign: 'center',
            letterSpacing: '0.4em',
            fontSize: 20,
          }}
          autoFocus
        />
      </div>
      <button
        type="button"
        onClick={() => void handleVerify()}
        disabled={code.length !== 6 || loading}
        className="btn primary"
        style={{ width: '100%', justifyContent: 'center' }}
      >
        {loading ? 'Verifying...' : 'Verify & sign in'}
      </button>
      <button
        type="button"
        onClick={() => {
          setStep('email');
          setCode('');
          setError('');
        }}
        className="btn ghost"
        style={{ width: '100%', justifyContent: 'center' }}
      >
        Use a different email
      </button>
      {error && (
        <p role="alert" className="t-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      <style>{authInputCSS}</style>
    </div>
  );
}

export const authInputCSS = `
.auth-input {
  width: 100%;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  color: var(--text-0);
  padding: 10px 12px;
  font-size: var(--t-base);
  font-family: var(--font-sans);
  outline: none;
  transition: border-color 120ms, background 120ms;
}
.auth-input:focus {
  border-color: var(--accent);
  background: var(--bg-1);
}
.auth-input:disabled { opacity: 0.5; cursor: not-allowed; }
`;
