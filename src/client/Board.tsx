import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ALL_KEYS,
  findRows,
  key,
  onBoard,
  parseKey,
  ringMoves,
  type Action,
  type GameState,
  type Key,
  type Player,
} from '../shared/game.ts';
import { play } from './sound.ts';

const STEP = 56;
const ROW_H = (STEP * Math.sqrt(3)) / 2;
const VB_MIN = -296;
const VB_SIZE = 592;

// One family of grid lines runs vertically, the other two at ±60° to it — like the classic board.
const at = (k: Key) => {
  const [q, r] = parseKey(k);
  return { x: ROW_H * r, y: STEP * (q + r / 2) };
};

const POINTS = ALL_KEYS.map((k) => ({ k, ...at(k) }));

const EDGES = ALL_KEYS.flatMap((k) => {
  const [q, r] = parseKey(k);
  const a = at(k);
  return [
    [1, 0],
    [0, 1],
    [1, -1],
  ]
    .filter(([dq, dr]) => onBoard(q + dq, r + dr))
    .map(([dq, dr]) => ({ id: `${k}>${dq},${dr}`, a, b: at(key(q + dq, r + dr)) }));
});

// Plate under the grid: the twelve-hull outline of the field (hexagon with cut corners),
// pushed a little wider than the outermost points.
const HULL: [number, number][] = [
  [4, 1],
  [5, -1],
  [5, -4],
  [4, -5],
  [1, -5],
  [-1, -4],
  [-4, -1],
  [-5, 1],
  [-5, 4],
  [-4, 5],
  [-1, 5],
  [1, 4],
];
const PLATE = HULL.map(([q, r]) => {
  const p = at(key(q, r));
  const d = Math.hypot(p.x, p.y);
  const m = 1 + 26 / d;
  return `${(p.x * m).toFixed(1)},${(p.y * m).toFixed(1)}`;
}).join(' ');

/** When several rows overlap, the one that starts closest to the pointed marker wins. */
function pickRow(rows: Key[][], k: Key): Key[] | null {
  let best: Key[] | null = null;
  let bestIndex = Infinity;
  for (const row of rows) {
    const i = row.indexOf(k);
    if (i !== -1 && i < bestIndex) {
      best = row;
      bestIndex = i;
    }
  }
  return best;
}

interface Props {
  game: GameState;
  /** Seat of the person looking at the board; null for spectators and demos. */
  you: Player | null;
  /** True when it is this person's turn and moves can be sent. */
  active: boolean;
  onAction?: (action: Action) => void;
}

