import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  PILLARS_TO_WIN,
  RINGS_PER_PLAYER,
  other,
  type Action,
  type Player,
} from '../shared/game.ts';
import { MAX_CHAT, type ChatMessage, type RoomView, type SeatView } from '../shared/protocol.ts';
import { Board } from './Board.tsx';
import { RulesList, Wordmark } from './rules.tsx';
import { useRoom } from './useRoom.ts';

// Players are anonymous; they are told apart by the colour of their pieces.
const SIDES = ['Янтарные', 'Фиолетовые'] as const;

function statusText(view: RoomView): string {
  const { game, seats, you } = view;
  if (!seats[0] || !seats[1]) return 'Ждём соперника';
  if (game.phase === 'finished') return 'Игра окончена';

  const mine = you === game.turn;
  const watching = you === null;
  const side = SIDES[game.turn];
  switch (game.phase) {
    case 'placing': {
      const left = RINGS_PER_PLAYER - game.ringsPlaced[game.turn];
      if (mine) return `Ваш ход: поставьте кольцо на любую точку. Осталось колец: ${left}`;
      return watching ? `${side} ставят кольцо` : 'Соперник ставит кольцо';
    }
    case 'moving':
      if (mine) return 'Ваш ход: нажмите на своё кольцо, затем на точку, куда его передвинуть';
      return watching ? `Ходят ${side.toLowerCase()}` : 'Ходит соперник';
    case 'claimRow':
      if (mine) return 'Четыре в ряд! Нажмите на ряд, чтобы снять фишки';
      return watching ? `${side} снимают ряд` : 'Соперник снимает ряд';
    case 'claimRing':
      if (mine) return 'Выберите кольцо, которое станет столбом';
      return watching ? `${side} ставят столб` : 'Соперник ставит столб';
  }
}

function outcome(view: RoomView): { title: string; reason: string } {
  const { game, you } = view;
  const winner = game.winner;
  let reason = 'Ходов не осталось — считаем столбы.';
  if (game.endReason === 'pillars') reason = 'Поставлены три столба.';
  if (game.endReason === 'resign' && winner !== 'draw' && winner !== null) {
    reason = you === null ? `${SIDES[other(winner)]} сдались.` : winner === you ? 'Соперник сдался.' : 'Вы сдались.';
  }
  if (winner === 'draw' || winner === null) return { title: 'Ничья', reason };
  if (you === null) return { title: `Победили ${SIDES[winner].toLowerCase()}`, reason };
  return { title: winner === you ? 'Вы победили' : 'Вы проиграли', reason };
}

function PlayerRow({ seat, player, view }: { seat: SeatView | null; player: Player; view: RoomView }) {
  const { game, you } = view;
  const live = game.phase !== 'finished' && view.seats[0] !== null && view.seats[1] !== null;
  const turn = live && game.turn === player;
  return (
    <li className={`player p${player}${turn ? ' turn' : ''}${seat ? '' : ' empty'}`}>
      <svg className="token" viewBox="-14 -14 28 28" aria-hidden="true">
        <circle r={9} />
      </svg>
      <div className="who">
        <span className="name">
          {SIDES[player]}
          {seat && you === player && <span className="you">это вы</span>}
        </span>
        <span className={`presence${seat?.online ? ' on' : ''}`}>
          <i aria-hidden="true" />
          {!seat ? 'место свободно' : seat.online ? 'в сети' : 'не в сети'}
        </span>
      </div>
      <div className="pillars" aria-label={`Столбов: ${game.score[player]} из ${PILLARS_TO_WIN}`}>
        {Array.from({ length: PILLARS_TO_WIN }, (_, i) => (
          <i key={i} className={i < game.score[player] ? 'got' : undefined} />
        ))}
      </div>
    </li>
  );
}

