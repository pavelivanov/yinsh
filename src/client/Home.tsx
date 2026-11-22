import { useState } from 'react';
import { newGame, type Cell, type GameState } from '../shared/game.ts';
import { Board } from './Board.tsx';
import { getToken } from './identity.ts';
import { RulesList, Wordmark } from './rules.tsx';

// A position from the middle of a game, shown as an illustration.
const DEMO: GameState = (() => {
  const cells: Record<string, Cell> = {
    '0,-2': { kind: 'ring', owner: 0, id: 0 },
    '2,1': { kind: 'ring', owner: 0, id: 1 },
    '-3,1': { kind: 'ring', owner: 0, id: 2 },
    '-1,-2': { kind: 'pillar', owner: 0, id: 3 },
    '1,-3': { kind: 'ring', owner: 1, id: 4 },
    '-2,3': { kind: 'ring', owner: 1, id: 5 },
    '3,-1': { kind: 'ring', owner: 1, id: 6 },
    '0,2': { kind: 'pillar', owner: 1, id: 7 },
  };
  const markers: [string, 0 | 1][] = [
    ['-1,0', 0],
    ['0,0', 0],
    ['1,0', 0],
    ['1,-1', 0],
    ['-2,2', 0],
    ['-2,0', 1],
    ['0,1', 1],
    ['1,1', 1],
    ['-1,1', 1],
    ['2,-1', 1],
    ['0,-1', 1],
  ];
  for (const [k, owner] of markers) cells[k] = { kind: 'marker', owner };
  return { ...newGame(), phase: 'moving', cells, score: [1, 1], ringsPlaced: [4, 4] };
})();

export function Home({ go }: { go: (path: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: getToken() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { id } = (await res.json()) as { id: string };
      go(`/g/${id}`);
    } catch {
      setError('Игра не создалась. Проверьте соединение и нажмите ещё раз.');
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <div className="home-copy">
        <h1>
          <Wordmark />
        </h1>
        <p className="lede">
          Стратегия на двоих: кольца, фишки и столбы. Создайте игру и отправьте другу ссылку — он откроет её и
          сразу окажется за доской. Без регистрации и имён.
        </p>

        <div className="start">
          <button className="btn big" onClick={create} disabled={busy}>
            {busy ? 'Создаём игру' : 'Создать игру'}
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <h2>Как играть</h2>
        <RulesList />
      </div>

      <div className="home-board" aria-hidden="true">
        <Board game={DEMO} you={null} active={false} />
      </div>
    </div>
  );
}
