import { useState } from 'react';
import { Link } from 'react-router-dom';

const INSTALL_COMMAND = 'curl -fsSL agentdrive.sh/install | sh';

const PLATFORMS = [
  'Claude Code',
  'Codex',
  'Cursor',
  'Zed',
  'Cline',
  'Continue',
  'LangGraph',
  'CrewAI',
];

export default function LandingPage() {
  const [copied, setCopied] = useState(false);

  async function copyInstall() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800/50">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="text-sm font-semibold">AgentDrive</span>
          </div>
          <nav className="flex items-center gap-5 text-xs">
            <a
              href="https://docs.agentdrive.sh"
              className="text-zinc-400 hover:text-white transition-colors"
            >
              Docs
            </a>
            <a
              href="https://github.com/agentdrive-sh/agentdrive-mcp"
              className="text-zinc-400 hover:text-white transition-colors"
            >
              GitHub
            </a>
            <Link
              to="/login"
              className="px-3 py-1.5 bg-emerald-500 text-black font-medium rounded-md hover:bg-emerald-400 transition-colors"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 pt-20 pb-24">
        <section className="animate-in">
          <h1 className="text-5xl font-bold tracking-tight mb-5">AgentDrive</h1>
          <p className="text-lg text-zinc-300 leading-relaxed mb-10 max-w-2xl">
            The persistent workspace your agents share across Claude Code, Codex, Cursor, and LangGraph.
          </p>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4 flex items-center justify-between gap-3">
            <code className="font-mono text-sm text-zinc-100 truncate">
              <span className="text-emerald-500 select-none">$ </span>
              {INSTALL_COMMAND}
            </code>
            <button
              onClick={copyInstall}
              className="shrink-0 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors"
              type="button"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-zinc-500 mb-8">
            Detects Claude Code, Codex, Cursor, and any MCP client on your machine. Registers an agent. Writes config. No signup form.
          </p>

          <div className="flex items-center gap-5 text-sm">
            <a
              href="https://github.com/agentdrive-sh/agentdrive-mcp"
              className="text-emerald-500 hover:text-emerald-400 transition-colors"
            >
              View on GitHub
              <span className="ml-1.5 text-zinc-600">-&gt;</span>
            </a>
            <a
              href="https://docs.agentdrive.sh"
              className="text-emerald-500 hover:text-emerald-400 transition-colors"
            >
              Read the docs
              <span className="ml-1.5 text-zinc-600">-&gt;</span>
            </a>
          </div>
        </section>

        <section className="mt-20">
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-4">Works with</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((name) => (
              <span
                key={name}
                className="px-2.5 py-1 text-xs text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-md"
              >
                {name}
              </span>
            ))}
          </div>
        </section>

        <section className="mt-16 grid sm:grid-cols-3 gap-4">
          <FeatureCard
            title="Shared filesystem for agents"
            body="Versioned, content-addressed artifacts on Cloudflare R2. Every write is immutable, every read is sub-100ms at the edge."
          />
          <FeatureCard
            title="Cross-platform memory"
            body="Artifacts are embedded on write. Search and recall surface the right files at the right time across platforms."
          />
          <FeatureCard
            title="Full provenance"
            body="Every write records the principal, the agent platform, and the agent role. Audit who shipped what, from where."
          />
        </section>

        <section className="mt-16">
          <h2 className="text-sm font-semibold text-zinc-300 mb-2">Prefer raw MCP config?</h2>
          <p className="text-xs text-zinc-500 mb-3">
            Drop this into any MCP client (Claude Code, Codex, Cursor, Zed, Cline, Continue).
          </p>
          <pre className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-xs font-mono text-zinc-300 overflow-x-auto leading-relaxed">
{`{
  "mcpServers": {
    "agentdrive": {
      "command": "pnpm",
      "args": ["dlx", "@adrive/mcp-server"],
      "env": {
        "AGENTDRIVE_API_KEY": "agentdrive_live_..."
      }
    }
  }
}`}
          </pre>
        </section>

        <footer className="mt-20 pt-6 border-t border-zinc-800/50 flex items-center justify-between text-xs text-zinc-600">
          <span>Copyright 2026 Rakesh Roushan</span>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/agentdrive-sh/agentdrive-mcp/blob/main/LICENSE"
              className="hover:text-zinc-400 transition-colors"
            >
              License
            </a>
            <a
              href="https://github.com/agentdrive-sh/agentdrive-mcp"
              className="hover:text-zinc-400 transition-colors"
            >
              GitHub
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-white mb-1.5">{title}</h3>
      <p className="text-xs text-zinc-400 leading-relaxed">{body}</p>
    </div>
  );
}
