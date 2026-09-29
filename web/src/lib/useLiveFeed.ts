import { useEffect, useRef, useState } from 'react';
import type { Stats, Ticket, Sessions } from './api';

type Feed = {
  tickets: Ticket[];
  stats: Stats | null;
  sessions: Sessions | null;
  live: boolean;
  /** Bumped whenever a summary lands, so pages can refetch. */
  summaryTick: number;
};

/**
 * One SSE connection, shared shape for the dashboard and the wall.
 *
 * The server discovers tickets by polling Postgres, because in production
 * the INSERT happens inside an agent sandbox on another machine. This hook
 * only has to render what arrives, dedupe it, and survive a reconnect.
 */
export function useLiveFeed(seed: Ticket[] = [], max = 24): Feed {
  const [tickets, setTickets] = useState<Ticket[]>(seed);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sessions, setSessions] = useState<Sessions | null>(null);
  const [live, setLive] = useState(false);
  const [summaryTick, setSummaryTick] = useState(0);
  const retry = useRef(1000);

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      if (closed) return;
      source = new EventSource('/api/stream');

      source.addEventListener('open', () => {
        retry.current = 1000;
        setLive(true);
      });

      source.addEventListener('ticket', (e) => {
        const t = JSON.parse((e as MessageEvent).data) as Ticket;
        setTickets((prev) =>
          // The same ticket can arrive twice across a reconnect.
          prev.some((x) => x.id === t.id) ? prev : [t, ...prev].slice(0, max),
        );
      });
      source.addEventListener('stats', (e) =>
        setStats(JSON.parse((e as MessageEvent).data) as Stats),
      );
      source.addEventListener('sessions', (e) =>
        setSessions(JSON.parse((e as MessageEvent).data) as Sessions),
      );
      source.addEventListener('summary', () => setSummaryTick((n) => n + 1));

      source.addEventListener('error', () => {
        setLive(false);
        source?.close();
        // Back off to 15s so a server restart mid-talk recovers quietly.
        retry.current = Math.min(retry.current * 2, 15000);
        timer = setTimeout(connect, retry.current);
      });
    };

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [max]);

  return { tickets, stats, sessions, live, summaryTick };
}
