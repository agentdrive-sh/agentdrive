import { promises as fs } from 'node:fs';
import { join, parse, relative, sep, posix } from 'node:path';

// .adriveignore parser. Subset of gitignore semantics: blank lines and lines
// starting with '#' are skipped; '!' negates a previous pattern; '/' anchors
// to the project root; '**' matches across directories; '*' matches within a
// segment.
//
// In addition we always layer a default-deny set on top so first-time users
// don't accidentally upload .env / .ssh / .aws / node_modules even before
// they edit the file.

export const DEFAULT_DENY: string[] = [
  '.git/',
  'node_modules/',
  '.next/',
  '.open-next/',
  '.turbo/',
  'dist/',
  'build/',
  'coverage/',
  '.cache/',
  '.DS_Store',
  '.env',
  '.env.*',
  '.envrc',
  '.dev.vars',
  '*.tfvars',
  '*.tfstate',
  '*.tfstate.*',
  'secrets/',
  '*.keystore',
  'credentials',
  'service-account*.json',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.crt',
  '.ssh/',
  '.aws/',
  '.gcp/',
  '.kube/',
  '.docker/config.json',
  '.npmrc',
  '.pypirc',
  '.netrc',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  '.gnupg/',
  '.password-store/',
  '.git-credentials',
  '.config/gh/',
  '.config/agentdrive/',
  '.claude.json',
  '.credentials.json',
  'auth.json',
  'oauth_creds.json',
  '*_history',
  'credentials.json',
  'serviceAccount.json',
  '*.sqlite',
  '*.sqlite3',
  '*.db',
  '__pycache__/',
];

interface Rule {
  pattern: string;
  negate: boolean;
  re: RegExp;
}

function patternToRegex(raw: string, ignoreCase: boolean): { re: RegExp; negate: boolean } {
  let pat = raw.trim();
  const negate = pat.startsWith('!');
  if (negate) pat = pat.slice(1);

  // Trailing slash means directory-only; treat it as match-anywhere-inside.
  const dirOnly = pat.endsWith('/');
  if (dirOnly) pat = pat.slice(0, -1);

  // Anchor to root if leading '/'.
  const anchored = pat.startsWith('/');
  if (anchored) pat = pat.slice(1);

  let re = '';
  let i = 0;
  while (i < pat.length) {
    const c = pat[i]!;
    if (c === '*') {
      // '**' matches anything including slashes; single '*' matches within
      // a path segment only.
      if (pat[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (pat[i] === '/') i++;
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+^$()[]{}|\\'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }

  // dirOnly: match the dir itself or anything under it.
  if (dirOnly) re += '(?:/.*)?';

  // anchored = at root only; unanchored = at any depth.
  const final = anchored ? `^${re}$` : `^(?:.*/)?${re}$`;
  return { re: new RegExp(final, ignoreCase ? 'i' : ''), negate };
}

export function compileRules(lines: string[], ignoreCase = false): Rule[] {
  const rules: Rule[] = [];
  for (const raw of lines) {
    const line = raw.replace(/^\s+|\s+$/g, '');
    if (!line || line.startsWith('#')) continue;
    const { re, negate } = patternToRegex(line, ignoreCase);
    rules.push({ pattern: line, negate, re });
  }
  return rules;
}

export async function loadRules(root: string, files: string[] = ['.adriveignore', '.gitignore']): Promise<Rule[]> {
  const lines: string[] = [];
  for (const f of files) {
    try {
      const raw = await fs.readFile(join(root, f), 'utf8');
      lines.push(...raw.split(/\r?\n/));
    } catch {
      // ignore missing
    }
  }
  // Last match wins, so DEFAULT_DENY goes last: a project's `!.env` must never re-include a denied file.
  return [...compileRules(lines), ...DENY_RULES];
}

function normalizeRelative(root: string, path: string): string {
  const rel = relative(root, path);
  return rel.split(sep).join(posix.sep);
}

export function shouldIgnore(root: string, path: string, rules: Rule[]): boolean {
  const rel = normalizeRelative(root, path);
  if (!rel || rel.startsWith('..')) return true;
  let ignored = false;
  for (const r of rules) {
    if (r.re.test(rel)) {
      ignored = !r.negate;
    }
  }
  return ignored;
}

// Case-insensitive, since `.ENV` or `ID_RSA` on a case-insensitive disk is the
// same file; a project's own ignore files keep git's case rules.
export const DENY_RULES = compileRules(DEFAULT_DENY, true);

// Matched from the filesystem root, so every segment and the basename count,
// whatever folder a file was reached from (`adrive watch ~/.ssh`, or a link).
export function isDenied(realPath: string): boolean {
  return shouldIgnore(parse(realPath).root, realPath, DENY_RULES);
}
