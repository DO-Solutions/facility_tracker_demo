import { useEffect, useState } from 'react';
import { TicketCard } from '@/components/TicketCard';
import { LiveDot } from '@/components/LiveDot';
import { useLiveFeed } from '@/lib/useLiveFeed';
import { api, type Stats, type Ticket } from '@/lib/api';

/** The projector view. Big numbers, big cards, nothing to click. */
export default function Wall() {
  const [seed, setSeed] = useState<Ticket[]>([]);
  const [seedStats, setSeedStats] = useState<Stats | null>(null);
  const [ready, setReady] = useState(false);
  const { tickets, stats: liveStats, sessions, live } = useLiveFeed(seed, 24);

  useEffect(() => {
    api.tickets({ limit: 12 }).then((d) => {
      setSeed(d.tickets);
      setReady(true);
    });
    // Seed the counters too. The watcher only pushes stats when they change,
    // so a wall opened on a quiet room would otherwise read zero next to a
    // screen full of cards.
    api.stats().then(setSeedStats);
  }, []);

  const stats = liveStats ?? seedStats;
  const shown = tickets.length ? tickets : seed;

  return (
    <main className="dark bg-background text-foreground min-h-dvh px-6 py-5">
      <header className="mb-5 flex flex-wrap items-baseline gap-5">
        <h1 className="text-[clamp(21px,2.5vw,31px)] font-semibold tracking-tighter">
          Facility Issue Tracker
        </h1>
        <LiveDot live={live} />

        <div className="ml-auto flex flex-wrap gap-7 text-right">
          <Count value={stats?.tickets ?? 0} label="Tickets filed" accent />
          <Count value={stats?.processing ?? 0} label="In flight" />
          <Count value={sessions?.total ?? '—'} label="MARS sessions" />
        </div>
      </header>

      {ready && shown.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-lg border border-dashed py-14 text-center text-sm">
          Waiting for the first grievance.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(370px,1fr))] gap-3">
          {shown.map((t) => (
            <TicketCard key={t.id} ticket={t} large />
          ))}
        </div>
      )}
    </main>
  );
}

function Count({
  value, label, accent = false,
}: { value: number | string; label: string; accent?: boolean }) {
  return (
    <div>
      <p
        className={`tabular text-[clamp(25px,3.4vw,42px)] leading-none font-semibold tracking-tighter ${
          accent ? 'text-primary' : 'text-foreground'
        }`}
      >
        {value}
      </p>
      <p className="text-muted-foreground mt-1.5 text-[10.5px] font-semibold tracking-[0.13em] uppercase">
        {label}
      </p>
    </div>
  );
}
