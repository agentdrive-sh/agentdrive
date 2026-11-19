import { test, expect } from '@playwright/test';
import { displayPlatform } from '../../components/platform-glyph';

// Regression: FE-01/02/03/04 — comment persistence, workspace identity,
// pagination and expired-session recovery. Found by /qa on 2026-11-16.

async function signIn(page: import('@playwright/test').Page, key = 'sess_launch_fixture') {
  await page.context().addCookies([{ name: 'adrive_session', value: encodeURIComponent(JSON.stringify({ api_key: key, email: 'launch@example.invalid' })), domain: 'localhost', path: '/' }]);
}

test('expired identity reauthenticates instead of showing an empty customer dashboard', async ({ page }) => {
  await signIn(page, 'sess_expired_fixture');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Sign in to AgentDrive' })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
});

test('selecting another workspace and opening a scoped deep link preserves project identity', async ({ page }) => {
  await signIn(page);
  await page.goto('/files');
  await page.getByRole('combobox', { name: 'Workspace' }).selectOption('ws_beta');
  await expect(page.getByText('beta-plan.md', { exact: true })).toBeVisible();
  await page.getByRole('link').filter({ hasText: 'beta-plan.md' }).click();
  await expect(page).toHaveURL(/workspace=ws_beta/);
  await expect(page.getByRole('heading', { name: 'beta-plan.md' })).toBeVisible();
  await page.goto('/files/f_beta?workspace=ws_beta');
  await expect(page.getByRole('heading', { name: 'beta-plan.md' })).toBeVisible();
});

test('gemini-cli platform ids count and filter as Antigravity', async ({ page }) => {
  expect(['gemini-cli', 'antigravity', 'codex'].map(displayPlatform)).toEqual(['antigravity', 'antigravity', 'codex']);
  await signIn(page);
  await page.goto('/files');
  await page.getByRole('combobox', { name: 'Workspace' }).selectOption('ws_beta');
  const chip = page.getByRole('button', { name: /^Antigravity/ });
  await expect(chip).toHaveText(/Antigravity\s*1/);
  await chip.click();
  await expect(page.getByText('beta-plan.md', { exact: true })).toBeVisible();
});

test('file pagination exposes the 51st artifact and hash filtering works', async ({ page }) => {
  await signIn(page);
  await page.goto('/files');
  await page.getByRole('button', { name: 'Load more artifacts' }).click();
  await page.getByRole('textbox', { name: 'Filter loaded artifacts' }).fill('hash-51');
  await expect(page.getByText('artifact-51.md', { exact: true })).toBeVisible();
});

test('comments persist after reload and failed posts retain the draft with an error', async ({ page }) => {
  await signIn(page);
  await page.goto('/files/f_1?workspace=ws_alpha');
  await page.getByRole('button', { name: /^Comments/ }).click();
  const draft = page.getByRole('textbox', { name: 'Add a comment' });
  await draft.fill('Launch handoff verified');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Launch handoff verified', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const overview = page.locator('.surface').filter({ has: page.getByText(/File preview.*first 30 lines/) });
  await expect(overview.getByText('Comments', { exact: true }).locator('..')).toContainText('1');
  await page.getByRole('button', { name: /^Versions/ }).click();
  await expect(page.getByRole('button', { name: /^Comments/ }).locator('.count')).toHaveText('1');
  await page.getByRole('button', { name: /^Comments/ }).click();
  await expect(page.getByText('Launch handoff verified', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^Comments/ }).click();
  await expect(page.getByText('Launch handoff verified', { exact: true })).toBeVisible();
  await draft.fill('reject this comment');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Comment rejected' })).toBeVisible();
  await expect(draft).toHaveValue('reject this comment');
  await page.goto('/files/f_2?workspace=ws_alpha');
  await page.getByRole('button', { name: /^Comments/ }).click();
  await expect(page.getByText('Launch handoff verified', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No comments yet', exact: true })).toBeVisible();
});

test('version cursors expose older history and deep links validate workspace ownership', async ({ page }) => {
  await signIn(page);
  await page.goto('/files/f_1?workspace=ws_alpha');
  await page.getByRole('button', { name: /^Versions/ }).click();
  await expect(page.getByText('v1', { exact: true })).toBeVisible();
  await expect(page.locator('.tl-item').first()).toContainText('v51');
  await expect(page.locator('.tl-item').last()).toContainText('v1');
  await expect(page.getByText('authored by', { exact: true }).locator('..')).toContainText('Claude Code');
  await expect(page.getByText('last edit', { exact: true }).locator('..')).toContainText('Codex');
  await page.goto('/files/by-path?workspace=ws_beta&path=beta-plan.md');
  await expect(page.getByRole('heading', { name: 'beta-plan.md' })).toBeVisible();
  await page.goto('/files/f_beta?workspace=ws_other_org');
  await expect(page.getByRole('heading', { name: 'beta-plan.md' })).toHaveCount(0);
  await expect(page.getByText('This page could not be found.')).toBeVisible();
});

test('API failure renders a retryable error instead of a valid empty account', async ({ page }) => {
  await signIn(page, 'sess_outage_fixture');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: "Couldn't load your workspace" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByText('No workspace yet', { exact: true })).toHaveCount(0);
});

test('removed team membership offers sign-in recovery rather than empty workspace success', async ({ page }) => {
  await signIn(page, 'sess_removed_fixture');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?reason=membership/);
  await expect(page.getByRole('alert').filter({ hasText: 'Your team membership changed' })).toBeVisible();
  await expect(page.getByText('No workspace yet', { exact: true })).toHaveCount(0);
});

