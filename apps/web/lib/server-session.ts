import { cache } from 'react';
import { redirect } from 'next/navigation';
import { ApiError } from './api-client';
import { getServerSession } from './session';
import { serverApiClient } from './server-api';

export const requireServerSession = cache(async () => {
  const session = await getServerSession();
  if (!session) redirect('/login');
  let expired = false;
  let membershipChanged = false;
  try {
    const identity = await serverApiClient(session).whoami() as { org_id?: string } | null;
    membershipChanged = !identity || typeof identity.org_id !== 'string' || !identity.org_id;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) expired = true;
    else throw error;
  }
  // Cookie mutation belongs in a Route Handler, not a Server Component.
  if (expired) redirect('/session/expired');
  if (membershipChanged) redirect('/session/expired?reason=membership');
  return session;
});
