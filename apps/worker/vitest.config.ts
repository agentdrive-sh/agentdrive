import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineWorkersConfig({
  resolve: {
    alias: {
      '@agentdrive/shared': path.resolve(here, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Every write now also meters usage, so tests that make many writes run past 5s on CI runners.
    testTimeout: 20_000,
    poolOptions: {
      workers: {
        singleWorker: true,
        miniflare: {
          compatibilityDate: '2025-02-04',
          compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
          kvNamespaces: ['KV', 'OAUTH_KV'],
          // Same limits as [[ratelimits]] in wrangler.toml: tests do not read it.
          ratelimits: {
            RL_PRINCIPAL: { simple: { limit: 100, period: 10 } },
            RL_SEARCH: { simple: { limit: 20, period: 10 } },
            // Binding counters, unlike the old KV ones, survive clearKv, and the suite registers
            // and signs in far more than 5 a minute from one IP; rate-limit.test.ts swaps the
            // *_PROD copies in to check the real limits.
            RL_REGISTER: { simple: { limit: 100_000, period: 60 } },
            RL_MAGIC: { simple: { limit: 100_000, period: 60 } },
            RL_REGISTER_PROD: { simple: { limit: 5, period: 60 } },
            RL_MAGIC_PROD: { simple: { limit: 10, period: 60 } },
          },
          r2Buckets: ['R2'],
          durableObjects: {
            FILE_COLLAB: 'FileCollab',
            BILLING_COORDINATOR: { className: 'BillingCoordinator', useSQLite: true },
            RESUME_METER: { className: 'ResumeMeter', useSQLite: true },
            MAGIC_CODES: { className: 'MagicCodes', useSQLite: true },
          },
          bindings: {
            ENVIRONMENT: 'test',
            APP_URL: 'http://localhost:8787',
            SITE_URL: 'http://localhost:3001',
            MCP_URL: 'http://localhost/mcp',
            TOKEN_SIGNING_SECRET: 'test-signing-secret-do-not-use-in-prod',
            STRIPE_SECRET_KEY: 'sk_test_do-not-use',
            STRIPE_WEBHOOK_SECRET: 'whsec_test_do-not-use',
            STRIPE_PRICE_PRO: 'price_test_pro',
            STRIPE_PRICE_TEAM: 'price_test_team',
          },
        },
        main: './src/index.ts',
      },
    },
  },
});
