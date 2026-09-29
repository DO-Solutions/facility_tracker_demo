import { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ComplaintDetail } from '@/lib/api';

type Stage = {
  label: string;
  detail: string;
  at: string | null;
  /** True once this stage can no longer happen. */
  dead?: boolean;
};

function stages(c: ComplaintDetail): Stage[] {
  const failed = c.status === 'failed';
  return [
    { label: 'Submitted', detail: 'the form accepted it', at: c.submitted_at },
    { label: 'Webhook fired', detail: 'handed to Harness Runtime', at: c.dispatched_at ?? null, dead: failed },
    { label: 'Ticket written', detail: 'a microVM classified it and wrote the row', at: c.ticket?.created_at ?? null, dead: failed },
    { label: 'Issue opened', detail: 'filed in the tracker via Action Gateway', at: c.ticket?.issue_at ?? null, dead: failed && !c.ticket },
  ];
}

function human(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * The pipeline as it happens.
 *
 * Every stage after the first is work done by an agent in its own microVM,
 * on another machine. The elapsed figure keeps counting while a stage is
 * outstanding, which is the point: it shows the room what "a fresh sandbox
 * per complaint" actually costs in seconds.
 */
export function Progress({ complaint }: { complaint: ComplaintDetail }) {
  const [, tick] = useState(0);
  const steps = stages(complaint);
  const done = steps.every((s) => s.at) || complaint.status === 'failed';

  // Only run a clock while something is still outstanding.
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [done]);

  const start = new Date(complaint.submitted_at).getTime();

  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const prev = steps[i - 1];
        const reached = Boolean(s.at);
        const pending = !reached && !s.dead && (i === 0 || Boolean(prev?.at));
        const blocked = !reached && !pending;

        const from = i === 0 ? start : prev?.at ? new Date(prev.at).getTime() : null;
        const to = reached ? new Date(s.at as string).getTime() : Date.now();
        const delta = i === 0 ? 0 : from ? to - from : null;

        return (
          <li key={s.label} className="flex gap-3 pb-5 last:pb-0">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full border',
                  reached && 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
                  pending && 'border-primary/40 bg-primary/15 text-primary',
                  blocked && 'border-border text-muted-foreground/40',
                )}
              >
                {reached ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : pending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : complaint.status === 'failed' ? (
                  <X className="size-3.5" />
                ) : (
                  <span className="bg-muted-foreground/30 size-1.5 rounded-full" />
                )}
              </span>
              {i < steps.length - 1 && (
                <span className={cn('mt-1 w-px flex-1', reached ? 'bg-emerald-500/30' : 'bg-border')} />
              )}
            </div>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <span className={cn('text-sm font-medium', blocked && 'text-muted-foreground/50')}>
                  {s.label}
                </span>
                {i > 0 && delta !== null && (
                  <span
                    className={cn(
                      'tabular font-mono text-[11px]',
                      pending ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    +{human(delta)}
                  </span>
                )}
                {s.at && (
                  <span className="text-muted-foreground/60 tabular font-mono text-[11px]">
                    {new Date(s.at).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground mt-0.5 text-[12.5px]">{s.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export { human as humanDuration };
