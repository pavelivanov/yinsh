// Kolo — rules engine. Pure functions, shared by server (authoritative) and client (previews).

export type Player = 0 | 1;
export type Key = string;

export const RADIUS = 5;
export const RINGS_PER_PLAYER = 4;
export const ROW_LENGTH = 5;
export const RINGS_TO_WIN = 3;

export const DIRS = [
  [1, 0],
  [0, 1],
  [1, -1],
  [-1, 0],
  [0, -1],
  [-1, 1],
] as const;
const AXES = DIRS.slice(0, 3);

export type Cell = { kind: 'ring'; owner: Player; id: number } | { kind: 'marker'; owner: Player };

export type Phase = 'placing' | 'moving' | 'claimRow' | 'claimRing' | 'finished';
export type EndReason = 'rings' | 'blocked' | 'resign';

export interface GameState {
  cells: Record<Key, Cell>;
  phase: Phase;
  /** Player who must act now. */
  turn: Player;
  /** Player who opened the game. */
  first: Player;
  /** Player whose ring move started the current row-claiming sequence. */
  mover: Player;
  ringsPlaced: [number, number];
  score: [number, number];
  winner: Player | 'draw' | null;
  endReason: EndReason | null;
  last: { from: Key; to: Key } | null;
  /** Number of applied actions; lets clients detect any change. */
  ply: number;
}

export type Action =
  | { type: 'place'; at: Key }
  | { type: 'move'; from: Key; to: Key }
  | { type: 'claimRow'; cells: Key[] }
  | { type: 'claimRing'; at: Key }
  | { type: 'resign' };

export interface RingMove {
  to: Key;
  /** Markers the ring passes over; they change colour. */
  jumped: Key[];
}

export type Result = { ok: true; state: GameState } | { ok: false; error: string };

export const key = (q: number, r: number): Key => `${q},${r}`;

export const parseKey = (k: Key): [number, number] => {
  const [q, r] = k.split(',').map(Number);
  return [q, r];
};

/** The field is a hexagon of radius 5 with its six corner points cut off (85 points). */
export const onBoard = (q: number, r: number): boolean => {
  const a = Math.abs(q);
  const b = Math.abs(r);
  const c = Math.abs(q + r);
  const tight = (a === RADIUS ? 1 : 0) + (b === RADIUS ? 1 : 0) + (c === RADIUS ? 1 : 0);
  return a <= RADIUS && b <= RADIUS && c <= RADIUS && tight < 2;
};

export const ALL_KEYS: Key[] = (() => {
  const keys: Key[] = [];
  for (let r = -RADIUS; r <= RADIUS; r++) {
    for (let q = -RADIUS; q <= RADIUS; q++) {
      if (onBoard(q, r)) keys.push(key(q, r));
    }
  }
  return keys;
})();

const KEY_SET = new Set(ALL_KEYS);
const isKey = (k: unknown): k is Key => typeof k === 'string' && KEY_SET.has(k);

export const other = (p: Player): Player => (p === 0 ? 1 : 0);

export function newGame(first: Player = 0): GameState {
  return {
    cells: {},
    phase: 'placing',
    turn: first,
    first,
    mover: first,
    ringsPlaced: [0, 0],
    score: [0, 0],
    winner: null,
    endReason: null,
    last: null,
    ply: 0,
  };
}

/**
 * Where a ring can go: along a straight line over empty points; it may jump one
 * unbroken group of markers and must then stop on the first empty point behind it.
 * Rings block the line.
 */
export function ringMoves(cells: Record<Key, Cell>, from: Key): RingMove[] {
  const [q0, r0] = parseKey(from);
  const moves: RingMove[] = [];
  for (const [dq, dr] of DIRS) {
    const jumped: Key[] = [];
    let q = q0 + dq;
    let r = r0 + dr;
    while (onBoard(q, r)) {
      const k = key(q, r);
      const cell = cells[k];
      if (!cell) {
        moves.push({ to: k, jumped: [...jumped] });
        if (jumped.length > 0) break;
      } else if (cell.kind === 'marker') {
        jumped.push(k);
      } else {
        break;
      }
      q += dq;
      r += dr;
    }
  }
  return moves;
}

/** Every way to pick ROW_LENGTH adjacent markers of one colour on a line. */
export function findRows(cells: Record<Key, Cell>, player: Player): Key[][] {
  const own = (k: Key) => {
    const c = cells[k];
    return c !== undefined && c.kind === 'marker' && c.owner === player;
  };
  const rows: Key[][] = [];
  for (const k of ALL_KEYS) {
    if (!own(k)) continue;
    const [q, r] = parseKey(k);
    for (const [dq, dr] of AXES) {
      if (own(key(q - dq, r - dr))) continue; // not the start of a run
      const run: Key[] = [];
      let cq = q;
      let cr = r;
      while (own(key(cq, cr))) {
        run.push(key(cq, cr));
        cq += dq;
        cr += dr;
      }
      for (let i = 0; i + ROW_LENGTH <= run.length; i++) {
        rows.push(run.slice(i, i + ROW_LENGTH));
      }
    }
  }
  return rows;
}

