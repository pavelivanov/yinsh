import { useEffect, useMemo, useState } from 'react';
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

const STEP = 56;
const ROW_H = (STEP * Math.sqrt(3)) / 2;

const at = (k: Key) => {
  const [q, r] = parseKey(k);
  return { x: STEP * (q + r / 2), y: ROW_H * r };
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

// Hexagonal plate under the grid, a little wider than the outermost points.
const PLATE = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 3) * i;
  const r = STEP * 4 + 26;
  return `${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`;
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

  useEffect(() => setSelected(null), [game.ply, active]);

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
      if (ownRing(k)) setSelected(selected === k ? null : k);
      else if (selected && targets.has(k)) onAction({ type: 'move', from: selected, to: k });
      else setSelected(null);
    } else if (phase === 'claimRow') {
      const row = pickRow(rows, k);
      if (row) onAction({ type: 'claimRow', cells: row });
    } else if (phase === 'claimRing') {
      if (ownRing(k)) onAction({ type: 'claimRing', at: k });
    }
  };

  const entries = Object.entries(cells);
  const rings = entries
    .flatMap(([k, c]) => (c.kind === 'ring' ? [{ k, ...c }] : []))
    .sort((a, b) => a.id - b.id);
  const pillars = entries.flatMap(([k, c]) => (c.kind === 'pillar' ? [{ k, ...c }] : []));
  const markers = entries.flatMap(([k, c]) => (c.kind === 'marker' ? [{ k, ...c }] : []));

  const ghostRing = active && you !== null && hover && phase === 'placing' && !cells[hover] ? hover : null;
  const ghostMove = active && you !== null && hover && targets.has(hover) ? hover : null;

  return (
    <svg className="board" viewBox="-262 -232 524 464" role="img" aria-label="Игровое поле">
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

      {pillars.map((c) => {
        const p = at(c.k);
        return (
          <g key={c.id} className={`pillar p${c.owner}`} transform={`translate(${p.x} ${p.y})`}>
            <circle className="pillar-body" r={21} />
            <circle className="pillar-eye" r={6.5} />
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

      {(ghostRing ?? ghostMove) && you !== null && (
        <circle
          className={`ghost p${you}`}
          cx={at((ghostRing ?? ghostMove)!).x}
          cy={at((ghostRing ?? ghostMove)!).y}
          r={19.5}
        />
      )}

      {onAction && (
        <g className="hits">
          {POINTS.map((p) => (
            <circle
              key={p.k}
              cx={p.x}
              cy={p.y}
              r={STEP * 0.5}
              className={canClick(p.k) ? 'can' : undefined}
              onClick={() => click(p.k)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(p.k)}
              onPointerLeave={() => setHover((h) => (h === p.k ? null : h))}
            />
          ))}
        </g>
      )}
    </svg>
  );
}
