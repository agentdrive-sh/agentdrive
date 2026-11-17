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
  title: 'Cursor integration',
  description:
    'Capture Cursor agent sessions in the background and resume them in Claude Code, Codex, OpenCode, Gemini CLI or Antigravity, or the other way round.',
  alternates: { canonical: '/integrations/cursor' },
};

export default function CursorIntegration() {
  return (
    <IntegrationLayout
      platform="cursor"
      label="Cursor"
      lede="Pick up a Claude Code or Codex session inside Cursor, or hand a Cursor session to a terminal agent. AgentDrive captures Cursor sessions in the background."
    >
      <IntegrationSection id="install" title="1. Install">
        <p>
          The installer signs you in, then merges session capture hooks into <code>~/.cursor/hooks.json</code> and
          the AgentDrive server into <code>~/.cursor/mcp.json</code>, keeping anything you already have configured.
          It also adds the <code>/agentdrive-resume</code> and <code>/agentdrive-sessions</code> commands.
        </p>
        <Snippet>{INSTALL_COMMAND}</Snippet>
        <p>Reload Cursor (Cmd-Shift-P, then &quot;Developer: Reload Window&quot;) to pick up the changes.</p>
      </IntegrationSection>

      <IntegrationSection id="capture" title="2. Capture a session">
        <p>For this walkthrough, first connect Codex using its <a href="/integrations/codex">setup guide</a>. Work on a small task there, leave a clear goal and next step, then end the session. AgentDrive syncs it in the background. Open Cursor in the same project to receive the handoff below.</p>
        <details className="m-reference">
          <summary>How capture works in this agent</summary>
          <p>
            The hooks fire on <code>sessionStart</code>, <code>stop</code>, <code>sessionEnd</code> and{' '}
            <code>preCompact</code>, and hand the session to a detached <code>adrive sync</code>. It uploads the
            redacted transcript, plus files the agent wrote that git doesn&apos;t track, to{' '}
            <code>sessions/&lt;project&gt;/cursor/&lt;session&gt;.md</code>. At session start Cursor is told about
            recent sessions from your other agents in the same project. Control all of it with{' '}
            <code>adrive privacy</code>; details are in <a href="/docs/concepts/sessions">Sessions</a>.
          </p>
        </details>
      </IntegrationSection>

      <IntegrationSection id="resume" title="3. Resume another agent's session">
        <p>Run <code>/agentdrive-resume</code>, or ask Cursor in chat:</p>
        <PromptExample>Resume my last AgentDrive session from Codex.</PromptExample>
        <p>
          Cursor calls <code>drive_resume</code> and gets a brief with the goal, files touched and recent turns
          from that session.
        </p>
        <p><strong>Check the result:</strong> the brief should name the source agent, the goal, the files touched and the recent turns. Ask the receiving agent to check those files on disk before continuing. After working in Cursor, you can hand the task back to Codex in the same way.</p>
      </IntegrationSection>

      <WorkspaceTools label="Cursor" />
    </IntegrationLayout>
  );
}
