# AgentDrive operations runbook

Reviewed November 16, 2026. On-call owner: Rakesh. Commands below run from the repository root unless specified. Use the checked-out release and the pinned pnpm version.

## Release checks and deployment

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify-claims
pnpm audit --prod --audit-level high
pnpm --filter @agentdrive/web exec opennextjs-cloudflare build
```

The public Next.js app and API are **separate Workers**. `apps/frontend` and `apps/docs` are legacy applications; building them does not deploy the current website.

- API: `pnpm --filter @agentdrive/worker run deploy`, configured in `apps/worker/wrangler.toml`, Worker `agentdrive-worker`.
- Website/docs/dashboard: `pnpm --filter @agentdrive/web run deploy`, configured in `apps/web/wrangler.toml`, Worker `agentdrive-web`. This builds the OpenNext adapter as well as Next.js. Its `API` service binding must point to the intended API Worker.
- CLI/MCP: build and pack the candidate first, inspect the tarballs, then publish the intended package versions through the repository's approved release process. There is currently no `release.yml` workflow. Update the Claude plugin launcher pins and MCP Registry manifest together with package versions. Publish npm before the registry points to the new version.

Before promotion, record the source revision, current deployment version IDs, intended bindings and rollback versions. Compare the actual remote bindings with the checked-in configuration. An isolated preview must use its own KV, R2, Vectorize and Durable Object state; it must never borrow production storage. Check email/OAuth/payment configuration separately because an isolated fixture does not certify production secrets.

Deploy the API before the website when the UI depends on new routes. After deployment, verify the health response, status page, signed-out marketing/docs, sign-in, workspace selection, file read/write/comment/history, hosted MCP and the install route. Run a controlled synthetic capture/resume round trip. Avoid sharing customer transcripts or credentials in evidence.

## Rollback

From the relevant app directory, use the pinned Wrangler:

```sh
pnpm exec wrangler deployments list
pnpm exec wrangler versions list
pnpm exec wrangler rollback <previous-version-id>
```

Run once for each affected Worker. Verify health and the affected flow afterward. Record deployment IDs before deployment rather than assuming the previous release is safe. Durable Object migration incompatibilities may require a forward fix; code rollback does not undo schema or data changes. npm rollback uses a previously verified version's `latest` dist-tag or a corrective patch, with a public explanation; do not assume package unpublishing is available.

## Health, logs and incidents

- Public status: https://agentdrive.sh/status. It probes API, KV and R2 with bounded timeouts and no caching. It does not certify Vectorize, Workers AI, email, Stripe, Google/GitHub, BYO storage or historical uptime.
- API: `https://app.agentdrive.sh/v1/health` returns 200 only when the actual KV and R2 read probes succeed; a missing probe record is normal. Failure returns 503 with no provider exception text.
- Both Workers enable Workers Logs with query strings redacted. In the Cloudflare dashboard inspect errors, CPU, requests and the affected binding. Tail only when needed and avoid retaining authorization headers, sign-in codes, share tokens or transcript content.
- Stripe: inspect event deliveries and current subscription state in the appropriate test/live dashboard. A successful checkout without correct entitlement is a billing incident; do not charge again while debugging.
- Support: hello@agentdrive.sh and https://github.com/agentdrive-sh/agentdrive-mcp/issues. No 24-hour SLA is promised. Founder coverage must be confirmed for the Product Hunt day and Show HN discussion.

Pause promotion immediately for unauthorized disclosure, deleted sensitive content appearing in retrieval, loss of access to encrypted content, widespread authentication failures, or payments without entitlement. Contain the affected flow, preserve restricted evidence, post a factual incident update and give a concrete next-update time. Roll back only when the previous version is compatible with current data.

The application does not install external alert policies. Confirm Cloudflare error/spend notifications, Stripe delivery notifications and support inbox access in the actual accounts before launch. Use the account's current quotas and pricing rather than historical hardcoded estimates. Inspect Workers AI/Vectorize spend daily during launch week. Resume enforcement is controlled by `RESUME_METER_ENFORCE`; production currently specifies `false`, which counts and warns rather than refusing the Free plan's 11th resume. KV-based counts and rate limits are approximate. Rate-limit bindings and test configuration must stay in sync.

## Backup and restore

### KV

The tested operator tool is `apps/worker/scripts/kv-backup.ts` (Node >=22.15). It preserves binary values, metadata and absolute expiration times and encrypts the export with AES-256-GCM. It writes a new owner-only file and refuses to replace an existing export.

Set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and a base64-encoded random 32-byte `AGENTDRIVE_BACKUP_KEY` through your secret environment. Keep the encryption key in a separate protected store. Never pass keys as command arguments or commit exports. Freeze source writes during export: KV has no atomic snapshot, and listing may lag recent changes.

```sh
node apps/worker/scripts/kv-backup.ts export <source-namespace-id> <new-private-backup-file>
node apps/worker/scripts/kv-backup.ts restore <private-backup-file> <empty-target-namespace-id>
node apps/worker/scripts/kv-backup.ts restore <private-backup-file> <empty-target-namespace-id> --apply --isolated-target
node apps/worker/scripts/kv-backup.ts verify <private-backup-file> <target-namespace-id>
```

