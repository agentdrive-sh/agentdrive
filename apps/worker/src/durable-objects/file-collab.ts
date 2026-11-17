import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.js';

export class FileCollab extends DurableObject<Env> {
  private sessions: Map<WebSocket, { id: string; name?: string }> = new Map();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sid') || crypto.randomUUID();
    const name = url.searchParams.get('name') || 'Anonymous';

    this.ctx.acceptWebSocket(server);
    this.sessions.set(server, { id: sessionId, name });

    // Send current state to new connection
    const state = await this.ctx.storage.get<Uint8Array>('yjs-state');
    if (state) {
      server.send(state);
    }

    // Broadcast presence
    this.broadcast(server, JSON.stringify({
      type: 'presence',
      action: 'join',
      user: { id: sessionId, name },
      users: this.getUsers(),
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message instanceof ArrayBuffer) {
      // Yjs binary update — persist and broadcast
      await this.ctx.storage.put('yjs-state', new Uint8Array(message));
      this.broadcast(ws, message);
    } else {
      // Text messages (awareness, presence)
      this.broadcast(ws, message);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);

    if (session) {
      this.broadcast(ws, JSON.stringify({
        type: 'presence',
        action: 'leave',
        user: session,
        users: this.getUsers(),
      }));
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.sessions.delete(ws);
  }

  private broadcast(sender: WebSocket, message: string | ArrayBuffer): void {
    for (const [ws] of this.sessions) {
      if (ws !== sender) {
        try {
          ws.send(message);
        } catch {
          this.sessions.delete(ws);
        }
      }
    }
  }

  private getUsers(): Array<{ id: string; name?: string }> {
    return Array.from(this.sessions.values());
  }
}
