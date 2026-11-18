import type { Env } from './env.js';
import { app } from './app.js';
import { handleOAuthSurface } from './routes/oauth-server.js';

export { FileCollab } from './durable-objects/file-collab.js';
export { BillingCoordinator } from './durable-objects/billing-coordinator.js';
export { ResumeMeter } from './durable-objects/resume-meter.js';
export { MagicCodes } from './durable-objects/magic-codes.js';

// The hosted MCP and its OAuth endpoints are matched before the app; see oauth-server.ts.
export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => handleOAuthSurface(req, env, ctx) ?? app.fetch(req, env, ctx),
};
