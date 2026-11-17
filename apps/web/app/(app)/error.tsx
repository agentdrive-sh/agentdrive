'use client';

export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="surface empty" role="alert">
      <h2>Couldn&apos;t load your workspace</h2>
      <p>The request failed. Your data has not been replaced with an empty workspace.</p>
      <button type="button" className="btn primary" onClick={retry}>Try again</button>
      <a href="/session/expired" className="btn ghost">Sign in again</a>
    </div>
  );
}
