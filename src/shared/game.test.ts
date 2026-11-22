import { describe, expect, it } from 'vitest';
import {
  ALL_KEYS,
  applyAction,
  findRows,
  newGame,
  ringMoves,
  type Action,
  type Cell,
  type GameState,
  type Player,
} from './game.ts';

const ring = (owner: Player, id: number): Cell => ({ kind: 'ring', owner, id });
const marker = (owner: Player): Cell => ({ kind: 'marker', owner });

function midgame(cells: Record<string, Cell>, turn: Player = 0): GameState {
  return { ...newGame(0), phase: 'moving', turn, ringsPlaced: [4, 4], cells };
}

function play(state: GameState, player: Player, action: Action): GameState {
  const res = applyAction(state, player, action);
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

describe('board', () => {
  it('has 85 points — a hexagon with cut corners', () => {
    expect(ALL_KEYS).toHaveLength(85);
    // The six corners of the full hexagon are not part of the field.
    for (const k of ['5,0', '0,5', '-5,5', '-5,0', '0,-5', '5,-5']) {
      expect(ALL_KEYS).not.toContain(k);
    }
    expect(ALL_KEYS).toContain('4,1');
    expect(ALL_KEYS).toContain('1,-5');
  });
});

describe('placing', () => {
  it('alternates and hands the first move to the opener', () => {
    let s = newGame(1);
    const spots = ['0,0', '1,0', '2,0', '3,0', '0,1', '1,1', '2,1', '3,1'];
    spots.forEach((at, i) => {
      const p: Player = i % 2 === 0 ? 1 : 0;
      expect(s.turn).toBe(p);
      s = play(s, p, { type: 'place', at });
    });
    expect(s.phase).toBe('moving');
    expect(s.turn).toBe(1);
  });

  it('rejects occupied points, off-board points and out-of-turn play', () => {
    const s = play(newGame(), 0, { type: 'place', at: '0,0' });
    expect(applyAction(s, 1, { type: 'place', at: '0,0' }).ok).toBe(false);
    expect(applyAction(s, 1, { type: 'place', at: '9,9' }).ok).toBe(false);
    expect(applyAction(s, 1, { type: 'place', at: '5,0' }).ok).toBe(false); // cut corner
    expect(applyAction(s, 0, { type: 'place', at: '1,0' }).ok).toBe(false);
  });
});

describe('ring moves', () => {
  it('slides over empty points and stops at the board edge', () => {
    const moves = ringMoves({ '-4,0': ring(0, 0) }, '-4,0');
    expect(moves.filter((m) => m.to.endsWith(',0') && m.jumped.length === 0)).toHaveLength(8);
  });

  it('lands on the first empty point behind jumped markers', () => {
    const cells = { '-2,0': ring(0, 0), '-1,0': marker(1), '0,0': marker(0) };
    const east = ringMoves(cells, '-2,0').filter((m) => m.jumped.length > 0);
    expect(east).toEqual([{ to: '1,0', jumped: ['-1,0', '0,0'] }]);
  });

  it('cannot pass rings', () => {
    const cells: Record<string, Cell> = {
      '-2,0': ring(0, 0),
      '-1,0': marker(1),
      '0,0': ring(1, 4),
      '-2,1': ring(1, 5),
    };
    const targets = ringMoves(cells, '-2,0').map((m) => m.to);
    expect(targets).not.toContain('1,0');
    expect(targets).not.toContain('-2,2');
  });

  it('leaves a marker behind and flips what it jumps', () => {
    const s = play(
      midgame({ '-2,0': ring(0, 0), '-1,0': marker(1), '0,0': marker(0), '3,-3': ring(1, 4) }),
      0,
      { type: 'move', from: '-2,0', to: '1,0' },
    );
    expect(s.cells['-2,0']).toEqual(marker(0));
    expect(s.cells['-1,0']).toEqual(marker(0));
    expect(s.cells['0,0']).toEqual(marker(1));
    expect(s.cells['1,0']).toEqual(ring(0, 0));
    expect(s.turn).toBe(1);
  });
});

describe('rows and rings', () => {
  const rowSetup = () =>
    midgame({
      '-1,0': ring(0, 0),
      '0,0': marker(0),
      '1,0': marker(0),
      '2,0': marker(0),
      '3,0': marker(0),
      '0,-3': ring(0, 1),
      '3,-3': ring(1, 4),
      '-3,3': ring(1, 5),
    });

  it('offers every window of a longer run', () => {
    const cells: Record<string, Cell> = {};
    for (let q = -2; q <= 3; q++) cells[`${q},0`] = marker(0);
    expect(findRows(cells, 0)).toHaveLength(2);
    expect(findRows(cells, 1)).toHaveLength(0);
  });

  it('clears a row of five and removes the chosen ring from the board', () => {
    let s = play(rowSetup(), 0, { type: 'move', from: '-1,0', to: '-1,1' });
    expect(s.phase).toBe('claimRow');
    expect(s.turn).toBe(0);

    s = play(s, 0, { type: 'claimRow', cells: ['3,0', '2,0', '1,0', '0,0', '-1,0'] });
    expect(s.phase).toBe('claimRing');
    expect(s.cells['0,0']).toBeUndefined();

    s = play(s, 0, { type: 'claimRing', at: '-1,1' });
    expect(s.cells['-1,1']).toBeUndefined();
    expect(s.last).toBeNull(); // the trace pointed at the removed ring
    expect(s.score).toEqual([1, 0]);
    expect(s.phase).toBe('moving');
    expect(s.turn).toBe(1);
  });

  it('lets the opponent claim a row the mover built for them', () => {
    const s = play(
      midgame({
        '-3,0': ring(0, 0),
        '-2,0': marker(0),
        '-1,0': marker(0),
        '0,0': marker(0),
        '1,0': marker(0),
        '2,0': marker(0),
        '0,-3': ring(0, 1),
        '-3,3': ring(1, 4),
      }),
      0,
      { type: 'move', from: '-3,0', to: '3,0' },
    );
    expect(s.phase).toBe('claimRow');
    expect(s.turn).toBe(1);
  });

  it('ends the game on the third removed ring', () => {
    let s = rowSetup();
    s.score = [2, 0];
    s = play(s, 0, { type: 'move', from: '-1,0', to: '-1,1' });
    s = play(s, 0, { type: 'claimRow', cells: ['-1,0', '0,0', '1,0', '2,0', '3,0'] });
    s = play(s, 0, { type: 'claimRing', at: '0,-3' });
    expect(s.phase).toBe('finished');
    expect(s.last).toEqual({ from: '-1,0', to: '-1,1' }); // another ring removed: trace stays
    expect(s.winner).toBe(0);
    expect(s.endReason).toBe('rings');
    expect(applyAction(s, 1, { type: 'resign' }).ok).toBe(false);
  });

  it('rejects a claim that is not a real row', () => {
    const s = play(rowSetup(), 0, { type: 'move', from: '-1,0', to: '-1,1' });
    expect(applyAction(s, 0, { type: 'claimRow', cells: ['0,0', '1,0', '2,0', '3,0', '4,0'] }).ok).toBe(false);
  });
});

describe('ending', () => {
  it('resigning hands the win to the other player at any time', () => {
    const s = play(newGame(), 1, { type: 'resign' });
    expect(s.winner).toBe(0);
    expect(s.endReason).toBe('resign');
  });

  it('ends by ring count when the next player is stuck', () => {
    // Player 1's only ring sits at the board edge, walled in by rings.
    const s = play(
      {
        ...midgame({
          '5,-1': ring(1, 4),
          '4,-1': ring(0, 1),
          '5,-2': ring(0, 2),
          '4,0': ring(0, 3),
          '0,0': ring(0, 0),
        }),
        score: [2, 1],
      },
      0,
      { type: 'move', from: '0,0', to: '0,1' },
    );
    expect(s.phase).toBe('finished');
    expect(s.endReason).toBe('blocked');
    expect(s.winner).toBe(0);
  });
});
