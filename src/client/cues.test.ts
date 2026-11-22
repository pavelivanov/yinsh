import { describe, expect, it } from 'vitest';
import { applyAction, newGame, type Action, type Cell, type GameState, type Player } from '../shared/game.ts';
import { cuesFor } from './cues.ts';

const ring = (owner: Player, id: number): Cell => ({ kind: 'ring', owner, id });
const marker = (owner: Player): Cell => ({ kind: 'marker', owner });

function midgame(cells: Record<string, Cell>, score: [number, number] = [0, 0]): GameState {
  return { ...newGame(0), phase: 'moving', ringsPlaced: [4, 4], cells, score, ply: 20 };
}

function step(state: GameState, player: Player, action: Action): GameState {
  const res = applyAction(state, player, action);
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

/** Player 0 is one ring move away from five in a row along r = 0. */
const almostRow = (score: [number, number] = [0, 0]) =>
  midgame(
    {
      '-2,0': marker(0),
      '-1,0': marker(0),
      '0,0': marker(0),
      '1,0': marker(0),
      '2,0': ring(0, 0),
      '0,3': ring(0, 1),
      '0,-3': ring(1, 4),
    },
    score,
  );

describe('cuesFor', () => {
  it('is silent for the first position seen and for an unchanged one', () => {
    const g = newGame();
    expect(cuesFor(null, g, 0)).toEqual([]);
    expect(cuesFor(g, g, 0)).toEqual([]);
    // Presence updates resend the same position as a new object.
    expect(cuesFor(g, structuredClone(g), 0)).toEqual([]);
    const later = almostRow();
    expect(cuesFor(later, structuredClone(later), 1)).toEqual([]);
  });

  it('knocks when a ring is placed, in the voice of whoever placed it', () => {
    const a = newGame(1);
    const b = step(a, 1, { type: 'place', at: '0,0' });
    expect(cuesFor(a, b, 0)).toEqual([{ name: 'place', by: 1 }]);
  });

  it('counts the markers a ring turns over', () => {
    const a = midgame({
      '0,0': ring(0, 0),
      '1,0': marker(1),
      '2,0': marker(0),
      '0,3': ring(1, 4),
    });
    const b = step(a, 0, { type: 'move', from: '0,0', to: '3,0' });
    expect(cuesFor(a, b, 1)).toEqual([{ name: 'move', by: 0, flips: 2 }]);
  });

  it('follows a row from appearing to the ring leaving', () => {
    const a = almostRow();
    const b = step(a, 0, { type: 'move', from: '2,0', to: '3,0' });
    expect(cuesFor(a, b, 0)).toEqual([{ name: 'move', by: 0, flips: 0 }, { name: 'row' }]);

    const c = step(b, 0, { type: 'claimRow', cells: ['-2,0', '-1,0', '0,0', '1,0', '2,0'] });
    expect(cuesFor(b, c, 0)).toEqual([{ name: 'rowOut' }]);

    const d = step(c, 0, { type: 'claimRing', at: '3,0' });
    expect(cuesFor(c, d, 0)).toEqual([{ name: 'ringOut', by: 0 }]);
  });

  it('ends the game with a sound that depends on who listens', () => {
    const a = almostRow([2, 0]);
    const b = step(a, 0, { type: 'move', from: '2,0', to: '3,0' });
    const c = step(b, 0, { type: 'claimRow', cells: ['-2,0', '-1,0', '0,0', '1,0', '2,0'] });
    const d = step(c, 0, { type: 'claimRing', at: '3,0' });
    expect(d.phase).toBe('finished');
    expect(cuesFor(c, d, 0)).toEqual([{ name: 'ringOut', by: 0 }, { name: 'win' }]);
    expect(cuesFor(c, d, 1)).toEqual([{ name: 'ringOut', by: 0 }, { name: 'lose' }]);
    expect(cuesFor(c, d, null)).toEqual([{ name: 'ringOut', by: 0 }, { name: 'win' }]);
  });

  it('plays only the ending when someone resigns', () => {
    const a = almostRow();
    // Resigning is allowed out of turn.
    const b = step(a, 1, { type: 'resign' });
    expect(cuesFor(a, b, 1)).toEqual([{ name: 'lose' }]);
    expect(cuesFor(a, b, 0)).toEqual([{ name: 'win' }]);
  });

  it('announces a rematch', () => {
    const over = step(almostRow(), 0, { type: 'resign' });
    expect(cuesFor(over, newGame(1), 0)).toEqual([{ name: 'start' }]);
  });

  it('does not replay moves missed while offline, except the ending', () => {
    const a = almostRow([2, 0]);
    const b = step(a, 0, { type: 'move', from: '2,0', to: '3,0' });
    const c = step(b, 0, { type: 'claimRow', cells: ['-2,0', '-1,0', '0,0', '1,0', '2,0'] });
    const d = step(c, 0, { type: 'claimRing', at: '3,0' });
    expect(cuesFor(a, c, 1)).toEqual([]);
    expect(cuesFor(a, d, 1)).toEqual([{ name: 'lose' }]);
  });
});
