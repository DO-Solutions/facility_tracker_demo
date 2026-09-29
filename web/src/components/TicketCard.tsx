import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { CloseTicketButton } from '@/components/CloseTicket';
import { Severity, SEVERITY_BAR } from '@/components/Severity';
import { cn } from '@/lib/utils';
import type { Ticket } from '@/lib/api';

/**
 * `closable` is off by default on purpose. This card is also what the
 * projected wall renders, and a Close button has no business being on a
 * screen the room is looking at.
 */
export function TicketCard({
  ticket: t,
  large = false,
  closable = false,
  onClosed,
}: {
  ticket: Ticket;
  large?: boolean;
  closable?: boolean;
  onClosed?: (t: Ticket) => void;
}) {
  return (
    <Card
      className={cn(
        'relative gap-0 overflow-hidden py-0 transition-colors',
        // The severity accent, as a pseudo-element so the card keeps its ring.
        'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[""]',
        SEVERITY_BAR[t.severity] ?? SEVERITY_BAR.P4,
        t.closed_at && 'opacity-60',
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-500',
        large ? 'p-5' : 'p-4',
      )}
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <Severity level={t.severity} />
        <Badge variant="secondary" className="font-normal">{t.component}</Badge>
        <Badge variant="outline" className="text-muted-foreground font-normal">
          {t.suggested_owner}
        </Badge>
      </div>

      <h3
        className={cn(
          'text-card-foreground leading-snug font-semibold tracking-tight',
          large ? 'text-[17px]' : 'text-[15px]',
        )}
      >
        {t.title}
      </h3>

      {t.complaint_body && (
        <p className="text-muted-foreground border-border mt-2.5 border-l-2 pl-3 text-[13px] italic">
          “{t.complaint_body}”
        </p>
      )}

      <div className="mt-3">
        <p className="text-muted-foreground/70 mb-1 text-[10px] font-semibold tracking-[0.1em] uppercase">
          Root cause hypothesis
        </p>
        <p className="text-card-foreground/85 text-[13px] leading-relaxed">
          {t.root_cause_hypothesis}
        </p>
      </div>

      <div className="border-border text-muted-foreground mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t pt-2.5 font-mono text-[11px]">
        <span className="tabular">{t.affected_users} affected</span>
        <span className="tabular">SLA {t.sla_hours}h</span>
        <span className="tabular">#{t.id}</span>
        {t.issue_url && (
          <a
            href={t.issue_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            GH #{t.issue_number}
            <ExternalLink className="size-3" />
          </a>
        )}
        {closable && (
          <span className="ml-auto">
            <CloseTicketButton ticket={t} onClosed={onClosed} className="h-6 px-2 text-[11px]" />
          </span>
        )}
      </div>
    </Card>
  );
}