export function hasAnyMove(cells: Record<Key, Cell>, player: Player): boolean {
  for (const k of ALL_KEYS) {
    const c = cells[k];
    if (c?.kind === 'ring' && c.owner === player && ringMoves(cells, k).length > 0) return true;
  }
  return false;
}

function finish(s: GameState, winner: Player | 'draw', reason: EndReason) {
  s.phase = 'finished';
  s.winner = winner;
  s.endReason = reason;
}

/** After a ring move or a finished claim: next claim (mover first), or pass the turn. */
function settle(s: GameState) {
  for (const p of [s.mover, other(s.mover)]) {
    if (findRows(s.cells, p).length > 0) {
      s.phase = 'claimRow';
      s.turn = p;
      return;
    }
  }
  s.phase = 'moving';
  s.turn = other(s.mover);
  if (!hasAnyMove(s.cells, s.turn)) {
    const [a, b] = s.score;
    finish(s, a === b ? 'draw' : a > b ? 0 : 1, 'blocked');
  }
}

const fail = (error: string): Result => ({ ok: false, error });

export function applyAction(prev: GameState, player: Player, action: Action): Result {
  if (prev.phase === 'finished') return fail('Игра уже окончена');
  if (typeof action !== 'object' || action === null) return fail('Неверный ход');

  const s = structuredClone(prev);
  s.ply += 1;

  if (action.type === 'resign') {
    finish(s, other(player), 'resign');
    return { ok: true, state: s };
  }

  if (prev.turn !== player) return fail('Сейчас ход соперника');

  switch (action.type) {
    case 'place': {
      if (s.phase !== 'placing') return fail('Кольца уже расставлены');
      if (!isKey(action.at) || s.cells[action.at]) return fail('Эта точка занята');
      s.cells[action.at] = { kind: 'ring', owner: player, id: player * RINGS_PER_PLAYER + s.ringsPlaced[player] };
      s.ringsPlaced[player] += 1;
      s.turn = other(player);
      if (s.ringsPlaced[0] === RINGS_PER_PLAYER && s.ringsPlaced[1] === RINGS_PER_PLAYER) {
        s.phase = 'moving';
        s.turn = s.first;
      }
      return { ok: true, state: s };
    }

    case 'move': {
      if (s.phase !== 'moving') return fail('Сейчас нельзя двигать кольцо');
      if (!isKey(action.from) || !isKey(action.to)) return fail('Неверный ход');
      const ring = s.cells[action.from];
      if (!ring || ring.kind !== 'ring' || ring.owner !== player) return fail('Здесь нет вашего кольца');
      const move = ringMoves(s.cells, action.from).find((m) => m.to === action.to);
      if (!move) return fail('Кольцо не может сюда пойти');
      s.cells[action.from] = { kind: 'marker', owner: player };
      s.cells[action.to] = ring;
      for (const k of move.jumped) {
        const c = s.cells[k];
        if (c.kind === 'marker') c.owner = other(c.owner);
      }
      s.last = { from: action.from, to: action.to };
      s.mover = player;
      settle(s);
      return { ok: true, state: s };
    }

    case 'claimRow': {
      if (s.phase !== 'claimRow') return fail('Сейчас нечего снимать');
      if (!Array.isArray(action.cells) || !action.cells.every(isKey)) return fail('Неверный ряд');
      const wanted = [...action.cells].sort().join('|');
      const row = findRows(s.cells, player).find((r) => [...r].sort().join('|') === wanted);
      if (!row) return fail('Это не ряд из пяти ваших фишек');
      for (const k of row) delete s.cells[k];
      s.phase = 'claimRing';
      return { ok: true, state: s };
    }

    case 'claimRing': {
      if (s.phase !== 'claimRing') return fail('Сейчас нельзя снимать кольцо');
      if (!isKey(action.at)) return fail('Неверный ход');
      const ring = s.cells[action.at];
      if (!ring || ring.kind !== 'ring' || ring.owner !== player) return fail('Выберите своё кольцо');
      delete s.cells[action.at];
      // The move trace must not point at a point that no longer holds the ring.
      if (s.last?.to === action.at) s.last = null;
      s.score[player] += 1;
      if (s.score[player] >= RINGS_TO_WIN) finish(s, player, 'rings');
      else settle(s);
      return { ok: true, state: s };
    }

    default:
      return fail('Неверный ход');
  }
}
