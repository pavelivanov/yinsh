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

export type ClientMsg =
  | { t: 'join'; room: string; token: string }
  | { t: 'sit' }
  | { t: 'action'; action: Action }
  | { t: 'rematch' };

export type ServerMsg =
  | { t: 'state'; view: RoomView }
  | { t: 'missing' }
  | { t: 'error'; message: string };
