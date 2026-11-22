import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, RoomView, ServerMsg } from '../shared/protocol.ts';
import { getToken } from './identity.ts';

export type Link = 'connecting' | 'open' | 'lost';

/** Live connection to one game room. Reconnects on its own and re-takes your seat. */
export function useRoom(roomId: string) {
  const [view, setView] = useState<RoomView | null>(null);
  const [link, setLink] = useState<Link>('connecting');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);

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
        else if (msg.t === 'error') setError(msg.message);
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

  const send = useCallback((msg: ClientMsg) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { view, link, missing, error, send };
}
