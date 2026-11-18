'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isAppRoute } from '@/lib/app-routes';

const GA_DISABLE = 'ga-disable-G-KBE2E432E6';

function syncOptOut() {
  (window as unknown as Record<string, boolean>)[GA_DISABLE] = isAppRoute(location.pathname);
}

// Public pages only, so workspace and file ids in app URLs never reach Google. Once the tag has
// loaded, GA4 sends a page view on every client-side navigation, so the opt-out flag is set on each
// history change before GA4's own listeners (registered later, when the tag loads) see it.
export function Analytics({ id }: { id: string }) {
  const app = isAppRoute(usePathname());
  const [loaded, setLoaded] = useState(!app);

  useEffect(() => {
    syncOptOut();
    const { pushState, replaceState } = history;
    history.pushState = function (...args: Parameters<History['pushState']>) {
      pushState.apply(this, args);
      syncOptOut();
    };
    history.replaceState = function (...args: Parameters<History['replaceState']>) {
      replaceState.apply(this, args);
      syncOptOut();
    };
    addEventListener('popstate', syncOptOut);
    return () => {
      history.pushState = pushState;
      history.replaceState = replaceState;
      removeEventListener('popstate', syncOptOut);
    };
  }, []);

  useEffect(() => {
    if (!app) setLoaded(true);
  }, [app]);

  if (!loaded) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtm.js?id=${id}`} strategy="afterInteractive" />
      <Script id="gtm-init" strategy="afterInteractive">
        {"window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());"}
      </Script>
    </>
  );
}
