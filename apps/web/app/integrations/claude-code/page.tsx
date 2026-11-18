import {
  IntegrationLayout,
  integrationMetadata,
  IntegrationSection,
  Snippet,
  WorkspaceTools,
} from '@/components/marketing/integration-page';
import { INSTALL_COMMAND } from '../data';

export const metadata = integrationMetadata('claude-code');

const pluginInstall = `/plugin marketplace add agentdrive-sh/agentdrive-mcp
/plugin install agentdrive@agentdrive`;

export default function ClaudeCodeIntegration() {
  return (
    <IntegrationLayout platform="claude-code" label="Claude Code">
      <IntegrationSection id="install" title="1. Install the plugin">
        <p>
          Run these inside Claude Code. The plugin adds the session sync hooks, the MCP server, and the{' '}
          <code>/agentdrive:resume</code>, <code>/agentdrive:sessions</code> and <code>/agentdrive:login</code>{' '}
          commands.
        </p>
        <Snippet>{pluginInstall}</Snippet>
        <p>
          Then run <code>/agentdrive:login</code> to sign in and wire your other agent CLIs too. Outside Claude Code,
          the same setup is <code>{INSTALL_COMMAND}</code>.
        </p>
      </IntegrationSection>

      <IntegrationSection id="capture" title="2. Sync a session">
        <p>For this walkthrough, first connect Codex using its <a href="/integrations/codex">setup guide</a>. Work on a small task there, leave a clear goal and next step, then end the session. AgentDrive syncs it in the background. Open Claude Code in the same project to receive the handoff below.</p>
        <details className="m-reference">
          <summary>How sync works in this agent</summary>
          <p>
            The plugin hooks <code>SessionStart</code>, <code>Stop</code>, <code>SessionEnd</code> and{' '}
            <code>PreCompact</code>. Each hook hands the session to a detached <code>adrive sync</code>, which uploads
            the redacted transcript, plus files Claude Code wrote that git doesn&apos;t track, to{' '}
            <code>sessions/&lt;project&gt;/claude-code/&lt;session&gt;.md</code> in your workspace. Claude Code never
            waits on it.
          </p>
          <p>
            When a session starts, Claude Code is told about recent sessions from your other agents in the same
            project. Turn that, transcript sync, artifact sync or Private Workspace on and off with{' '}
            <code>adrive privacy</code>. See <a href="/docs/concepts/sessions">Sessions</a> for
            what is synced and how redaction works.
          </p>
        </details>
      </IntegrationSection>

      <IntegrationSection id="resume" title="3. Resume another agent's session">
        <p>In Claude Code, run:</p>
        <Snippet>/agentdrive:resume</Snippet>
        <p>
          With no id, it loads a handoff brief from the latest session in this project that ran in a different
          agent CLI: the goal, files touched and recent turns. <code>/agentdrive:sessions</code> lists sessions to
          choose from.
        </p>
        <p><strong>Check the result:</strong> the brief should name the source agent, the goal, the files touched and the recent turns. Ask the receiving agent to check those files on disk before continuing. After working in Claude Code, you can hand the task back to Codex in the same way.</p>
      </IntegrationSection>

      <WorkspaceTools label="Claude Code" />


    </IntegrationLayout>
  );
}
