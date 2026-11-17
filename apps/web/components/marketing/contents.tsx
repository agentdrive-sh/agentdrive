export function sectionId(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function Contents({ titles }: { titles: string[] }) {
  return <nav className="m-toc" aria-label="On this page">
    <strong>On this page</strong>
    {titles.map((title) => <a key={title} href={`#${sectionId(title)}`}>{title}</a>)}
  </nav>;
}
