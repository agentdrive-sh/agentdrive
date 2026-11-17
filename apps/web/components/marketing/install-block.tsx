import { CodeBlock } from './code-block';

export function InstallBlock() {
  return <CodeBlock label="Copy install command">curl -fsSL agentdrive.sh/install | sh</CodeBlock>;
}
