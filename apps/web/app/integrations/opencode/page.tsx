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
  title: 'OpenCode integration',
  description:
    'Capture OpenCode sessions in the background and resume them in Claude Code, Codex, Cursor, Gemini CLI or Antigravity, or the other way round.',
  alternates: { canonical: '/integrations/opencode' },
};

export default function OpencodeIntegration() {
  return (
    <IntegrationLayout
      platform="opencode"
      label="OpenCode"
      lede="Switch models and agents without losing the thread. AgentDrive captures OpenCode sessions in the background and lets OpenCode resume sessions other agents started."
    >
      <IntegrationSection id="install" title="1. Install">
        <p>
          The installer signs you in, then adds a small plugin at{' '}
          <code>~/.config/opencode/plugins/agentdrive.ts</code>, the AgentDrive MCP server in{' '}
          <code>opencode.json</code>, and the <code>/agentdrive-resume</code> and <code>/agentdrive-sessions</code>{' '}
          commands.
        </p>
        <Snippet>{INSTALL_COMMAND}</Snippet>
        <p>
          If your <code>opencode.jsonc</code> has comments, the installer leaves it alone and tells you to add the
          MCP entry by hand, so your comments survive.
        </p>
      </IntegrationSection>

      <IntegrationSection id="capture" title="2. Capture a session">
        <p>For this walkthrough, first connect Claude Code using its <a href="/integrations/claude-code">setup guide</a>. Work on a small task there, leave a clear goal and next step, then end the session. AgentDrive syncs it in the background. Open OpenCode in the same project to receive the handoff below.</p>
        <details className="m-reference">
          <summary>How capture works in this agent</summary>
          <p>
            The plugin listens for <code>session.created</code> and <code>session.idle</code> and hands the session to
            a detached <code>adrive</code> process without waiting on it, so a slow or missing CLI never stalls
            OpenCode. The sync reads the session through <code>opencode export</code> and uploads the redacted
            transcript, plus files the agent wrote that git doesn&apos;t track, to{' '}
            <code>sessions/&lt;project&gt;/opencode/&lt;session&gt;.md</code>. Unlike
            the other harnesses, OpenCode&apos;s plugin API cannot inject context at session start, so ask for{' '}
            <code>/agentdrive-sessions</code> when you want the list. Control what is captured with{' '}
            <code>adrive privacy</code>; details are in <a href="/docs/concepts/sessions">Sessions</a>.
          </p>
        </details>
      </IntegrationSection>

      <IntegrationSection id="resume" title="3. Resume another agent's session">
        <p>Run <code>/agentdrive-resume</code>, or ask:</p>
        <PromptExample>Resume my last AgentDrive session from Claude Code.</PromptExample>
        <p>
          OpenCode calls <code>drive_resume</code>, which by default loads the latest session in this project from a
          different agent CLI, as a brief with the goal, files touched and recent turns.
        </p>
        <p><strong>Check the result:</strong> the brief should name the source agent, the goal, the files touched and the recent turns. Ask the receiving agent to check those files on disk before continuing. After working in OpenCode, you can hand the task back to Claude Code in the same way.</p>
      </IntegrationSection>

      <WorkspaceTools label="OpenCode" />
    </IntegrationLayout>
  );
}
