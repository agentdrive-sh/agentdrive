import { handlePost, methodNotAllowed, preflight } from '@/lib/docs-mcp';

export const POST = handlePost;
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = preflight;
