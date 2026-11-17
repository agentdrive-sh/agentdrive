import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The token in the URL is the credential, so the page is never indexed and never
// sends it on as a referrer.
export const metadata: Metadata = {
  title: 'Shared link',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ShareLayout({ children }: { children: ReactNode }) {
  return children;
}