export function Board({ game, you, active, onAction }: Props) {
  const { cells, phase, last } = game;
  const [selected, setSelected] = useState<Key | null>(null);
  const [hover, setHover] = useState<Key | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => setSelected(null), [game.ply, active]);

  // A removed ring lingers for a moment, so both players see which one went.
  const [goneRings, setGoneRings] = useState<{ id: number; owner: Player; k: Key }[]>([]);
  const ringsById = useRef(new Map<number, { owner: Player; k: Key }>());
  useEffect(() => {
    const now = new Map<number, { owner: Player; k: Key }>();
    for (const [k, c] of Object.entries(cells)) if (c.kind === 'ring') now.set(c.id, { owner: c.owner, k });
    const gone = [...ringsById.current]
      .filter(([id]) => !now.has(id))
      .map(([id, info]) => ({ id, ...info }));
    ringsById.current = now;
    if (!gone.length) return;
    setGoneRings((gs) => [...gs.filter((g) => !gone.some((x) => x.id === g.id)), ...gone]);
    for (const g of gone) setTimeout(() => setGoneRings((gs) => gs.filter((x) => x.id !== g.id)), 800);
  }, [cells]);

  const moves = useMemo(
    () => (selected && cells[selected]?.kind === 'ring' ? ringMoves(cells, selected) : []),
    [cells, selected],
  );
  const targets = useMemo(() => new Map(moves.map((m) => [m.to, m.jumped])), [moves]);

  const rows = useMemo(
    () => (active && you !== null && phase === 'claimRow' ? findRows(cells, you) : []),
    [active, you, phase, cells],
  );
  const rowKeys = useMemo(() => new Set(rows.flat()), [rows]);
  const hoverRow = hover ? pickRow(rows, hover) : null;
  const willFlip = hover && targets.get(hover) ? targets.get(hover)! : [];

  const ownRing = (k: Key) => {
    const c = cells[k];
    return c?.kind === 'ring' && c.owner === you;
  };

  const canClick = (k: Key): boolean => {
    if (!active || you === null) return false;
    if (phase === 'placing') return !cells[k];
    if (phase === 'moving') return ownRing(k) || targets.has(k);
    if (phase === 'claimRow') return rowKeys.has(k);
    if (phase === 'claimRing') return ownRing(k);
    return false;
  };

  const click = (k: Key) => {
    if (!active || you === null || !onAction) return;
    if (phase === 'placing') {
      if (!cells[k]) onAction({ type: 'place', at: k });
    } else if (phase === 'moving') {
      if (ownRing(k)) {
        setSelected(selected === k ? null : k);
        play({ name: 'select' });
      }
      else if (selected && targets.has(k)) onAction({ type: 'move', from: selected, to: k });
      else setSelected(null);
    } else if (phase === 'claimRow') {
      const row = pickRow(rows, k);
      if (row) onAction({ type: 'claimRow', cells: row });
    } else if (phase === 'claimRing') {
      if (ownRing(k)) onAction({ type: 'claimRing', at: k });
    }
  };

  /**
   * The lattice point nearest to a pointer event, within tapping distance. One
   * overlay handles presses this way, so on a phone the whole space between
   * neighbouring points works as a touch target, not just a small circle.
   */
  const pointAt = (e: { clientX: number; clientY: number }): Key | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    const scale = Math.min(box.width / VB_SIZE, box.height / VB_SIZE);
    const x = VB_MIN + (e.clientX - box.left - (box.width - VB_SIZE * scale) / 2) / scale;
    const y = VB_MIN + (e.clientY - box.top - (box.height - VB_SIZE * scale) / 2) / scale;
    const reach = STEP * 0.58;
    let best: Key | null = null;
    let bestD = reach * reach;
    for (const p of POINTS) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p.k;
      }
    }
    return best;
  };

  const entries = Object.entries(cells);
  const rings = entries
    .flatMap(([k, c]) => (c.kind === 'ring' ? [{ k, ...c }] : []))
    .sort((a, b) => a.id - b.id);
  const markers = entries.flatMap(([k, c]) => (c.kind === 'marker' ? [{ k, ...c }] : []));

  const ghostRing = active && you !== null && hover && phase === 'placing' && !cells[hover] ? hover : null;
  const ghostMove = active && you !== null && hover && targets.has(hover) ? hover : null;

  return (
    <svg
      ref={svgRef}
      className="board"
      viewBox={`${VB_MIN} ${VB_MIN} ${VB_SIZE} ${VB_SIZE}`}
      role="img"
      aria-label="Игровое поле"
    >
      <polygon className="plate" points={PLATE} />
      <g className="grid">
        {EDGES.map((e) => (
          <line key={e.id} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} />
        ))}
        {POINTS.map((p) => (
          <circle key={p.k} cx={p.x} cy={p.y} r={2.6} />
        ))}
      </g>

      {last && (
        <line
          className="trace"
          x1={at(last.from).x}
          y1={at(last.from).y}
          x2={at(last.to).x}
          y2={at(last.to).y}
        />
      )}

      {selected && ghostMove && (
        <line
          className={`path p${you}`}
          x1={at(selected).x}
          y1={at(selected).y}
          x2={at(ghostMove).x}
          y2={at(ghostMove).y}
        />
      )}

      {markers.map((m) => {
        const p = at(m.k);
        const flipping = willFlip.includes(m.k);
        const inRow = rowKeys.has(m.k);
        const lit = hoverRow?.includes(m.k);
        return (
          <g key={`${m.k}:${m.owner}`} transform={`translate(${p.x} ${p.y})`}>
            <circle
              className={`marker p${m.owner}${inRow ? ' in-row' : ''}${lit ? ' lit' : ''}`}
              r={13}
            />
            {flipping && <circle className={`flip-hint p${m.owner === 0 ? 1 : 0}`} r={6} />}
          </g>
        );
      })}

      {selected && you !== null && (
        <circle className={`marker seed p${you}`} cx={at(selected).x} cy={at(selected).y} r={13} />
      )}

      {rings.map((c) => {
        const p = at(c.k);
        const mine = c.owner === you;
        const cls = [
          'ring',
          `p${c.owner}`,
          selected === c.k ? 'selected' : '',
          active && mine && phase === 'claimRing' ? 'offer' : '',
        ].join(' ');
        return (
          <g key={c.id} className={cls} style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
            <circle className="ring-edge" r={19.5} />
            <circle className="ring-body" r={19.5} />
          </g>
        );
      })}

      {moves.map((m) => {
        const p = at(m.to);
        return <circle key={m.to} className={`target p${you}`} cx={p.x} cy={p.y} r={5.5} />;
      })}

      {goneRings.map((g) => {
        const p = at(g.k);
        return (
          <g key={`gone-${g.id}`} transform={`translate(${p.x} ${p.y})`}>
            <g className={`ring gone p${g.owner}`}>
              <circle className="ring-edge" r={19.5} />
              <circle className="ring-body" r={19.5} />
            </g>
          </g>
        );
      })}

      {(ghostRing ?? ghostMove) && you !== null && (
        <circle
          className={`ghost p${you}`}
          cx={at((ghostRing ?? ghostMove)!).x}
          cy={at((ghostRing ?? ghostMove)!).y}
          r={19.5}
        />
      )}

      {onAction && (
        <rect
          className="hits"
          x={VB_MIN}
          y={VB_MIN}
          width={VB_SIZE}
          height={VB_SIZE}
          onClick={(e) => {
            const k = pointAt(e);
            if (k) click(k);
          }}
          onPointerMove={(e) => {
            if (e.pointerType !== 'mouse') return;
            const k = pointAt(e);
            setHover(k);
            e.currentTarget.style.cursor = k && canClick(k) ? 'pointer' : '';
          }}
          onPointerLeave={() => setHover(null)}
        />
      )}
    </svg>
  );
}
