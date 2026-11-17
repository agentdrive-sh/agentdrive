'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getClientSession, navigateNext } from '@/lib/session';
import { AuthCard } from '@/components/auth/auth-card';

// The worker's OAuth callback sets the session cookie before sending the browser here.
// Never take a session from this page's URL: any site can link to it with its own.
export default function AuthCallbackPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!getClientSession()?.api_key) {
      setFailed(true);
      return;
    }

    navigateNext(router);
  }, [router]);

  if (!failed) {
    return (
      <AuthCard
        title="Signing you in"
        body={<p className="muted t-sm">One second...</p>}
      />
    );
  }
  return (
    <AuthCard
      title="Sign-in didn't complete"
      body={
        <>
          <p className="muted t-sm">This browser isn't signed in. Please try again.</p>
          <button
            type="button"
            className="btn"
            onClick={() => router.replace('/login')}
          >
            Back to sign in
          </button>
        </>
      }
    />
  );
}
