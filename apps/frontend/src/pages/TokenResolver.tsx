import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToken } from '../contexts/TokenContext';
import { useApiClient } from '../hooks/useApiClient';

interface TokenInfo {
  workspace_id: string;
  file_id?: string;
  permission: string;
  email_gated: boolean;
  email_hint?: string;
}

function decodeTokenPayload(token: string): {
  wid: string;
  fid?: string;
  permission: string;
  email?: string;
} | null {
  try {
    const [payloadB64] = token.split('.');
    let str = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const json = atob(str);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default function TokenResolver() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { setToken, setSession, sessionId, email: existingEmail } = useToken();
  const { publicFetch } = useApiClient();
  const [error, setError] = useState<string | null>(null);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [step, setStep] = useState<'loading' | 'email-gate' | 'code-entry' | 'redirecting'>('loading');
  const [emailInput, setEmailInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setError('No token provided');
      return;
    }

    const payload = decodeTokenPayload(token);
    if (!payload?.wid) {
      setError('Invalid share link');
      return;
    }

    // If email-gated, check if user already has a matching session
    if (payload.email) {
      if (existingEmail && existingEmail === payload.email && sessionId) {
        // Already verified - redirect directly
        setToken(token, payload.wid, payload.fid, payload.permission);
        redirectToContent(payload.wid, payload.fid);
        return;
      }

      // Need email verification
      setTokenInfo({
        workspace_id: payload.wid,
        file_id: payload.fid,
        permission: payload.permission,
        email_gated: true,
        email_hint: maskEmail(payload.email),
      });
      setStep('email-gate');
      return;
    }

    // Public link - redirect immediately
    setToken(token, payload.wid, payload.fid, payload.permission);
    redirectToContent(payload.wid, payload.fid);
  }, [token]);

  function redirectToContent(wid: string, fid?: string) {
    setStep('redirecting');
    if (fid) {
      navigate(`/w/${wid}/f/${fid}`, { replace: true });
    } else {
      navigate(`/w/${wid}`, { replace: true });
    }
  }

  async function handleSendCode() {
    if (!emailInput.trim() || !tokenInfo) return;
    setSending(true);
    setStatusMessage('');

    try {
      await publicFetch('/auth/send-code', {
        method: 'POST',
        body: JSON.stringify({
          email: emailInput,
          purpose: 'verify',
          workspace_id: tokenInfo.workspace_id,
        }),
      });
      setStep('code-entry');
      setStatusMessage('Code sent! Check your email.');
    } catch (err: unknown) {
      setStatusMessage((err as Error).message || 'Failed to send code');
    } finally {
      setSending(false);
    }
  }

  async function handleVerifyCode() {
    if (!codeInput.trim() || !tokenInfo || !token) return;
    setVerifying(true);
    setStatusMessage('');

    try {
      const result = await publicFetch<{
        session_id: string;
        email: string;
        org_id?: string;
      }>('/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: emailInput, code: codeInput }),
      });

      // Store session
      setSession(result.session_id, result.email);

      // Set share token and redirect
      setToken(token, tokenInfo.workspace_id, tokenInfo.file_id, tokenInfo.permission);
      redirectToContent(tokenInfo.workspace_id, tokenInfo.file_id);
    } catch (err: unknown) {
      setStatusMessage((err as Error).message || 'Invalid code');
    } finally {
      setVerifying(false);
    }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 max-w-md">
          <h1 className="text-xl font-semibold text-white mb-2">Invalid Link</h1>
          <p className="text-zinc-400">{error}</p>
        </div>
      </div>
    );
  }

  if (step === 'email-gate' || step === 'code-entry') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 max-w-md w-full mx-4">
          <h1 className="text-xl font-semibold text-white mb-2">Verify Your Email</h1>
          <p className="text-zinc-400 text-sm mb-1">
            This link is restricted to a specific email address.
          </p>
          {tokenInfo?.email_hint && (
            <p className="text-zinc-500 text-xs mb-6">
              Hint: {tokenInfo.email_hint}
            </p>
          )}

          {step === 'email-gate' && (
            <div className="space-y-3">
              <input
                type="email"
                placeholder="Enter your email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                autoFocus
              />
              <button
                onClick={handleSendCode}
                disabled={!emailInput.trim() || sending}
                className="w-full px-4 py-2.5 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50 transition-colors"
              >
                {sending ? 'Sending...' : 'Send Verification Code'}
              </button>
            </div>
          )}

          {step === 'code-entry' && (
            <div className="space-y-3">
              <p className="text-zinc-300 text-sm">
                Enter the 6-digit code sent to <span className="font-medium text-white">{emailInput}</span>
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="000000"
                maxLength={6}
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white text-center text-2xl tracking-[0.5em] placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
                autoFocus
              />
              <button
                onClick={handleVerifyCode}
                disabled={codeInput.length !== 6 || verifying}
                className="w-full px-4 py-2.5 bg-white text-black font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50 transition-colors"
              >
                {verifying ? 'Verifying...' : 'Verify'}
              </button>
              <button
                onClick={() => { setStep('email-gate'); setCodeInput(''); setStatusMessage(''); }}
                className="w-full text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Use a different email
              </button>
            </div>
          )}

          {statusMessage && (
            <p className={`text-sm mt-3 ${statusMessage.includes('sent') ? 'text-emerald-400' : 'text-red-400'}`}>
              {statusMessage}
            </p>
          )}

          <div className="mt-6 pt-4 border-t border-zinc-800 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${tokenInfo?.permission === 'edit' ? 'bg-emerald-500' : tokenInfo?.permission === 'comment' ? 'bg-blue-500' : 'bg-zinc-500'}`} />
            <span className="text-xs text-zinc-500">
              {tokenInfo?.permission} access
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-zinc-400">Loading...</div>
    </div>
  );
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}*@${domain}`;
  return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}@${domain}`;
}
