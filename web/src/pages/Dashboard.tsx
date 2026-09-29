import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Stat } from '@/components/Stat';
import { Section } from '@/components/AdminShell';
import { TicketCard } from '@/components/TicketCard';
import { api, type Stats, type Summary, type Ticket } from '@/lib/api';

export default function Dashboard({
  stats: liveStats, sessions, tickets: liveTickets, summaryTick,
}: {
  stats: Stats | null;
  sessions: { total: number; running: number; paused: number } | null;
  tickets: Ticket[];
  summaryTick: number;
}) {
  const [seedStats, setSeedStats] = useState<Stats | null>(null);
  const [seed, setSeed] = useState<Ticket[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  // Closing a ticket updates a row that arrives here from the live feed,
  // which this page does not own. Keep the closed copies locally and lay
  // them over whichever list is being rendered.
  const [closed, setClosed] = useState<Record<number, Ticket>>({});

  useEffect(() => {
    api.stats().then(setSeedStats);
    api.tickets({ limit: 12 }).then((d) => setSeed(d.tickets));
  }, []);

  useEffect(() => {
    api.summaries().then((d) => setSummary(d.summaries[0] ?? null));
  }, [summaryTick]);

  const stats = liveStats ?? seedStats;
  const tickets = liveTickets.length ? liveTickets : seed;
  const maxComponent = Math.max(1, ...(stats?.byComponent ?? []).map((c) => c.count));
  const maxOwner = Math.max(1, ...(stats?.byOwner ?? []).map((o) => o.count));

  async function generate() {
    setBusy(true);
    try {
      setSummary(await api.generateSummary());
      toast.success('Executive summary generated.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate the summary.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {(stats?.drifted ?? 0) > 0 && (
        <div className="border-destructive/40 bg-destructive/10 text-foreground mb-4 rounded-md border px-3.5 py-2.5 text-[13px]">
          <strong className="font-semibold">
            {stats?.drifted} ticket{stats?.drifted === 1 ? '' : 's'} no longer
            match{stats?.drifted === 1 ? 'es' : ''} its issue number
          </strong>{' '}
          (off by up to {stats?.driftMax}). GitHub never reuses a number, so one
          failed issue step puts the counters out of step permanently — every card
          after it cites the wrong issue. Re-align with{' '}
          <code className="font-mono text-[12px]">npm run db:reset -- --start-at N</code>{' '}
          or the Reset button, which does it for you.
        </div>
      )}

      <Section>Intake volume</Section>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(158px,1fr))] gap-3">
        <Stat label="Tickets filed" value={stats?.tickets ?? 0} tone="primary" />
        <Stat label="Complaints received" value={stats?.complaints ?? 0} />
        <Stat label="In flight" value={stats?.processing ?? 0} tone="warn" sub="being triaged now" />
        <Stat label="Failed" value={stats?.failed ?? 0} tone="bad" />
        <Stat
          label="MARS sessions"
          value={sessions?.total ?? '—'}
          sub={sessions ? `${sessions.running} running · ${sessions.paused} paused` : 'awaiting census'}
        />
        <Stat label="Pipeline" value={<span className="text-[19px]">harness</span>} sub="Action Gateway → GitHub" />
      </div>

      <Section>Latest tickets</Section>
      {tickets.length === 0 ? (
        <Empty>Nothing filed yet. Point the room at <code className="font-mono">/qr</code>.</Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-3">
          {tickets.slice(0, 12).map((t) => (
            <TicketCard
              key={t.id}
              ticket={closed[t.id] ?? t}
              closable
              onClosed={(next) => setClosed((c) => ({ ...c, [next.id]: next }))}
            />
          ))}
        </div>
      )}

      <div className="mt-2 grid gap-5 lg:grid-cols-2">
        <div>
          <Section>Volume by component</Section>
          <Breakdown
            rows={(stats?.byComponent ?? []).map((c) => ({ label: c.component, count: c.count }))}
            max={maxComponent}
            head="Component"
          />
        </div>
        <div>
          <Section>Queue by owner</Section>
          <Breakdown
            rows={(stats?.byOwner ?? []).map((o) => ({ label: o.owner, count: o.count }))}
            max={maxOwner}
            head="Team"
          />
        </div>
      </div>

      <Section>Executive summary</Section>
      {summary ? (
        <Card className="gap-0 px-7 py-6">
          <div className="border-border text-muted-foreground mb-4 flex flex-wrap justify-between gap-4 border-b pb-3 font-mono text-[11px] tracking-[0.1em] uppercase">
            <span>Operations summary</span>
            <span>{new Date(summary.generated_at).toLocaleString()}</span>
          </div>
          <p className="text-card-foreground/90 text-[14.5px] leading-relaxed">{summary.narrative}</p>
          <div className="border-primary bg-primary/10 text-foreground mt-4 rounded-r-md border-l-[3px] px-4 py-3 text-[14.5px]">
            <strong className="font-semibold">Headcount ask:</strong> {summary.headcount_ask}
          </div>
        </Card>
      ) : (
        <Empty>
          No summary generated yet.
          <div className="mt-3.5">
            <Button onClick={generate} disabled={busy}>
              {busy ? 'Generating…' : 'Generate now'}
            </Button>
          </div>
        </Empty>
      )}
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border text-muted-foreground rounded-lg border border-dashed py-12 text-center text-sm">
      {children}
    </div>
  );
}

function Breakdown({
  rows, max, head,
}: { rows: { label: string; count: number }[]; max: number; head: string }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-border bg-muted/40 border-b">
            <th className="text-muted-foreground px-3.5 py-2.5 text-left text-[10.5px] font-semibold tracking-[0.1em] uppercase">
              {head}
            </th>
            <th className="text-muted-foreground px-3.5 py-2.5 text-right text-[10.5px] font-semibold tracking-[0.1em] uppercase">
              Tickets
            </th>
            <th className="w-[34%]" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={3} className="text-muted-foreground px-3.5 py-3">No data yet.</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.label} className="border-border/60 hover:bg-accent/40 border-b last:border-0">
              <td className="px-3.5 py-2.5">{r.label}</td>
              <td className="tabular px-3.5 py-2.5 text-right">{r.count}</td>
              <td className="px-3.5 py-2.5">
                <div
                  className="bg-primary h-1.5 rounded-full"
                  style={{ width: `${Math.round((r.count / max) * 100)}%`, minWidth: 3 }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
