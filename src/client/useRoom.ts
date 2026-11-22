import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClientMsg, RoomView, ServerMsg } from '../shared/protocol.ts';
import { getToken } from './identity.ts';

export type Link = 'connecting' | 'open' | 'lost';

/**
 * Live connection to one game room. Reconnects on its own and re-takes your seat.
 * `onChat` fires for messages that arrive live, not for history replayed on (re)connect.
 */
export function useRoom(roomId: string, onChat?: (message: ChatMessage) => void) {
  const [view, setView] = useState<RoomView | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [link, setLink] = useState<Link>('connecting');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const chatListener = useRef(onChat);
  chatListener.current = onChat;

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      socket.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setLink('open');
        ws.send(JSON.stringify({ t: 'join', room: roomId, token: getToken() } satisfies ClientMsg));
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMsg;
        if (msg.t === 'state') setView(msg.view);
        else if (msg.t === 'history') setChat(msg.messages);
        else if (msg.t === 'chat') {
          const { message } = msg;
          setChat((list) => (list.some((m) => m.id === message.id) ? list : [...list, message]));
          chatListener.current?.(message);
        } else if (msg.t === 'error') setError(msg.message);
        else if (msg.t === 'missing') {
          stopped = true;
          setMissing(true);
          ws.close();
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        setLink('lost');
        timer = setTimeout(connect, Math.min(5000, 400 * 2 ** attempt++));
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [roomId]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3500);
    return () => clearTimeout(t);
  }, [error]);

  /** Returns false when there is no connection and nothing was sent. */
  const send = useCallback((msg: ClientMsg): boolean => {
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  return { view, chat, link, missing, error, send };
}
