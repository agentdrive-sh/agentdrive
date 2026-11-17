import type { Metadata } from 'next';
import {
  IntegrationLayout,
  IntegrationSection,
  PromptExample,
  Snippet,
  WorkspaceTools,
} from '@/components/marketing/integration-page';
import { INSTALL_COMMAND } from '../data';

export const metadata: Metadata = {
  title: 'Codex integration',
  description:
    'Capture Codex sessions in the background and resume them in Claude Code, OpenCode, Cursor, Gemini CLI or Antigravity, or the other way round.',
  alternates: { canonical: '/integrations/codex' },
};

export default function CodexIntegration() {
  return (
    <IntegrationLayout
      platform="codex"
      label="Codex"
      lede="Plan in Claude Code, implement in Codex, and stop pasting context between them. AgentDrive captures Codex sessions in the background and lets Codex resume sessions other agents started."
    >
      <IntegrationSection id="install" title="1. Install">
        <p>
          The installer signs you in, then wires session capture hooks into <code>~/.codex/hooks.json</code>, the
          MCP server into <code>~/.codex/config.toml</code>, and the <code>agentdrive-resume</code> and{' '}
          <code>agentdrive-sessions</code> prompts into Codex.
        </p>
        <Snippet>{INSTALL_COMMAND}</Snippet>
        <p>
          Setup also approves the AgentDrive hooks in Codex for you. If Codex is too old to allow that, approve
          them once via <code>/hooks</code>.
        </p>
      </IntegrationSection>

      <IntegrationSection id="capture" title="2. Capture a session">
        <p>For this walkthrough, first connect Claude Code using its <a href="/integrations/claude-code">setup guide</a>. Work on a small task there, leave a clear goal and next step, then end the session. AgentDrive syncs it in the background. Open Codex in the same project to receive the handoff below.</p>
        <details className="m-reference">
          <summary>How capture works in this agent</summary>
          <p>
            The hooks fire on <code>SessionStart</code>, <code>Stop</code>, <code>SessionEnd</code> and{' '}
            <code>PreCompact</code>. Codex caps hook time at 3 seconds, so the hook only starts a detached{' '}
            <code>adrive sync</code> and returns. The sync uploads the redacted transcript, plus files Codex wrote
            that git doesn&apos;t track, to <code>sessions/&lt;project&gt;/codex/&lt;session&gt;.md</code>. Control
            what is captured with <code>adrive privacy</code>; details are in{' '}
            <a href="/docs/concepts/sessions">Sessions</a>.
          </p>
        </details>
      </IntegrationSection>

      <IntegrationSection id="resume" title="3. Resume another agent's session">
        <p>Ask Codex:</p>
        <PromptExample>Resume my last AgentDrive session from Claude Code.</PromptExample>
        <p>
          Codex calls <code>drive_resume</code>, which by default loads the latest session in this project from a
          different agent CLI, as a brief with the goal, files touched and recent turns. The{' '}
          <code>agentdrive-resume</code> prompt does the same. From a shell, <code>adrive resume</code> prints the
          brief.
        </p>
        <p><strong>Check the result:</strong> the brief should name the source agent, the goal, the files touched and the recent turns. Ask the receiving agent to check those files on disk before continuing. After working in Codex, you can hand the task back to Claude Code in the same way.</p>
      </IntegrationSection>

      <WorkspaceTools label="Codex" />
    </IntegrationLayout>
  );
}
