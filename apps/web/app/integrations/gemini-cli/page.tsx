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
  title: 'Gemini CLI integration',
  description:
    'Capture Gemini CLI sessions in the background and resume them in Claude Code, Codex, OpenCode, Cursor or Antigravity, or the other way round.',
  alternates: { canonical: '/integrations/gemini-cli' },
};

export default function GeminiCliIntegration() {
  return (
    <IntegrationLayout
      platform="gemini-cli"
      label="Gemini CLI"
      lede="Hand work between Gemini CLI and your other agents without re-explaining it. AgentDrive captures Gemini CLI sessions in the background and lets Gemini CLI resume sessions other agents started."
    >
      <IntegrationSection title="Which Gemini CLI">
        <p>
          AgentDrive supports the open-source <code>gemini</code> CLI from{' '}
          <a href="https://github.com/google-gemini/gemini-cli" rel="noopener noreferrer">
            google-gemini/gemini-cli
          </a>
          . Since June 18, 2026, Google points free and Google AI Pro / Ultra personal accounts to Antigravity CLI
          (<code>agy</code>) instead; Gemini CLI now serves Gemini Code Assist Standard and Enterprise licenses, Gemini
          API keys and Vertex AI.
        </p>
        <p>
          This page covers Gemini CLI. Antigravity CLI reads its own hooks and MCP config, so AgentDrive wires it
          separately, along with the Antigravity app and IDE; see <a href="/integrations/antigravity">Antigravity</a>.
        </p>
      </IntegrationSection>

      <IntegrationSection id="install" title="1. Install">
        <p>
          The installer signs you in, then merges session capture hooks and the AgentDrive MCP server into{' '}
          <code>~/.gemini/settings.json</code>, keeping your existing settings, and adds the{' '}
          <code>/agentdrive:resume</code> and <code>/agentdrive:sessions</code> commands.
        </p>
        <Snippet>{INSTALL_COMMAND}</Snippet>
      </IntegrationSection>

      <IntegrationSection id="capture" title="2. Capture a session">
        <p>For this walkthrough, first connect Codex using its <a href="/integrations/codex">setup guide</a>. Work on a small task there, leave a clear goal and next step, then end the session. AgentDrive syncs it in the background. Open Gemini CLI in the same project to receive the handoff below.</p>
        <details className="m-reference">
          <summary>How capture works in this agent</summary>
          <p>
            The hooks fire on <code>SessionStart</code>, <code>AfterAgent</code>, <code>SessionEnd</code> and{' '}
            <code>PreCompress</code>, and hand the session to a detached <code>adrive sync</code>. It reads the
            session from <code>~/.gemini/tmp</code> and uploads the redacted transcript, plus files the agent wrote
            that git doesn&apos;t track, to <code>sessions/&lt;project&gt;/gemini-cli/&lt;session&gt;.md</code>. At
            session start Gemini CLI is told about recent sessions from your other agents in the same project.
            Control all of it with <code>adrive privacy</code>; details are in{' '}
            <a href="/docs/concepts/sessions">Sessions</a>.
          </p>
        </details>
      </IntegrationSection>

      <IntegrationSection id="resume" title="3. Resume another agent's session">
        <p>Run <code>/agentdrive:resume</code>, or ask:</p>
        <PromptExample>Resume my last AgentDrive session from Codex.</PromptExample>
        <p>
          Gemini CLI calls <code>drive_resume</code> and gets a brief with the goal, files touched and recent turns
          from that session.
        </p>
        <p><strong>Check the result:</strong> the brief should name the source agent, the goal, the files touched and the recent turns. Ask the receiving agent to check those files on disk before continuing. After working in Gemini CLI, you can hand the task back to Codex in the same way.</p>
      </IntegrationSection>

      <WorkspaceTools label="Gemini CLI" />
    </IntegrationLayout>
  );
}
