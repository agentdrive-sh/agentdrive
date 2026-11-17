'use client';

import { useEffect, useRef, useState } from 'react';

export function CodeBlock({ children, label = 'Copy command' }: { children: string; label?: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(children);
      setStatus('copied');
      timer.current = setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('failed');
    }
  }

  return (
    <div className="m-code-block">
      <div className="m-code-row">
        <pre tabIndex={0} aria-label="Command"><code>{children}</code></pre>
        <button type="button" className="btn m-copy" onClick={copy} aria-label={label}>
          {status === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <span className={status === 'failed' ? 'm-copy-error' : 'm-sr'} role="status">
        {status === 'copied' ? 'Copied to clipboard.' : status === 'failed' ? 'Copy unavailable. Select the command and copy it manually.' : ''}
      </span>
    </div>
  );
}
