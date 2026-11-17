'use client';

import { useEffect, useState } from 'react';
import { ApiClient } from '@/lib/api-client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { AuthOptions } from '@/components/auth/auth-options';
import {
  getClientSession,
  clearClientSession,
  navigateNext,
  rememberNextPath,
  setClientSession,
} from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    rememberNextPath(query.get('next'));
    if (query.get('reason') === 'membership') setSessionError('Your team membership changed. Please sign in again to recover access to your account.');
    const existing = getClientSession();
    if (existing?.api_key) {
      ApiClient.fromSession(existing).whoami().then(
        () => navigateNext(router),
        () => { clearClientSession(); setSessionError('Your previous session could not be verified. Please sign in again.'); },
      );
    }
  }, [router]);

  return (
    <AuthCard
      title="Sign in to AgentDrive"
      subtitle="Access your workspace and manage your account."
      body={
        <>
        {sessionError && <p role="alert" className="t-sm">{sessionError}</p>}
        <AuthOptions
          onEmailVerified={({ session_id, email, org_id }) => {
            setClientSession({ api_key: session_id, email, org_id });
            navigateNext(router);
          }}
        />
        </>
      }
      footer={
        <>
          New to AgentDrive? <Link className="m-link" href="/docs/quick-start">Install AgentDrive for free</Link> to create your account and connect your coding agents.
        </>
      }
    />
  );
}
