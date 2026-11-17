import type { ReactNode } from 'react';
import { MarketingPageShell } from '@/components/marketing/page-shell';
import './blog.css';

export default function BlogLayout({ children }: { children: ReactNode }) {
  return <MarketingPageShell screenLabel="marketing/blog">{children}</MarketingPageShell>;
}
