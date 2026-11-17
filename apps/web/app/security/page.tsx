import type { Metadata } from 'next';
import { MarketingPageShell, PageHero, ProseSection } from '@/components/marketing/page-shell';
import { Contents, sectionId } from '@/components/marketing/contents';

export const metadata: Metadata = {
  title: 'Security',
  description: 'What AgentDrive syncs, what Private Workspace encrypts, and what stays managed when you bring your own bucket.',
  alternates: { canonical: '/security' },
};

const titles = ['Choose how content is stored', 'Sync controls', 'Private Workspace', 'Access and identity', 'Infrastructure and transport', 'BYO-bucket', 'Roadmap and disclosures', 'Reporting a vulnerability'];

export default function SecurityPage() {
  return (
    <MarketingPageShell screenLabel="marketing/security">
      <PageHero title="Know what leaves your machine."
        lede="Choose what gets synced, whether content is encrypted locally, and where files are stored. Metadata stays in the managed service."
        meta="Storage and sync behavior reviewed against the implementation: November 16, 2026." />
      <ProseSection>
        <Contents titles={titles} />
        <section id={sectionId(titles[0])}>
          <h2>{titles[0]}</h2>
          <div className="m-data-modes">
            <article><h3>Standard workspace</h3><dl>
              <dt>Content</dt><dd>Redacted transcripts and synced files go to AgentDrive object storage.</dd>
              <dt>Search and resume</dt><dd>The service can process content for semantic search and build a handoff brief.</dd>
              <dt>Metadata</dt><dd>Workspace records, file paths, version history and session metadata stay managed.</dd>
            </dl></article>
            <article><h3>Private Workspace</h3><dl>
              <dt>Content</dt><dd>The CLI encrypts synced content before upload. The service stores ciphertext.</dd>
              <dt>Search and resume</dt><dd>No semantic search of the plaintext. Resume decrypts locally with your key.</dd>
              <dt>Metadata</dt><dd>Project and synced-file paths are hashed. Account, platform, session identifiers, timing and counts remain managed.</dd>
            </dl></article>
            <article><h3>Your own bucket</h3><dl>
              <dt>Content</dt><dd>On Team and Enterprise, workspace files can live in your R2 or S3-compatible bucket.</dd>
              <dt>Search and resume</dt><dd>The same rules apply: standard content can be processed; locally encrypted content requires local decryption.</dd>
              <dt>Metadata</dt><dd>Metadata and search infrastructure stay with AgentDrive. BYO-bucket is not whole-service data residency.</dd>
            </dl></article>
          </div>
        </section>
        <section id="sync-controls"><h2>Sync controls</h2>
          <p>Use <code>adrive privacy</code> to control auto-context, transcript sync, artifact sync and Private Workspace. Artifact sync uploads eligible files the agent touched in a session that git does not track. It also allows <code>adrive watch</code>, which uploads every file under the watched folder, existing files included, whether or not git tracks them. Built-in exclusions, <code>.adriveignore</code> and, for watch, <code>.gitignore</code> filter file paths before upload.</p>
          <p>Pattern-based redaction removes known secret shapes from transcripts and synced files. It is best-effort, not a security boundary: an ignored file path does not remove text already pasted into a conversation. Disable transcript sync for conversations that must stay on your machine.</p>
          <p>See the <a href="/docs/concepts/sessions">session sync reference</a> for exclusions and controls.</p>
        </section>
        <section id="private-workspace"><h2>Private Workspace</h2>
          <p>Enable it with <code>adrive privacy --private-workspace on</code>. New synced transcripts and files are encrypted locally with AES-256-GCM. Sync omits the working directory, title and touched paths from readable run metadata and hashes project and synced-file storage paths.</p>
          <p>The local data key is stored wrapped in the CLI configuration directory. The current software key store uses local machine/user identity and a separate local protector; it is not an OS keychain. Keep both keychain.bin and keychain.bin.protector on the original machine/user. Existing legacy keys migrate while their original API credential is available. Changing login credentials after migration preserves the data key; losing the original legacy credential before migration cannot be repaired by the hosted service.</p>
          <p>For an encrypted session, MCP resume directs you to <code>adrive resume &lt;session-id&gt;</code>, which decrypts locally. Server-side semantic search cannot search the plaintext. Turning this setting on does not retroactively encrypt or delete earlier uploads, and direct MCP writes are not encrypted by the CLI preference.</p>
        </section>
        <section id="access-and-identity"><h2>Access and identity</h2>
          <p>Agent API keys authenticate requests; workspace permissions and organization membership control access. Key hashes are stored instead of plaintext API keys. Human sign-in supports Google, GitHub and email codes. Share links carry signed, scoped tokens.</p>
          <p>Platform and role headers label activity for provenance. They are supplied by clients and are not a separate authentication boundary. If an API key is compromised, revoke it; changing a platform label does not restrict the stolen key.</p>
        </section>
        <section id="infrastructure-and-transport"><h2>Infrastructure and transport</h2>
          <p>The hosted API uses HTTPS. File content is stored in object storage; workspace records, version history, comments, access records and run logs remain in managed metadata storage. Semantic search uses a managed vector index with access filtering.</p>
          <p>We do not train models on your content. The providers used to operate the service are listed in the <a href="/legal/dpa">Data Processing Agreement</a>. The <a href="/legal/privacy">privacy policy</a> describes retention and data requests.</p>
        </section>
        <section id="byo-bucket"><h2>BYO-bucket</h2>
          <p>Team and Enterprise support customer-owned Cloudflare R2 or S3-compatible buckets for workspace file content. Metadata and the vector index remain managed. Choosing an EU bucket controls the location of file storage, not every service operation or category of data.</p>
          <p>The API does not return stored bucket secrets. Repeated write failures put a bucket into read-only mode until it is verified again. See <a href="/docs/data-residency">data residency</a> for the storage boundary.</p>
        </section>
        <section id="roadmap-and-disclosures"><h2>Roadmap and disclosures</h2>
          <p>Customer-managed server-side keys, GCS and Azure buckets, SSO and audit-log export are roadmap items. Private Workspace is available today and is distinct from customer-managed server-side keys.</p>
          <p>For a security review or DPA questions, contact <a href="mailto:legal@agentdrive.sh">legal@agentdrive.sh</a>.</p>
        </section>
        <section id="reporting-a-vulnerability"><h2>Reporting a vulnerability</h2>
          <p>Email <a href="mailto:security@agentdrive.sh">security@agentdrive.sh</a> with a reproducer. We aim to acknowledge within 24 hours and fix high or critical issues within 7 days. No bug bounty program is currently offered.</p>
        </section>
      </ProseSection>
    </MarketingPageShell>
  );
}