function Invite({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const canShare = typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      field.current?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <section className="card invite">
      <h2>Позовите соперника</h2>
      <p>Отправьте другу эту ссылку. Когда он её откроет, вы увидите это здесь, и игра начнётся.</p>
      <input
        ref={field}
        readOnly
        value={url}
        aria-label="Ссылка на игру"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="row">
        <button className="btn" onClick={copy}>
          {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
        </button>
        {canShare && (
          <button className="btn quiet" onClick={() => navigator.share({ title: 'Kolo', url }).catch(() => {})}>
            Поделиться
          </button>
        )}
      </div>
    </section>
  );
}

function Chat({
  messages,
  you,
  online,
  onSend,
  root,
}: {
  messages: ChatMessage[];
  you: Player;
  online: boolean;
  onSend: (text: string) => boolean;
  root: RefObject<HTMLElement | null>;
}) {
  const [text, setText] = useState('');
  const log = useRef<HTMLOListElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const line = text.trim();
    if (line && onSend(line)) setText('');
  };

  return (
    <section className="side chat" ref={root} aria-label="Чат с соперником">
      <h2>Чат</h2>
      <ol className="chat-log" ref={log} aria-live="polite">
        {messages.length === 0 && (
          <li className="chat-empty">Напишите сопернику. Переписку видите только вы двое.</li>
        )}
        {messages.map((m) => (
          <li key={m.id} className={`msg p${m.from}${m.from === you ? ' mine' : ''}`}>
            <span className="visually-hidden">{m.from === you ? 'Вы: ' : 'Соперник: '}</span>
            <span className="msg-text">{m.text}</span>
          </li>
        ))}
      </ol>
      <form className="chat-form" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_CHAT}
          placeholder="Сообщение"
          aria-label="Сообщение сопернику"
          autoComplete="off"
          enterKeyHint="send"
        />
        <button className="btn" disabled={!online || !text.trim()}>
          Отправить
        </button>
      </form>
    </section>
  );
}