Restore defaults to dry-run. The target must be a **different, dedicated, empty, unbound namespace with no other writers**. The tool rejects observed existing keys and never deletes records, but the KV API has no atomic create-only write, so isolation is essential. Expired records are skipped; near-expiration records stop the operation rather than silently extending their lifetime. A propagation mismatch requires a read-only verify retry, not blind reapplication. Read back and verify before changing any binding. Preserve the old namespace for rollback.

Back up both application KV and OAuth KV separately before schema changes. Application exports include API credentials and BYO bucket secrets, so encryption and access control matter. No scheduled backup job or off-site retention policy is installed by this tool. Record the operator, timestamp, namespace, key location and verification result for each export. A synthetic isolated restore proves the mechanism; it is not evidence that a production backup has been taken.

### R2 and BYO buckets

KV metadata and blob bytes must be recoverable together. Provider durability does not protect against an accidental application delete or malicious account access. There is no independent automatic R2 backup configured in this repository. Establish and test an operator-owned blob retention/export policy before promising recovery objectives. BYO customers also need retention for their own bucket. Preserve version history and every referenced storage locator; changing a workspace's current bucket does not move old versions.

### Vectorize

The index is derived data. Rebuild through authenticated owner/admin `POST /v1/workspaces/:wid/files/:fid/reindex` for each current plaintext file. This reads the file's recorded locator, validates its content hash and does not create a version or consume additional storage quota. A changed file returns 409 and should be retried from current metadata. Encrypted CLI content cannot be semantically indexed. Rate-limit the batch and record failures.

A successful response says `accepted` and includes a mutation receipt. Vectorize propagation is asynchronous: poll an authenticated semantic query and verify the actual current path/org/workspace before calling restoration complete. Legacy entries with overwritten ownership metadata require reindexing to recover recall. Retrieval validates canonical metadata so stale/deleted entries are excluded while cleanup propagates. The old `backfill-embeddings.ts` command does not exist.

### Stripe

Stripe is authoritative for subscription state; KV retains the customer/org linkage. Preserve those mappings in the encrypted KV backup and reconcile against current Stripe state during recovery. There is no complete automated reconstruction of a lost customer mapping.

## Encryption and secret rotation

Private Workspace is **CLI-side encryption**. Captured content is encrypted before upload; ordinary direct REST/MCP writes are not encrypted by that toggle. The software key store is not a hardware keychain. Back up both `keychain.bin` and `keychain.bin.protector` with restrictive permissions on the original host/user. The repaired CLI migrates decryptors before logout or replacing credentials, preserving access to old captured content. Already-lost legacy credentials without recovery material cannot be reconstructed.

`services/envelope-encryption.ts` is a reserved implementation and is not called by normal storage writes/reads. `BUCKET_KEK_ROOT` is not a production recovery mechanism for current artifact blobs. BYO bucket credentials remain sensitive server-side KV data; do not claim that the server envelope helper encrypts them.

- `TOKEN_SIGNING_SECRET`: rotating it can invalidate signed share/session/OAuth material. There is no general dual-secret rotation path. Review actual token consumers and communicate the impact before rotation.
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`: rotate in the matching Stripe environment, update Worker secrets, verify an actual signed delivery, then retire old credentials according to Stripe's grace period.
- Google/GitHub OAuth secrets: update the provider and Worker together; verify the real callback, state validation and session creation.
- Cloudflare API tokens: least-privilege token, update CI/operator secret store, verify a non-mutating authorized request, then revoke the old token.
- Email: `SEND_EMAIL` binding delivers login codes. Validate the actual sender domain and delivery using the account's current configuration. Do not assume a DNS recipe or an API key from an obsolete runbook.

## Stripe setup

Worker secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`. Pro must be USD 20.00/month (2000 cents); Team USD 30.00/seat/month (3000 cents), with a minimum of 3 seats. Test-mode verification does not establish that live-mode price IDs have those amounts.

Endpoint: `https://app.agentdrive.sh/v1/webhooks/stripe`, events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. The handler verifies signatures and re-reads the current subscription; duplicate or reordered deliveries must not reapply a stale plan. Paid orgs use the customer portal, and a second checkout is refused. Confirm portal configuration, payment methods and receipt/failure notifications in the actual Stripe account.

## BYO bucket operations

Team entitlement and org owner/admin permissions are required for configuration changes. Members and shares cannot manage configuration. Referenced configurations cannot be deleted while actively assigned. Retirement hides a configuration from new assignments but preserves its credentials so old locator-pinned files and versions remain readable. Do not remove those credentials while retained files depend on them.

Providers: default R2, cross-account R2 and S3. Metadata/control-plane state remains in AgentDrive. Three consecutive write failures can mark a bucket read-only; verify the provider credentials and call the verify endpoint after correction. Automatic customer failure emails and server-side customer-managed encryption keys are not implemented. Live collaborative editing is unavailable in this release and returns 503.
