import type { ReactNode } from 'react';
import { sectionId } from './contents';

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={sectionId(title)}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