export function Room({ id, go }: { id: string; go: (path: string) => void }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const seat = useRef<Player | null>(null);
  const chatBox = useRef<HTMLElement>(null);

  // A message from the opponent must not go unnoticed: count it in the tab title when the
  // tab is in the background, and show it as a toast when the chat is scrolled out of view.
  const onChat = (m: ChatMessage) => {
    if (m.from === seat.current) return;
    if (document.hidden) return setUnread((n) => n + 1);
    const box = chatBox.current?.getBoundingClientRect();
    const visible = !!box && box.top < innerHeight - 40 && box.bottom > 0;
    if (!visible) setNotice(`Соперник: ${m.text.length > 70 ? `${m.text.slice(0, 70)}…` : m.text}`);
  };

  const { view, chat, link, missing, error, send } = useRoom(id, onChat);
  const [confirmResign, setConfirmResign] = useState(false);
  const rules = useRef<HTMLDialogElement>(null);

  const you = view?.you ?? null;
  seat.current = you;
  const opp = view && you !== null ? view.seats[other(you)] : null;
  const bothSeated = !!view && view.seats[0] !== null && view.seats[1] !== null;
  const freeSeat = !!view && !bothSeated;
  const finished = view?.game.phase === 'finished';
  const myTurn = !!view && bothSeated && !finished && you !== null && view.game.turn === you;

  // Whoever opens the link takes the free seat straight away — no forms.
  useEffect(() => {
    if (view && you === null && freeSeat && link === 'open') send({ t: 'sit' });
  }, [view, you, freeSeat, link, send]);

  // Announce the opponent arriving, leaving and coming back.
  const seen = useRef<{ seated: boolean; online: boolean } | null>(null);
  useEffect(() => {
    if (!view || you === null) return;
    const now = { seated: opp !== null, online: !!opp?.online };
    const before = seen.current;
    seen.current = now;
    if (!before) return;
    if (!before.seated && now.seated) setNotice('Соперник в игре — начинаем');
    else if (before.online && !now.online) setNotice('Соперник не в сети');
    else if (before.seated && !before.online && now.online) setNotice('Соперник снова в сети');
  }, [view, you, opp]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const seen = () => {
      if (!document.hidden) setUnread(0);
    };
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, []);

  useEffect(() => {
    document.title = `${unread ? `(${unread}) ` : ''}${myTurn ? 'Ваш ход — Kolo' : 'Kolo'}`;
    return () => {
      document.title = 'Kolo';
    };
  }, [myTurn, unread]);

  useEffect(() => setConfirmResign(false), [view?.game.ply]);

  const home = (e: React.MouseEvent) => {
    e.preventDefault();
    go('/');
  };

  if (missing) {
    return (
      <div className="lonely">
        <a href="/" onClick={home}>
          <Wordmark small />
        </a>
        <h1>Такой игры нет</h1>
        <p>Ссылка устарела или в ней опечатка. Игры без игроков удаляются через сутки.</p>
        <button className="btn" onClick={() => go('/')}>
          Создать новую игру
        </button>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="lonely">
        <Wordmark small />
        <p>{link === 'lost' ? 'Нет связи с сервером. Пробуем ещё раз…' : 'Открываем игру…'}</p>
      </div>
    );
  }

  const { game } = view;
  const act = (action: Action) => send({ t: 'action', action });
  const result = finished ? outcome(view) : null;
  const iAsked = you !== null && view.rematch[you];
  const oppAsked = you !== null && view.rematch[other(you)];

  return (
    <div className="room">
      <header className="side side-top">
        <a href="/" onClick={home} className="brand">
          <Wordmark small />
        </a>

        <ul className="players">
          <PlayerRow seat={view.seats[0]} player={0} view={view} />
          <PlayerRow seat={view.seats[1]} player={1} view={view} />
        </ul>

        {!finished && (
          <p className={`status${myTurn ? ' mine' : ''}`} aria-live="polite">
            {statusText(view)}
          </p>
        )}

        {you !== null && freeSeat && <Invite url={location.href} />}

        {you === null && !freeSeat && <p className="note">Оба места заняты. Вы смотрите игру как зритель.</p>}

        {result && (
          <section className="card result" aria-live="polite">
            <h2>{result.title}</h2>
            <p>{result.reason}</p>
            {you !== null &&
              (iAsked ? (
                <p className="note">Ждём, пока соперник согласится на новую партию.</p>
              ) : (
                <>
                  {oppAsked && <p className="note">Соперник предлагает сыграть ещё раз.</p>}
                  <button className="btn" onClick={() => send({ t: 'rematch' })}>
                    {oppAsked ? 'Принять и сыграть ещё раз' : 'Сыграть ещё раз'}
                  </button>
                </>
              ))}
          </section>
        )}
      </header>

      <main className={`stage${freeSeat ? ' idle' : ''}`}>
        <Board game={game} you={you} active={myTurn && link === 'open'} onAction={act} />
      </main>

      {you !== null && (bothSeated || chat.length > 0) ? (
        <Chat
          messages={chat}
          you={you}
          online={link === 'open'}
          onSend={(text) => send({ t: 'chat', text })}
          root={chatBox}
        />
      ) : (
        <div className="side chat" />
      )}

      <footer className="side side-bottom">
        <button className="btn quiet" onClick={() => rules.current?.showModal()}>
          Правила
        </button>
        {you !== null &&
          bothSeated &&
          !finished &&
          (confirmResign ? (
            <>
              <button className="btn danger" onClick={() => act({ type: 'resign' })}>
                Да, сдаться
              </button>
              <button className="btn quiet" onClick={() => setConfirmResign(false)}>
                Играть дальше
              </button>
            </>
          ) : (
            <button className="btn quiet" onClick={() => setConfirmResign(true)}>
              Сдаться
            </button>
          ))}
      </footer>

      <dialog ref={rules} className="rules-dialog" onClick={(e) => e.target === rules.current && rules.current.close()}>
        <div className="rules-body">
          <h2>Правила</h2>
          <RulesList />
          <button className="btn" onClick={() => rules.current?.close()}>
            Понятно
          </button>
        </div>
      </dialog>

      <div className="toasts" aria-live="polite">
        {link === 'lost' && <p className="toast warn">Связь потеряна. Подключаемся заново…</p>}
        {error && <p className="toast warn">{error}</p>}
        {notice && <p className="toast">{notice}</p>}
      </div>
    </div>
  );
}
