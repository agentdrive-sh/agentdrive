'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AgentDriveLogo } from '../agentdrive-logo';
import { Icon } from '../icon';
import { CopyableCode } from '../shared';

const STEPS = [
  { n: 1, label: 'Install' },
  { n: 2, label: 'Initialize a project' },
  { n: 3, label: 'First handoff' },
];

const MCP_BLOCK = `{
  "mcpServers": {
    "agentdrive": {
      "command": "npx",
      "args": ["-y", "@adrive/mcp-server"],
      "env": { "AGENTDRIVE_AGENT_PLATFORM": "cursor" }
    }
  }
}`;

export function Onboarding() {
  const [step, setStep] = useState(1);
  return (
    <div className="fade-in" style={{ maxWidth: 900, margin: '40px auto 0' }}>
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <div
          className="row gap-2"
          style={{
            justifyContent: 'center',
            marginBottom: 18,
            color: 'var(--accent)',
          }}
        >
          <AgentDriveLogo size={32} />
        </div>
        <h2
          style={{
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: '-0.025em',
            color: 'var(--text-0)',
            margin: '0 0 10px',
          }}
        >
          Start in any agent. Finish in any other.
        </h2>
        <p
          className="muted"
          style={{
            maxWidth: 540,
            margin: '0 auto',
            fontSize: 15,
            lineHeight: 1.55,
          }}
        >
          One command installs the <span className="mono">adrive</span> CLI,
          signs you in, and wires session capture into Claude Code, Codex,
          OpenCode, Cursor, Gemini CLI and Antigravity.
        </p>
      </div>

      <div
        className="row"
        style={{ justifyContent: 'center', marginBottom: 32 }}
      >
        <div className="row gap-3" style={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          {STEPS.map((s, i) => (
            <div key={s.n} className="row gap-3" style={{ alignItems: 'center' }}>
              <div
                className="row gap-2"
                style={{
                  padding: '6px 12px',
                  borderRadius: 100,
                  background:
                    step >= s.n ? 'var(--accent-soft)' : 'var(--bg-2)',
                  border:
                    '1px solid ' +
                    (step >= s.n ? 'transparent' : 'var(--border)'),
                  color: step >= s.n ? 'var(--accent)' : 'var(--text-3)',
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background:
                      step >= s.n ? 'var(--accent)' : 'var(--bg-3)',
                    color:
                      step >= s.n ? 'var(--accent-fg)' : 'var(--text-3)',
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {step > s.n ? <Icon name="check" size={10} /> : s.n}
                </span>
                <span className="t-sm wt-500">{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  style={{
                    width: 32,
                    height: 1,
                    background: 'var(--border)',
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {step === 1 && <StepInstall onNext={() => setStep(2)} />}
      {step === 2 && (
        <StepInit onBack={() => setStep(1)} onNext={() => setStep(3)} />
      )}
      {step === 3 && <StepHandoff onBack={() => setStep(2)} />}
    </div>
  );
}

function StepInstall({ onNext }: { onNext: () => void }) {
  return (
    <div className="surface" style={{ padding: 32 }}>
      <div className="t-md wt-600 fg-0" style={{ marginBottom: 14 }}>
        1. Install AgentDrive
      </div>
      <div className="muted t-sm" style={{ marginBottom: 14 }}>
        In Claude Code, install the plugin, then run{' '}
        <span className="mono fg-0">/agentdrive:login</span> to sign in and
        wire your other agent tools.
      </div>
      <CopyableCode>
        {`/plugin marketplace add agentdrive-sh/agentdrive-mcp
/plugin install agentdrive@agentdrive`}
      </CopyableCode>
      <div className="muted t-sm" style={{ margin: '20px 0 14px' }}>
        For everything else, one line installs the{' '}
        <span className="mono fg-0">adrive</span> CLI and runs{' '}
        <span className="mono fg-0">adrive init</span>. Your API key is
        stored in <span className="mono">~/.config/agentdrive/config.json</span>,
        never in agent configs.
      </div>
      <CopyableCode>{`curl -fsSL agentdrive.sh/install | sh`}</CopyableCode>
      <div
        className="row gap-2"
        style={{ marginTop: 20, justifyContent: 'flex-end' }}
      >
        <button type="button" className="btn primary" onClick={onNext}>
          I installed it <Icon name="arrow-right" size={12} />
        </button>
      </div>
    </div>
  );
}

interface StepInitProps {
  onBack: () => void;
  onNext: () => void;
}

function StepInit({ onBack, onNext }: StepInitProps) {
  return (
    <div className="col gap-4">
      <div className="surface" style={{ padding: 28 }}>
        <div className="t-md wt-600 fg-0" style={{ marginBottom: 8 }}>
          2. Initialize a project
        </div>
        <div className="muted t-sm" style={{ marginBottom: 18 }}>
          In any working directory, this picks or creates a workspace for the
          project and confirms which agents are wired. Restart your agents
          afterwards so they load the new connection and hooks.
        </div>
        <CopyableCode>{`adrive init`}</CopyableCode>
      </div>

      <div className="surface" style={{ padding: 24 }}>
        <div
          className="t-xs muted wt-600"
          style={{
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          Or add the MCP server manually
        </div>
        <div className="muted t-sm" style={{ marginBottom: 12 }}>
          For any other MCP client. Set the platform to the tool you are
          wiring so provenance shows which agent made each call.
        </div>
        <CopyableCode>{MCP_BLOCK}</CopyableCode>
      </div>

      <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost" onClick={onBack}>
          <Icon name="arrow-left" size={12} /> Back
        </button>
        <button type="button" className="btn primary" onClick={onNext}>
          Next <Icon name="arrow-right" size={12} />
        </button>
      </div>
    </div>
  );
}

function StepHandoff({ onBack }: { onBack: () => void }) {
  return (
    <div className="surface" style={{ padding: 32 }}>
      <div className="t-md wt-600 fg-0" style={{ marginBottom: 14 }}>
        3. Make your first handoff
      </div>
      <div className="muted t-sm" style={{ marginBottom: 18, lineHeight: 1.6 }}>
        Work on a small task in one agent. Leave a clear goal and next step,
        then end the session. Open a different agent in the{' '}
        <span className="fg-0">same project directory</span> and ask:
      </div>
      <CopyableCode>
        Resume my last AgentDrive session from the other agent. Check the files on disk before continuing.
      </CopyableCode>
      <div className="muted t-sm" style={{ marginTop: 14 }}>
        In Claude Code you can also run{' '}
        <span className="mono fg-0">/agentdrive:resume</span>. The brief
        includes the source agent, the goal, files touched and recent turns.
      </div>

      <div
        className="row gap-2"
        style={{ marginTop: 24, justifyContent: 'flex-end' }}
      >
        <button type="button" className="btn ghost" onClick={onBack}>
          <Icon name="arrow-left" size={12} /> Back
        </button>
        <Link href="/dashboard/timeline" className="btn">
          Open Timeline
        </Link>
        <Link href="/dashboard" className="btn primary">
          Go to Overview <Icon name="arrow-right" size={12} />
        </Link>
      </div>
    </div>
  );
}
