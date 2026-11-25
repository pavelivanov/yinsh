import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  RINGS_PER_PLAYER,
  RINGS_TO_WIN,
  other,
  type Action,
  type GameState,
  type Player,
} from '../shared/game.ts';
import { MAX_CHAT, type ChatMessage, type RoomView, type SeatView } from '../shared/protocol.ts';
import { Board } from './Board.tsx';
import { cuesFor } from './cues.ts';
import { RulesList, Wordmark } from './rules.tsx';
import { play, useMuted } from './sound.ts';
import { useRoom } from './useRoom.ts';

// Players are anonymous; they are told apart by the colour of their pieces.
const SIDES = ['Янтарные', 'Фиолетовые'] as const;

/** The chat opens by itself only where it fits beside the board. */
const ROOMY = '(min-aspect-ratio: 8/5) and (min-width: 1100px)';

function outcome(view: RoomView): string {
  const { game, you } = view;
  const winner = game.winner;
  let reason = 'Ходов не осталось.';
  if (game.endReason === 'rings') reason = 'Три кольца сняты.';
  if (game.endReason === 'resign' && winner !== 'draw' && winner !== null) {
    reason = you === null ? `${SIDES[other(winner)]} сдались.` : winner === you ? 'Соперник сдался.' : 'Вы сдались.';
  }
  if (winner === 'draw' || winner === null) return `${reason} Ничья`;
  if (you === null) return `${reason} Победили ${SIDES[winner].toLowerCase()}`;
  return `${reason} ${winner === you ? 'Вы победили' : 'Вы проиграли'}`;
}

function statusText(view: RoomView): string {
  const { game, seats, you } = view;
  if (!seats[0] || !seats[1]) return 'Ждём соперника';

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
      if (mine) return 'Пять в ряд! Нажмите на ряд, чтобы снять фишки';
      return watching ? `${side} снимают ряд` : 'Соперник снимает ряд';
    case 'claimRing':
      if (mine) return 'Ряд снят. Выберите своё кольцо, которое уйдёт с поля';
      return watching ? `${side} снимают кольцо` : 'Соперник снимает кольцо';
    case 'finished':
      return outcome(view);
  }
}

