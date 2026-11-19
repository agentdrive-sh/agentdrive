import { z } from 'zod';
import { searchDocs } from '@/lib/search';

const envelope = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.unknown().optional(),
});
const sendParams = z.object({
  message: z.object({
    kind: z.literal('message'),
    role: z.literal('user'),
    messageId: z.string().min(1),
    contextId: z.string().min(1).optional(),
    taskId: z.string().optional(),
    parts: z.array(z.object({ kind: z.string(), text: z.string().optional() })).min(1),
  }),
  configuration: z.object({
    acceptedOutputModes: z.array(z.string()).optional(),
    pushNotificationConfig: z.unknown().optional(),
  }).optional(),
});

function error(id: string | number | null, code: number, message: string) {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(null, -32700, 'Parse error');
  }
  const rpc = envelope.safeParse(body);
  if (!rpc.success) return error(null, -32600, 'Invalid JSON-RPC request');
  const { id, method, params } = rpc.data;
  if (method.startsWith('tasks/pushNotificationConfig/')) return error(id, -32003, 'Push notifications are unavailable');
  if (method === 'message/stream' || method === 'tasks/resubscribe') return error(id, -32004, 'Streaming is unavailable');
  if (method === 'tasks/get' || method === 'tasks/cancel') return error(id, -32001, 'Task not found');
  if (method === 'agent/getAuthenticatedExtendedCard') return error(id, -32007, 'No extended card is configured');
  if (method !== 'message/send') return error(id, -32601, 'Method not found');

  const parsed = sendParams.safeParse(params);
  if (!parsed.success) return error(id, -32602, 'Expected a user message with a messageId and parts');
  const { message, configuration } = parsed.data;
  if (message.taskId) return error(id, -32001, 'Task not found');
  if (configuration?.pushNotificationConfig) return error(id, -32003, 'Push notifications are unavailable');
  const modes = configuration?.acceptedOutputModes;
  if ((modes?.length && !modes.includes('text/plain')) || message.parts.some(p => p.kind !== 'text')) {
    return error(id, -32005, 'Use text/plain for the query and results');
  }
  if (message.parts.some(p => p.text === undefined)) return error(id, -32602, 'A text part needs a text field');
  const query = message.parts.map(p => p.text).join(' ').trim();
  if (!query || query.length > 2000) return error(id, -32602, 'Send a query of 1 to 2000 characters');

  try {
    return Response.json({
      jsonrpc: '2.0', id,
      result: {
        kind: 'message', role: 'agent', messageId: crypto.randomUUID(),
        contextId: message.contextId ?? crypto.randomUUID(),
        parts: [{ kind: 'text', text: await searchDocs(query) }],
      },
    });
  } catch {
    return error(id, -32603, 'Documentation search is unavailable');
  }
}
