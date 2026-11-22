// Which sounds a change of position calls for. Pure, so it can be tested without a browser.

import type { GameState, Player } from '../shared/game.ts';

export type Cue =
  /** A new game begins: the opponent sat down, or a rematch started. */
  | { name: 'start' }
  | { name: 'place'; by: Player }
  /** A ring slides and lands; `flips` markers changed colour on the way. */
  | { name: 'move'; by: Player; flips: number }
  /** Five in a row appeared and waits to be taken off. */
  | { name: 'row' }
  /** The five markers leave the board. */
  | { name: 'rowOut' }
  /** A ring leaves the board — a point scored. */
  | { name: 'ringOut'; by: Player }
  | { name: 'win' }
  | { name: 'lose' }
  | { name: 'draw' };

const flipped = (prev: GameState, next: GameState): number => {
  let n = 0;
  for (const [k, c] of Object.entries(next.cells)) {
    const was = prev.cells[k];
    if (c.kind === 'marker' && was?.kind === 'marker' && was.owner !== c.owner) n += 1;
  }
  return n;
};

const ending = (next: GameState, you: Player | null): Cue => {
  if (next.winner === 'draw' || next.winner === null) return { name: 'draw' };
  // Spectators hear the cheerful ending whoever wins.
  return { name: you === null || next.winner === you ? 'win' : 'lose' };
};

/**
 * Sounds for going from `prev` to `next`, in the order they should be heard.
 * `prev` is null for the first position seen after loading or reconnecting — that is silent.
 */
export function cuesFor(prev: GameState | null, next: GameState, you: Player | null): Cue[] {
  if (!prev || prev === next) return [];
  if (next.ply === 0) return prev.ply > 0 ? [{ name: 'start' }] : [];
  if (next.ply <= prev.ply) return [];

  const finished = prev.phase !== 'finished' && next.phase === 'finished';
  // Several actions were missed (the connection dropped): only the ending still matters.
  if (next.ply !== prev.ply + 1) return finished ? [ending(next, you)] : [];
  if (next.endReason === 'resign') return [ending(next, you)];

  // Within one step the previous phase tells which action it was.
  const by = prev.turn;
  const cues: Cue[] = [];
  switch (prev.phase) {
    case 'placing':
      cues.push({ name: 'place', by });
      break;
    case 'moving':
      cues.push({ name: 'move', by, flips: flipped(prev, next) });
      if (next.phase === 'claimRow') cues.push({ name: 'row' });
      break;
    case 'claimRow':
      cues.push({ name: 'rowOut' });
      break;
    case 'claimRing':
      cues.push({ name: 'ringOut', by });
      break;
  }
  if (finished) cues.push(ending(next, you));
  return cues;
}
