import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

/**
 * Wipes the demo between rehearsals.
 *
 * It sits in the nav a few pixels from Sign out, which is a dangerous place
 * for something irreversible, so the confirmation asks you to type the word
 * rather than click a second button in roughly the same spot.
 */
export function ResetButton() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await api.reset();
      toast.success(`Database wiped. Next ticket #${r.nextTicket}.`, {
        description: `Tracker: ${r.tracker}.`,
      });
      setOpen(false);
      setTyped('');
      // Every page holds its own copy of the data, so reload rather than
      // try to invalidate each of them from the nav.
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed.');
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        setOpen(o);
        if (!o) setTyped('');
      }}
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Reset demo
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset the demo?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                Deletes every complaint, ticket and summary. This cannot be undone.
              </p>
              <p>
                Every issue in the tracker is <strong>deleted</strong>, not just closed, so the
                next run-through starts on an empty board. Ticket numbering continues from
                GitHub's next issue number, so ticket #N stays issue #N.
              </p>
              <p className="text-muted-foreground text-[13px]">
                Deleting needs a credential the demo itself does not have — the agents can only
                open and close issues. Reset is stage machinery, not part of the demo.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div>
          <Label htmlFor="reset-confirm" className="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.06em] uppercase">
            Type <span className="text-foreground font-mono">reset</span> to confirm
          </Label>
          <Input
            id="reset-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="reset"
            autoComplete="off"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typed === 'reset' && !busy) run();
            }}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={typed !== 'reset' || busy}
            onClick={(e) => {
              // Keep the dialog open while the request is in flight.
              e.preventDefault();
              run();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? 'Resetting…' : 'Reset'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
