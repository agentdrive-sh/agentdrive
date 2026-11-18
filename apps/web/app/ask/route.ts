import { z } from 'zod';
import { techArticle } from '@/components/seo/site';
import { docsSearch } from '@/lib/search';
import { source } from '@/lib/source';

// NLWeb v0.55 ask endpoint: https://github.com/nlweb-ai/website/blob/main/NLWEBSPEC.md
// Retrieval only over the docs search index; nothing here is generated.

const VERSION = '0.55';
const RESPONSE_FORMAT = 'conversational_search';
const MAX_RESULTS = 10;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

const AskRequest = z.object({
  query: z.looseObject({ text: z.string().trim().min(1) }),
  prefer: z
    .looseObject({
      streaming: z.boolean().optional(),
      response_format: z.string().optional(),
      mode: z.string().optional(),
    })
    .optional(),
});
type AskRequest = z.infer<typeof AskRequest>;

type FailureCode = 'NO_RESULTS' | 'INVALID_QUERY' | 'UNSUPPORTED_FORMAT' | 'UNSUPPORTED_MODE';

function failure(code: FailureCode, message: string) {
  return { _meta: { response_type: 'failure', version: VERSION }, error: { code, message } };
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

function listIncludes(value: string | undefined, wanted: string) {
  return value === undefined || value.split(',').some((v) => v.trim() === wanted);
}

async function search(text: string) {
  const pagesByUrl = new Map(source.getPages().map((p) => [p.url, p]));
  const hits = await docsSearch.search(text);
  const seen = new Set<string>();
  const items = [];
  for (const hit of hits) {
    const page = pagesByUrl.get(hit.url.split('#')[0]);
    if (!page || seen.has(page.url)) continue;
    seen.add(page.url);
    items.push(techArticle(page));
    if (items.length === MAX_RESULTS) break;
  }
  return items;
}

function sse(events: [string, unknown][]) {
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(body, {
    headers: { ...CORS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

async function answer(req: AskRequest, acceptsEventStream: boolean) {
  const streaming = req.prefer?.streaming ?? acceptsEventStream;
  let fail: ReturnType<typeof failure> | undefined;
  let results: Awaited<ReturnType<typeof search>> = [];
  if (!listIncludes(req.prefer?.response_format, RESPONSE_FORMAT)) {
    fail = failure('UNSUPPORTED_FORMAT', `Only the ${RESPONSE_FORMAT} response_format is supported.`);
  } else if (!listIncludes(req.prefer?.mode, 'list')) {
    fail = failure('UNSUPPORTED_MODE', 'Only the list mode is supported.');
  } else {
    results = await search(req.query.text);
    if (results.length === 0) fail = failure('NO_RESULTS', 'No AgentDrive docs pages match this query.');
  }

  if (fail) {
    if (!streaming) return json(fail);
    return sse([
      ['start', { _meta: { ...fail._meta, streaming: true } }],
      ['error', fail],
      ['complete', { _meta: fail._meta }],
    ]);
  }

  const meta = { response_type: 'answer', response_format: RESPONSE_FORMAT, version: VERSION };
  if (!streaming) return json({ _meta: meta, results });
  return sse([
    ['start', { _meta: { ...meta, streaming: true } }],
    ...results.map((item, index): [string, unknown] => ['result', { index, item }]),
    ['complete', { _meta: meta }],
  ]);
}

function respond(input: unknown, request: Request) {
  const parsed = AskRequest.safeParse(input);
  if (!parsed.success) {
    return json(failure('INVALID_QUERY', 'Request must be a JSON object with a non-empty query.text string.'), 400);
  }
  return answer(parsed.data, request.headers.get('accept')?.includes('text/event-stream') ?? false);
}

// GET has no body, so request fields come from dotted params (query.text, prefer.streaming);
// a bare query= or streaming= param is accepted as shorthand.
function paramsToRequest(params: URLSearchParams) {
  const req: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of params) {
    const [section, field] = key.split('.', 2);
    if (field) {
      req[section] ??= {};
      req[section][field] = value;
    }
  }
  const query = params.get('query');
  if (query !== null && !req.query?.text) req.query = { ...req.query, text: query };
  const streaming = req.prefer?.streaming ?? params.get('streaming');
  if (typeof streaming === 'string') req.prefer = { ...req.prefer, streaming: streaming === 'true' };
  return req;
}

export function GET(request: Request) {
  return respond(paramsToRequest(new URL(request.url).searchParams), request);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(failure('INVALID_QUERY', 'Request body must be valid JSON.'), 400);
  }
  return respond(body, request);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
