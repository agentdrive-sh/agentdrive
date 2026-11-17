// Session helpers. The session "is" the API key for an authenticated principal,
// scoped to the agent platform of `web`. Stored in a cookie so the server can
// read it for auth gating; ZETA will wire the OAuth + magic-link flows that
// actually populate this cookie.

const COOKIE_NAME = 'adrive_session';
const COOKIE_MAX_AGE_DAYS = 30;

export interface WebSession {
  api_key: string;
  agent_id?: string;
  org_id?: string;
  email?: string;
}

function parseSession(raw: string): WebSession | null {
  try {
    const value = JSON.parse(decodeURIComponent(raw));
    if (!value || typeof value.api_key !== 'string' || !value.api_key.trim()) return null;
    for (const field of ['agent_id', 'org_id', 'email']) {
      if (value[field] !== undefined && typeof value[field] !== 'string') return null;
    }
    return value as WebSession;
  } catch {
    return null;
  }
}

// --- Server-side (Next.js Route Handlers + Server Components) ---

export async function getServerSession(): Promise<WebSession | null> {
  // Lazy import — keeps client bundles clean.
  const { cookies } = await import('next/headers');
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return parseSession(raw);
}

export async function setServerSession(session: WebSession): Promise<void> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  store.set(COOKIE_NAME, encodeURIComponent(JSON.stringify(session)), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
  });
}

export async function clearServerSession(): Promise<void> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// --- Client-side ---

export function getClientSession(): WebSession | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  return parseSession(match.slice(COOKIE_NAME.length + 1));
}

export function clearClientSession(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
}

export function setClientSession(session: WebSession): void {
  if (typeof document === 'undefined') return;
  const value = encodeURIComponent(JSON.stringify(session));
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  // SameSite=Lax + Secure mirrors the server-set cookie. httpOnly cannot be
  // set from JS — the OAuth callback path uses the server helper, this client
  // helper exists for the email magic-link flow which runs entirely in-browser.
  document.cookie = `${COOKIE_NAME}=${value}; path=/; max-age=${maxAge}; samesite=lax${
    typeof location !== 'undefined' && location.protocol === 'https:' ? '; secure' : ''
  }`;
}

export const SESSION_COOKIE = COOKIE_NAME;

// Post-login destination. Parsed rather than prefix-checked: browsers strip
// tabs/newlines and treat `\` as `/`, so `/\t/evil.com` would become `//evil.com`.
const NEXT_KEY = 'adrive_next';
const DEFAULT_LANDING = '/dashboard';
const PROBE_ORIGIN = 'https://next.invalid';

export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/')) return null;
  try {
    const url = new URL(raw, PROBE_ORIGIN);
    const path = url.pathname + url.search + url.hash;
    // Dot segments can normalize `/.//evil.com` into the protocol-relative `//evil.com`.
    return url.origin === PROBE_ORIGIN && !path.startsWith('//') ? path : null;
  } catch {
    return null;
  }
}

// Kept in sessionStorage so it survives the OAuth round trip through the worker.
export function rememberNextPath(raw: string | null): void {
  try {
    const next = safeNextPath(raw);
    if (next) sessionStorage.setItem(NEXT_KEY, next);
    else sessionStorage.removeItem(NEXT_KEY);
  } catch {
    // Storage blocked: login still lands on the default page.
  }
}

export function takeNextPath(): string {
  try {
    const next = safeNextPath(sessionStorage.getItem(NEXT_KEY));
    sessionStorage.removeItem(NEXT_KEY);
    return next ?? DEFAULT_LANDING;
  } catch {
    return DEFAULT_LANDING;
  }
}

// /auth/* (the hosted MCP's OAuth consent) is served by the API worker, not this app,
// so only a full page load reaches it.
export function navigateNext(router: { replace(href: string): void }): void {
  const next = takeNextPath();
  if (next.startsWith('/auth/')) window.location.assign(next);
  else router.replace(next);
}
