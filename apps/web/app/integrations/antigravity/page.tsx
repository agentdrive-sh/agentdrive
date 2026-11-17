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
  title: 'Antigravity integration',
  description:
    'Capture Antigravity CLI, app and IDE sessions in the background and resume them in Claude Code, Codex, OpenCode, Cursor or Gemini CLI, or the other way round.',
  alternates: { canonical: '/integrations/antigravity' },
};

export default function AntigravityIntegration() {
  return (
    <IntegrationLayout
      platform="antigravity"
      label="Antigravity"
      lede="Hand work between Antigravity and your other agents without re-explaining it. AgentDrive captures Antigravity sessions in the background and lets Antigravity resume sessions other agents started."
    >
      <IntegrationSection title="Which Antigravity">
        <p>
          Google&apos;s Antigravity CLI (<code>agy</code>), the Antigravity app and the Antigravity IDE all read
          their configuration from <code>~/.gemini/config</code>, so one setup covers all three. Since June 18,
          2026, Google points free and Google AI Pro / Ultra personal accounts here instead of Gemini CLI.
        </p>
        <p>
          If you use the open-source <code>gemini</code> CLI with a Code Assist license, an API key or Vertex AI,
          see <a href="/integrations/gemini-cli">Gemini CLI</a>. AgentDrive wires both when both are installed.
        </p>
      </IntegrationSection>

      <IntegrationSection id="install" title="1. Install">
        <p>
          The installer signs you in, then merges an <code>agentdrive</code> hook into{' '}
          <code>~/.gemini/config/hooks.json</code> and the AgentDrive MCP server into{' '}
          <code>~/.gemini/config/mcp_config.json</code>, keeping your existing settings. It also adds the{' '}
          <code>agentdrive</code>, <code>agentdrive-resume</code> and <code>agentdrive-sessions</code> skills under{' '}
          <code>~/.gemini/config/skills/</code>. If you set <code>enabled: false</code> on the hook, re-running setup
          keeps it off.
        </p>
        <Snippet>{INSTALL_COMMAND}</Snippet>
      </IntegrationSection>

      <IntegrationSection id="capture" title="2. Capture a session">
        <p>For this walkthrough, first connect Claude Code using its <a href="/integrations/claude-code">setup guide</a>. Work on a small task there, leave a clear goal and next step, then end the session. AgentDrive syncs it in the background. Open Antigravity in the same project to receive the handoff below.</p>
        <details className="m-reference">
          <summary>How capture works in this agent</summary>
          <p>
            The hook fires on <code>SessionStart</code> and <code>Stop</code> and hands the session to a detached{' '}
            <code>adrive sync</code>. It reads the transcript from{' '}
            <code>~/.gemini/&lt;app&gt;/brain/&lt;conversation&gt;</code> and uploads the redacted prompts, replies and
            tool calls, plus files the agent wrote that git doesn&apos;t track, to{' '}
            <code>sessions/&lt;project&gt;/antigravity/&lt;session&gt;.md</code>. The project comes from the workspace
            Antigravity reports to the hook. Antigravity has no session-end event, so a session is marked finished
            after 30 minutes idle. At session start Antigravity is told about recent sessions from your other agents
            in the same project. Control all of it with <code>adrive privacy</code>; details are in{' '}
            <a href="/docs/concepts/sessions">Sessions</a>.
          </p>
        </details>
      </IntegrationSection>

      <IntegrationSection id="resume" title="3. Resume another agent's session">
        <p>In Antigravity, resume and sessions are skills rather than slash commands. Ask:</p>
        <PromptExample>Resume my last AgentDrive session from Claude Code.</PromptExample>
        <p>
          Antigravity calls <code>drive_resume</code> and gets a brief with the goal, files touched and recent turns
          from that session.
        </p>
        <p><strong>Check the result:</strong> the brief should name the source agent, the goal, the files touched and the recent turns. Ask the receiving agent to check those files on disk before continuing. After working in Antigravity, you can hand the task back to Claude Code in the same way.</p>
      </IntegrationSection>

      <WorkspaceTools label="Antigravity" />
    </IntegrationLayout>
  );
}
