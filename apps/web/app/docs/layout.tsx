import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { baseOptions } from '@/lib/layout-options';
import './docs.css';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      theme={{
        defaultTheme: 'dark',
        attribute: ['class', 'data-theme'],
        enableSystem: false,
        themes: ['light', 'dark'],
      }}
    >
      <DocsLayout tree={source.pageTree} {...baseOptions()}>
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
