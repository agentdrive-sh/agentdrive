import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// PEMs stay with the operator. The Worker needs only the signed public response.
const [validUntil, ...pemPaths] = process.argv.slice(2);
const created = Math.floor(Date.now() / 1000);
const expires = Math.floor(Date.parse(validUntil ?? '') / 1000);
if (!(expires > created) || pemPaths.length === 0) {
  throw new Error('Usage: node scripts/sign-bot-directory.ts <expiry-UTC> <private-key.pem> [<private-key.pem> ...]');
}

const signers = pemPaths.map(path => createPrivateKey(readFileSync(path)));
const keys = signers.map(signer => {
  if (signer.asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 signing key is required');
  const { crv, kty, x } = createPublicKey(signer).export({ format: 'jwk' });
  // RFC 7638 hashes lexicographically ordered public members, excluding key metadata.
  const kid = createHash('sha256').update(JSON.stringify({ crv, kty, x })).digest('base64url');
  return { kty, crv, x, kid, nbf: created, exp: expires };
});

const body = JSON.stringify({ keys });
const digest = `sha-256=:${createHash('sha256').update(body).digest('base64')}:`;
const inputs: string[] = [];
const signatures: string[] = [];
for (const [i, key] of keys.entries()) {
  const label = `sig${i + 1}`;
  const params = `("@authority";req "content-digest");alg="ed25519";keyid="${key.kid}";tag="http-message-signatures-directory";created=${created};expires=${expires}`;
  const base = `"@authority";req: agentdrive.sh\n"content-digest": ${digest}\n"@signature-params": ${params}`;
  inputs.push(`${label}=${params}`);
  signatures.push(`${label}=:${sign(null, Buffer.from(base), signers[i]!).toString('base64')}:`);
}
const directory = {
  body, headers: {
    'Content-Type': 'application/http-message-signatures-directory+json',
    'Content-Digest': digest,
    'Signature-Input': inputs.join(', '),
    Signature: signatures.join(', '),
  },
};
writeFileSync(new URL('../lib/web-bot-directory.json', import.meta.url), JSON.stringify(directory, null, 2) + '\n');
