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
 * it wipes everything; this closes one row. On stage the cost of an
 * accidental close is far lower than the cost of a modal between you and the
 * point you were making.
 *
 * It closes the ticket in the app only. The GitHub issue stays open until
 * Reset empties the tracker between run-throughs.
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

  if (ticket.closed_at) return <ClosedBadge />;

  async function run() {
    setBusy(true);
    try {
      const r = await api.closeTicket(ticket.id);
      onClosed?.(r.ticket);
      toast.success(`Ticket #${ticket.id} closed.`);
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

/** What replaces the button once the ticket is closed. */
export function ClosedBadge() {
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground gap-1 font-normal whitespace-nowrap"
      title="Ticket closed."
    >
      <Check className="size-3" />
      Closed
    </Badge>
  );
}
