import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileRules, isDenied, loadRules, shouldIgnore, DEFAULT_DENY } from './ignore.js';

describe('ignore', () => {
  it('default-denies common credential filenames', () => {
    const rules = compileRules(DEFAULT_DENY);
    const root = '/tmp/proj';
    expect(shouldIgnore(root, '/tmp/proj/.env', rules)).toBe(true);
    expect(shouldIgnore(root, '/tmp/proj/.env.local', rules)).toBe(true);
    expect(shouldIgnore(root, '/tmp/proj/.ssh/id_rsa', rules)).toBe(true);
    expect(shouldIgnore(root, '/tmp/proj/node_modules/foo/index.js', rules)).toBe(true);
    expect(shouldIgnore(root, '/tmp/proj/.git/config', rules)).toBe(true);
    expect(shouldIgnore(root, '/tmp/proj/secret.pem', rules)).toBe(true);
    for (const f of ['.dev.vars', '.envrc', 'prod.tfvars', 'terraform.tfstate', 'terraform.tfstate.backup', 'secrets/prod.yaml', 'app.keystore', '.aws/credentials', 'service-account-prod.json', '.kube/config']) {
      expect(shouldIgnore(root, `/tmp/proj/${f}`, rules)).toBe(true);
    }
  });

  it('lets ordinary files through', () => {
    const rules = compileRules(DEFAULT_DENY);
    const root = '/tmp/proj';
    expect(shouldIgnore(root, '/tmp/proj/src/index.ts', rules)).toBe(false);
    expect(shouldIgnore(root, '/tmp/proj/README.md', rules)).toBe(false);
  });

  it('ignores paths outside the project root', () => {
    const rules = compileRules(['*']);
    expect(shouldIgnore('/tmp/proj', '/tmp/other/foo', rules)).toBe(true);
  });

  it('supports negation', () => {
    const rules = compileRules(['*.log', '!keep.log']);
    const root = '/tmp/proj';
    expect(shouldIgnore(root, '/tmp/proj/error.log', rules)).toBe(true);
    expect(shouldIgnore(root, '/tmp/proj/keep.log', rules)).toBe(false);
  });

  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adrive-ignore-test-'));
  });

  it('layers project .adriveignore on top of DEFAULT_DENY', async () => {
    await fs.writeFile(join(dir, '.adriveignore'), 'secrets/\n');
    const rules = await loadRules(dir);
    expect(shouldIgnore(dir, join(dir, 'secrets', 'creds.json'), rules)).toBe(true);
    expect(shouldIgnore(dir, join(dir, 'public', 'index.html'), rules)).toBe(false);
    // DEFAULT_DENY still in effect
    expect(shouldIgnore(dir, join(dir, '.env'), rules)).toBe(true);
  });

  it('never lets a project ignore file negate DEFAULT_DENY', async () => {
    await fs.writeFile(join(dir, '.adriveignore'), '!.env\n!id_rsa\n!.ssh/\n');
    await fs.writeFile(join(dir, '.gitignore'), '!*.pem\n');
    const rules = await loadRules(dir);
    for (const f of ['.env', 'id_rsa', '.ssh/config', 'cert.pem']) expect(shouldIgnore(dir, join(dir, f), rules)).toBe(true);
    expect(shouldIgnore(dir, join(dir, 'notes.md'), rules)).toBe(false);
  });

  it('matches the deny list in any letter case, and project ignore rules as written', async () => {
    await fs.writeFile(join(dir, '.adriveignore'), 'drafts/\n');
    const rules = await loadRules(dir);
    for (const f of ['.ENV', '.DEV.VARS', 'ID_RSA', '.SSH/known', 'Credentials.JSON', 'prod.PEM']) {
      expect(shouldIgnore(dir, join(dir, f), rules)).toBe(true);
      expect(isDenied(join(dir, f))).toBe(true);
    }
    expect(isDenied('/home/me/.AWS')).toBe(true);
    expect(shouldIgnore(dir, join(dir, 'DRAFTS', 'a.md'), rules)).toBe(false);
  });
});
