import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

// The site has no on-demand revalidation, so prerendered pages (compare, blog
// posts) are served straight from the deployed assets. Without a cache they 404.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
