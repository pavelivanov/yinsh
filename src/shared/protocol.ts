import type { Action, GameState, Player } from './game.ts';

export interface SeatView {
  online: boolean;
}

export interface RoomView {
  id: string;
  /** Players are anonymous: a seat is either taken (and online or not) or free. */
  seats: [SeatView | null, SeatView | null];
  /** Your seat, or null while you are only watching. */
  you: Player | null;
  game: GameState;
  /** Who has asked for another game after this one ended. */
  rematch: [boolean, boolean];
  /** Games finished in this room, including rematches. */
  round: number;
}

export interface ChatMessage {
  /** Grows by one per message within a room. */
  id: number;
  from: Player;
  text: string;
  /** Server time, ms since epoch. */
  at: number;
}

export type ClientMsg =
  | { t: 'join'; room: string; token: string }
  | { t: 'sit' }
  | { t: 'action'; action: Action }
  | { t: 'rematch' }
  | { t: 'chat'; text: string };

export type ServerMsg =
  | { t: 'state'; view: RoomView }
  | { t: 'missing' }
  | { t: 'error'; message: string }
  /** Whole conversation so far; sent to a player when they take or re-take their seat. */
  | { t: 'history'; messages: ChatMessage[] }
  | { t: 'chat'; message: ChatMessage };

export const MAX_CHAT = 300;
export const MAX_CHAT_HISTORY = 200;

/** One line of plain text, or '' when there is nothing worth sending. */
export function cleanChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, MAX_CHAT)
    .trim();
}
