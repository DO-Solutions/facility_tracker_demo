import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, type Ticket } from '@/lib/api';

/**
 * Close one ticket.
 *
 * No confirmation dialog, deliberately. Reset asks you to type a word because
 * it wipes everything; this closes one row and reopening an issue is a click
 * in GitHub. On stage the cost of an accidental close is far lower than the
 * cost of a modal between you and the point you were making.
 *
 * The ticket closes immediately. Its GitHub issue closes a minute or so
 * later, because only a trigger-started session can reach Action Gateway —
 * so the toast says which of the two just happened.
 */
export function CloseTicketButton({
  ticket,
  onClosed,
  className,
}: {
  ticket: Ticket;
  onClosed?: (t: Ticket) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  if (ticket.closed_at) return <ClosedBadge ticket={ticket} />;

  async function run() {
    setBusy(true);
    try {
      const r = await api.closeTicket(ticket.id);
      onClosed?.(r.ticket);
      toast.success(`Ticket #${ticket.id} closed.`, {
        description:
          r.tracker === 'closing'
            ? `An agent is closing issue #${ticket.issue_number} in the tracker.`
            : r.tracker === 'already closed'
              ? 'The tracker issue was already closed.'
              : `Tracker: ${r.tracker}`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not close the ticket.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={run} className={className}>
      {busy ? (
        <>
          <Loader2 className="size-3 animate-spin" />
          Closing…
        </>
      ) : (
        'Close'
      )}
    </Button>
  );
}

/**
 * What replaces the button. `closed_at` is ours and is already true;
 * `issue_closed_at` is the agent's and lands a minute later, so until it does
 * the badge says the tracker is still catching up rather than claiming both.
 */
export function ClosedBadge({ ticket }: { ticket: Ticket }) {
  const trackerPending = ticket.issue_number != null && !ticket.issue_closed_at;

  return (
    <Badge
      variant="outline"
      className="text-muted-foreground gap-1 font-normal whitespace-nowrap"
      title={
        trackerPending
          ? 'Ticket closed. An agent is still closing the GitHub issue.'
          : 'Ticket closed.'
      }
    >
      {trackerPending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Check className="size-3" />
      )}
      Closed
    </Badge>
  );
}