test('mobile workspace selection and files keep the document within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/files');
  await expect(page.getByRole('combobox', { name: 'Workspace' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('mobile pricing cards never overlap a plan name with its price', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pricing');
  const cards = page.locator('.m-plan');
  await expect(cards.filter({ hasText: 'Team' })).toBeVisible();
  for (const card of await cards.all()) {
    const name = await card.locator('.m-plan-head .m-h3').boundingBox();
    const price = await card.locator('.price').boundingBox();
    if (!name || !price) throw new Error('plan card is missing its name or price');
    const overlaps = name.x < price.x + price.width && price.x < name.x + name.width && name.y < price.y + price.height && price.y < name.y + name.height;
    expect(overlaps, await card.locator('.m-h3').innerText()).toBe(false);
  }
});

test('billing retains the current plan during an invoice outage', async ({ page }) => {
  await signIn(page, 'sess_invoice_outage_fixture');
  await page.goto('/billing');
  await expect(page.getByText('Current plan', { exact: true })).toBeVisible();
  await expect(page.getByText(/Invoice history is temporarily unavailable/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No invoices yet' })).toHaveCount(0);
});

test('billing shows the invoiced currency and only offers available invoice links', async ({ page }) => {
  await signIn(page, 'sess_invoice_currency_fixture');
  await page.goto('/billing');
  await expect(page.getByText('¥1,200', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download invoice PDF' })).toHaveCount(0);
});

test('billing failure cannot misrepresent a paid customer as a Free account', async ({ page }) => {
  await signIn(page, 'sess_billing_outage_fixture');
  await page.goto('/billing');
  await expect(page.getByRole('heading', { name: "Couldn't load your workspace" })).toBeVisible();
  await expect(page.getByText('Current plan', { exact: true })).toHaveCount(0);
});

test('public privacy, status navigation and sitemap reflect the real page contracts', async ({ page, request }) => {
  // This controls only the owned non-forwarding API fixture. The page still
  // performs its normal server fetch; no browser response is intercepted.
  const setHealth = async (state: 'healthy' | 'unavailable') => {
    const response = await request.post('http://127.0.0.1:8791/__fixture/health', { data: { state } });
    expect(response.ok()).toBe(true);
  };
  await setHealth('healthy');
  try {
    const security = await page.goto('/security');
    expect(security?.status()).toBe(200);
    const privacy = page.locator('#private-workspace');
    await expect(privacy).toContainText(/encrypted locally/i);
    await expect(privacy).toContainText(/direct MCP writes are not encrypted/i);
    await expect(privacy).toContainText(/not an OS keychain/i);
    await expect(privacy).toContainText('keychain.bin.protector');

    const statusLink = page.getByRole('contentinfo').getByRole('link', { name: 'Status', exact: true });
    await expect(statusLink).toHaveAttribute('href', '/status');
    await statusLink.click();
    await expect(page).toHaveURL(/\/status$/);
    await expect(page.getByRole('heading', { name: 'Service status', exact: true })).toBeVisible();
    expect((await request.get('http://127.0.0.1:8791/v1/health')).status()).toBe(200);
    await expect(page.getByText('Responding', { exact: true })).toHaveCount(3);
    await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(0);

    const healthyMd = await request.get('/status.md');
    expect(healthyMd.headers()['cache-control']).toContain('no-store');
    expect(await healthyMd.text()).toContain('The API is responding.');

    await setHealth('unavailable');
    expect((await request.get('http://127.0.0.1:8791/v1/health')).status()).toBe(503);
    const failedMd = await request.get('/status', { headers: { accept: 'text/markdown' } });
    expect(await failedMd.text()).toContain('We could not confirm that all core services are responding.');
    await page.reload();
    await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(2);
    await expect(page.getByText('Responding', { exact: true })).toHaveCount(1);
    await expect(page.getByText('The API is responding. Storage results are listed below.', { exact: true })).toHaveCount(0);

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()['content-type']).toMatch(/xml/);
    expect(await sitemap.text()).toContain('<loc>https://agentdrive.sh/status</loc>');
  } finally {
    await setHealth('healthy');
  }
});

for (const mode of ['search', 'context'] as const) {
  test(`memory ${mode} renders keyword matches and identical copies without invented scores`, async ({ page }) => {
    const diagnostics: string[] = [];
    page.on('pageerror', (error) => diagnostics.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /same key|two children|toFixed/i.test(message.text())) diagnostics.push(message.text());
    });
    await signIn(page);
    await page.goto('/memory?workspace=ws_alpha');
    try {
      if (mode === 'search') {
        await page.getByPlaceholder('What did my agents work on…').fill('retrieval fixture');
        await page.getByRole('button', { name: 'Search', exact: true }).click();
      } else {
        await page.locator('.tabs .tab').filter({ hasText: 'drive_context' }).click();
        await page.getByRole('textbox', { name: 'Task', exact: true }).fill('retrieval fixture');
        await page.getByRole('button', { name: 'Run context query' }).click();
      }
      const results = page.locator(mode === 'search' ? 'a.hit' : '.row-item');
      await expect(results).toHaveCount(3);
      for (const path of ['artifact-01.md', 'artifact-02.md', 'artifact-51.md']) {
        await expect(results.filter({ hasText: path })).toBeVisible();
      }
      await expect(page.getByText('0.84', { exact: true })).toBeVisible();
      await expect(page.getByText('Keyword match', { exact: true })).toBeVisible();
      await expect(page.getByText('0.00', { exact: true })).toHaveCount(0);
      if (mode === 'search') {
        await page.getByRole('button', { name: 'Most recent', exact: true }).click();
        await expect(page.locator('a.hit').first()).toContainText('artifact-51.md');
        await expect(page.locator('a.hit')).toHaveCount(3);
        await page.getByRole('button', { name: 'Relevance', exact: true }).click();
        await expect(page.locator('a.hit').first()).toContainText('artifact-01.md');
        await expect(page.locator('a.hit')).toHaveCount(3);
        await page.locator('a.hit').filter({ hasText: 'artifact-51.md' }).click();
        await expect(page).toHaveURL(/\/files\/by-path\?workspace=ws_alpha&path=artifact-51.md/);
        await expect(page.getByRole('heading', { name: 'artifact-51.md', exact: true })).toBeVisible();
        await expect(page.getByText('drive_versions({ workspace_id: "ws_alpha", file_id: "f_51" })', { exact: true })).toBeVisible();
      }
    } finally {
      expect(diagnostics).toEqual([]);
    }
  });
}

test('CLI sign-in names the account and org, refuses a wrong code and submits the terminal code', async ({ page }) => {
  await signIn(page);
  await page.goto('/cli-auth?id=cli_fixture');
  await expect(page.getByRole('heading', { name: 'Authorize the AgentDrive CLI' })).toBeVisible();
  await expect(page.getByText('launch@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByText('Launch fixture', { exact: true })).toBeVisible();
  await expect(page.getByText(/AgentDrive never asks you to enter a code someone sent you/)).toBeVisible();

  const code = page.getByLabel('Code shown in your terminal');
  const authorize = page.getByRole('button', { name: 'Authorize', exact: true });
  await code.fill('aaaa-aaaa');
  await authorize.click();
  await expect(page.getByRole('alert').filter({ hasText: 'does not match' })).toBeVisible();

  await code.fill('wxyz-2345');
  const submitted = page.waitForRequest((r) => r.url().endsWith('/v1/auth/cli/complete') && r.method() === 'POST');
  await authorize.click();
  expect((await submitted).postDataJSON()).toEqual({ id: 'cli_fixture', user_code: 'WXYZ-2345' });
  await expect(page.getByRole('heading', { name: 'Logged in', exact: true })).toBeVisible();
});

test('CLI sign-in whose session ended after the page loaded goes back to sign-in for the same request', async ({ page }) => {
  await signIn(page, 'sess_revoked_fixture');
  await page.goto('/cli-auth?id=cli_fixture');
  await page.getByLabel('Code shown in your terminal').fill('WXYZ-2345');
  await page.getByRole('button', { name: 'Authorize', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Sign in to AgentDrive CLI', exact: true })).toBeVisible();
  await expect(page.getByText(/Your session ended/)).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Authorize the AgentDrive CLI' })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('id')).toBe('cli_fixture');
  expect((await page.context().cookies()).some((c) => c.name === 'adrive_session')).toBe(false);
});
