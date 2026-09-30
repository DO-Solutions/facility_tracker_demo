import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Section } from '@/components/AdminShell';
import { api, type Summary } from '@/lib/api';
import { useSummaryRequest } from '@/lib/useSummaryRequest';

export default function SummaryPage({ summaryTick }: { summaryTick: number }) {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const { pending, request } = useSummaryRequest(summaryTick);

  useEffect(() => { api.summaries().then((d) => setSummaries(d.summaries)); }, [summaryTick]);

  return (
    <>
      <div className="flex items-center gap-4">
        <Section>Executive summaries</Section>
        <div className="flex-1" />
        <Button onClick={request} disabled={pending} className="mt-8 mb-3">
          {pending ? 'Agent writing…' : 'Generate now'}
        </Button>
      </div>

      <p className="text-muted-foreground mb-5 text-[13.5px]">
        Hands the ticket volumes to an agent, which writes the closing summary — total tickets,
        the top three components, and a straight-faced headcount ask. It lands in about a
        minute; press it a little before you want the ending.
      </p>

      {summaries.length === 0 && (
        <div className="border-border text-muted-foreground rounded-lg border border-dashed py-12 text-center text-sm">
          No summaries yet.
        </div>
      )}

      {summaries.map((s) => (
        <Card key={s.id} className="mb-4 gap-0 px-7 py-6">
          <div className="border-border text-muted-foreground mb-4 flex flex-wrap justify-between gap-4 border-b pb-3 font-mono text-[11px] tracking-[0.1em] uppercase">
            <span>Operations summary · {s.total_tickets} tickets</span>
            <span>{new Date(s.generated_at).toLocaleString()}</span>
          </div>

          <h3 className="mb-2 text-[17px] font-semibold tracking-tight">Top components by volume</h3>
          <ol className="text-card-foreground/90 mb-4 list-decimal pl-5 text-sm">
            {s.top_components.length === 0 && (
              <li className="text-muted-foreground">No ticket volume in period.</li>
            )}
            {s.top_components.map((c) => (
              <li key={c.component} className="mb-1">
                <strong className="font-semibold">{c.component}</strong> — {c.count} tickets
              </li>
            ))}
          </ol>

          <h3 className="mb-2 text-[17px] font-semibold tracking-tight">Narrative</h3>
          <p className="text-card-foreground/90 text-[14.5px] leading-relaxed">{s.narrative}</p>

          <div className="border-primary bg-primary/10 text-foreground mt-4 rounded-r-md border-l-[3px] px-4 py-3 text-[14.5px]">
            <strong className="font-semibold">Headcount ask:</strong> {s.headcount_ask}
          </div>
        </Card>
      ))}
    </>
  );
}
