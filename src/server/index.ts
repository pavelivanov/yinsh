import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';
import { WebSocketServer, type WebSocket } from 'ws';
import { applyAction, newGame, other, type GameState, type Player } from '../shared/game.ts';
import type { ClientMsg, RoomView, ServerMsg } from '../shared/protocol.ts';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_ROOMS = 5000;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

interface Seat {
  token: string;
}

interface Room {
  id: string;
  seats: [Seat | null, Seat | null];
  game: GameState;
  rematch: [boolean, boolean];
  round: number;
  sockets: Set<WebSocket>;
  touched: number;
}

interface Conn {
  room: Room | null;
  token: string;
  alive: boolean;
}

const rooms = new Map<string, Room>();
const conns = new Map<WebSocket, Conn>();

const validToken = (t: unknown): t is string => typeof t === 'string' && t.length >= 16 && t.length <= 64;

function newRoomId(): string {
  for (;;) {
    const id = Array.from(randomBytes(8), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
    if (!rooms.has(id)) return id;
  }
}

function seatOf(room: Room, token: string): Player | null {
  if (room.seats[0]?.token === token) return 0;
  if (room.seats[1]?.token === token) return 1;
  return null;
}

function viewFor(room: Room, token: string): RoomView {
  const online = new Set<string>();
  for (const ws of room.sockets) {
    const c = conns.get(ws);
    if (c) online.add(c.token);
  }
  const seat = (s: Seat | null) => (s ? { online: online.has(s.token) } : null);
  return {
    id: room.id,
    seats: [seat(room.seats[0]), seat(room.seats[1])],
    you: seatOf(room, token),
    game: room.game,
    rematch: room.rematch,
    round: room.round,
  };
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room) {
  room.touched = Date.now();
  for (const ws of room.sockets) {
    const c = conns.get(ws);
    if (c) send(ws, { t: 'state', view: viewFor(room, c.token) });
  }
}

function leave(ws: WebSocket) {
  const c = conns.get(ws);
  if (!c?.room) return;
  const room = c.room;
  room.sockets.delete(ws);
  c.room = null;
  broadcast(room);
}

function handle(ws: WebSocket, c: Conn, msg: ClientMsg) {
  if (msg.t === 'join') {
    if (!validToken(msg.token)) return send(ws, { t: 'error', message: 'Неверный запрос' });
    const room = typeof msg.room === 'string' ? rooms.get(msg.room) : undefined;
    if (!room) return send(ws, { t: 'missing' });
    leave(ws);
    c.token = msg.token;
    c.room = room;
    room.sockets.add(ws);
    return broadcast(room);
  }

  const room = c.room;
  if (!room) return send(ws, { t: 'error', message: 'Сначала откройте игру' });
  const seat = seatOf(room, c.token);

  switch (msg.t) {
    case 'sit': {
      if (seat !== null) return;
      const free: Player | null = room.seats[0] === null ? 0 : room.seats[1] === null ? 1 : null;
      if (free === null) return; // both seats taken: this visitor just watches
      room.seats[free] = { token: c.token };
      return broadcast(room);
    }

    case 'action': {
      if (seat === null) return send(ws, { t: 'error', message: 'Вы смотрите игру, а не играете' });
      if (!room.seats[0] || !room.seats[1]) return send(ws, { t: 'error', message: 'Соперник ещё не подключился' });
      const res = applyAction(room.game, seat, msg.action);
      if (!res.ok) return send(ws, { t: 'error', message: res.error });
      room.game = res.state;
      if (room.game.phase === 'finished') room.round += 1;
      return broadcast(room);
    }

    case 'rematch': {
      if (seat === null || room.game.phase !== 'finished') return;
      room.rematch[seat] = true;
      if (room.rematch[0] && room.rematch[1]) {
        room.game = newGame(other(room.game.first));
        room.rematch = [false, false];
      }
      return broadcast(room);
    }
  }
}

// ---------- HTTP ----------

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit = 2048): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const clientDir = fileURLToPath(new URL('../../dist/client', import.meta.url));
const assets = existsSync(clientDir) ? sirv(clientDir, { single: true, etag: true }) : null;

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;

  if (path === '/api/rooms' && req.method === 'POST') {
    try {
      const body = (await readBody(req)) as { token?: unknown };
      if (!validToken(body.token)) return json(res, 400, { error: 'Неверный запрос' });
      if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: 'Сервер переполнен, попробуйте позже' });
      const room: Room = {
        id: newRoomId(),
        seats: [{ token: body.token }, null],
        game: newGame(0),
        rematch: [false, false],
        round: 0,
        sockets: new Set(),
        touched: Date.now(),
      };
      rooms.set(room.id, room);
      return json(res, 201, { id: room.id });
    } catch {
      return json(res, 400, { error: 'Неверный запрос' });
    }
  }

  if (path === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size });
  if (path.startsWith('/api/')) return json(res, 404, { error: 'Not found' });

  if (assets) return assets(req, res, () => json(res, 404, { error: 'Not found' }));
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Клиент не собран. Запустите `npm run dev` или `npm run build`.');
});

// ---------- WebSocket ----------

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws) => {
  const c: Conn = { room: null, token: '', alive: true };
  conns.set(ws, c);

  ws.on('pong', () => {
    c.alive = true;
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    try {
      handle(ws, c, msg);
    } catch (e) {
      console.error('message failed', e);
      send(ws, { t: 'error', message: 'Что-то пошло не так' });
    }
  });

  ws.on('close', () => {
    leave(ws);
    conns.delete(ws);
  });
  ws.on('error', () => ws.terminate());
});

// Drop dead connections quickly so the "online" dot stays truthful.
setInterval(() => {
  for (const [ws, c] of conns) {
    if (!c.alive) {
      ws.terminate();
      continue;
    }
    c.alive = false;
    ws.ping();
  }
}, 15_000).unref();

setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [id, room] of rooms) {
    if (room.sockets.size === 0 && room.touched < cutoff) rooms.delete(id);
  }
}, 10 * 60_000).unref();

server.listen(PORT, () => {
  console.log(`Kolo server on http://localhost:${PORT}`);
});