function PlayerPill({ seat, player, view }: { seat: SeatView | null; player: Player; view: RoomView }) {
  const { game, you } = view;
  const live = game.phase !== 'finished' && view.seats[0] !== null && view.seats[1] !== null;
  const turn = live && game.turn === player;
  return (
    <li className={`player p${player}${turn ? ' turn' : ''}${seat ? '' : ' empty'}`}>
      <svg className="token" viewBox="-14 -14 28 28" aria-hidden="true">
        <circle r={9.5} />
      </svg>
      <div className="who">
        <span className="name">
          {SIDES[player]}
          {seat && you === player && <span className="you">вы</span>}
        </span>
        <span className={`presence${seat?.online ? ' on' : ''}`}>
          <i aria-hidden="true" />
          {!seat ? 'место свободно' : seat.online ? 'в сети' : 'не в сети'}
        </span>
      </div>
      <div className="rings" aria-label={`Снято колец: ${game.score[player]} из ${RINGS_TO_WIN}`}>
        {Array.from({ length: RINGS_TO_WIN }, (_, i) => (
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
    <section className="float invite">
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
  open,
  fresh,
  onToggle,
  onSend,
}: {
  messages: ChatMessage[];
  you: Player;
  online: boolean;
  open: boolean;
  /** Messages from the opponent that arrived while the chat was closed. */
  fresh: number;
  onToggle: (open: boolean) => void;
  onSend: (text: string) => boolean;
}) {
  const [text, setText] = useState('');
  const log = useRef<HTMLOListElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const line = text.trim();
    if (line && onSend(line)) setText('');
  };

  if (!open) {
    const last = messages.at(-1);
    return (
      <button className="float chat-toggle" onClick={() => onToggle(true)} aria-expanded="false">
        Чат
        {last && <span className={`chat-peek${fresh ? ' fresh' : ''}`}>{last.text}</span>}
        {fresh > 0 && <span className="visually-hidden">Новых сообщений: {fresh}</span>}
      </button>
    );
  }

  return (
    <section className="float chat" aria-label="Чат с соперником">
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
        <button className="round send" disabled={!online || !text.trim()} aria-label="Отправить">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" />
          </svg>
        </button>
        <button type="button" className="round" onClick={() => onToggle(false)} aria-label="Свернуть чат">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m5 5 6 6m0-6-6 6" />
          </svg>
        </button>
      </form>
    </section>
  );
}

function SoundToggle() {
  const [muted, setMuted] = useMuted();
  return (
    <button
      className="link icon"
      aria-pressed={!muted}
      aria-label="Звук"
      title={muted ? 'Звук выключен' : 'Звук включён'}
      onClick={() => {
        setMuted(!muted);
        if (muted) play({ name: 'select' });
      }}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path className="solid" d="M3 7.75h2.75L10 4.25v11.5l-4.25-3.5H3z" />
        {muted ? (
          <path d="m13 7.75 4.5 4.5m0-4.5-4.5 4.5" />
        ) : (
          <path d="M13 7a4.2 4.2 0 0 1 0 6m2.2-8.2a7.4 7.4 0 0 1 0 10.4" />
        )}
      </svg>
    </button>
  );
}

export function Room({ id, go }: { id: string; go: (path: string) => void }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [chatOpen, setChatOpen] = useState(() => matchMedia(ROOMY).matches);
  const [fresh, setFresh] = useState(0);
  const seat = useRef<Player | null>(null);
  const chatShown = useRef(chatOpen);
  chatShown.current = chatOpen;

  // A message from the opponent must not go unnoticed: it is heard, counted in the tab title
  // when the tab is in the background, and marked on the chat button while the chat is closed.
  const onChat = (m: ChatMessage) => {
    if (m.from === seat.current) return;
    play({ name: 'chat' });
    if (document.hidden) setUnread((n) => n + 1);
    if (!chatShown.current) setFresh((n) => n + 1);
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
    if (!before.seated && now.seated) {
      setNotice('Соперник в игре — начинаем');
      play({ name: 'start' });
    } else if (before.online && !now.online) setNotice('Соперник не в сети');
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

  // Every change on the board is heard, whoever made it. The position seen first — after
  // loading the page or reconnecting — is silent.
  const game = view?.game;
  const heard = useRef<GameState | null>(null);
  useEffect(() => {
    if (!game) return;
    play(...cuesFor(heard.current, game, you));
    heard.current = game;
  }, [game, you]);

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

  const act = (action: Action) => send({ t: 'action', action });
  const iAsked = you !== null && view.rematch[you];
  const oppAsked = you !== null && view.rematch[other(you)];
  // The dot in the status shows whose move it is, or who won.
  const { winner } = view.game;
  const dot = !bothSeated ? null : finished ? (winner === 'draw' ? null : winner) : view.game.turn;
  // Your own side sits nearest to the edge of the screen, like your side of a table.
  const order: Player[] = you === 0 ? [1, 0] : [0, 1];

  const toggleChat = (open: boolean) => {
    setChatOpen(open);
    setFresh(0);
  };

  return (
    <div className={`room${freeSeat ? ' idle' : ''}`}>
      <header className="top">
        <a href="/" onClick={home} className="brand">
          <Wordmark small />
        </a>

        <div className="top-mid">
          <div className={`float status${myTurn || finished ? ' strong' : ''}`} aria-live="polite">
            {dot !== null && <i className={`dot p${dot}`} aria-hidden="true" />}
            <span>{statusText(view)}</span>
            {finished &&
              you !== null &&
              (iAsked ? (
                <span className="waiting">Ждём ответа соперника</span>
              ) : (
                <button className="again" onClick={() => send({ t: 'rematch' })}>
                  {oppAsked ? 'Принять реванш' : 'Сыграть ещё раз'}
                </button>
              ))}
          </div>
        </div>

        <nav className="actions">
          <SoundToggle />
          <button className="link" onClick={() => rules.current?.showModal()}>
            Правила
          </button>
          {you !== null &&
            bothSeated &&
            !finished &&
            (confirmResign ? (
              <>
                <button className="link danger" onClick={() => act({ type: 'resign' })}>
                  Да, сдаться
                </button>
                <button className="link" onClick={() => setConfirmResign(false)}>
                  Нет
                </button>
              </>
            ) : (
              <button className="link soft" onClick={() => setConfirmResign(true)}>
                Сдаться
              </button>
            ))}
        </nav>
      </header>

      <main className="stage">
        <Board game={view.game} you={you} active={myTurn && link === 'open'} onAction={act} />
      </main>

      {you !== null && freeSeat && <Invite url={location.href} />}

      <ul className="players">
        {order.map((p) => (
          <PlayerPill key={p} seat={view.seats[p]} player={p} view={view} />
        ))}
      </ul>

      <div className="corner">
        {you !== null && (bothSeated || chat.length > 0) && (
          <Chat
            messages={chat}
            you={you}
            online={link === 'open'}
            open={chatOpen}
            fresh={fresh}
            onToggle={toggleChat}
            onSend={(text) => send({ t: 'chat', text })}
          />
        )}
        {you === null && !freeSeat && <p className="float hint">Оба места заняты — вы зритель</p>}
      </div>

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
