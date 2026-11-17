import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('GET /install', () => {
  it('returns the install script as text/plain', async () => {
    const res = await SELF.fetch('http://localhost/install');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body.startsWith('#!/bin/sh')).toBe(true);
    expect(body).toMatch(/PKG_NAME="@adrive\/cli"/);
    expect(body).toMatch(/BIN_NAME="adrive"/);
  });

  it('serves the same body at /install.sh', async () => {
    const a = await (await SELF.fetch('http://localhost/install')).text();
    const b = await (await SELF.fetch('http://localhost/install.sh')).text();
    expect(b).toBe(a);
  });

  it('advertises a sha256 of the script', async () => {
    const res = await SELF.fetch('http://localhost/install');
    const sha = res.headers.get('x-install-script-sha256');
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sets nosniff and a sane cache header', async () => {
    const res = await SELF.fetch('http://localhost/install');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toMatch(/max-age/);
  });
});
