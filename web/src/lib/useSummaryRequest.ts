import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from './api';

// A summary agent run takes about a minute. Past this, stop waiting and say
// so rather than leave the button spinning for the rest of the talk.
const GIVE_UP_MS = 3 * 60_000;

/**
 * "Generate now" asks an agent for a summary; it does not produce one. The
 * request returns at once, and the summary arrives later on the live feed,
 * which bumps `summaryTick`. This hook holds the button in its waiting state
 * between the two.
 */
export function useSummaryRequest(summaryTick: number) {
  const [pending, setPending] = useState(false);
  const tickAtRequest = useRef<number | null>(null);

  useEffect(() => {
    if (pending && tickAtRequest.current !== null && summaryTick > tickAtRequest.current) {
      setPending(false);
      tickAtRequest.current = null;
      toast.success('Executive summary filed.');
    }
  }, [summaryTick, pending]);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      setPending(false);
      tickAtRequest.current = null;
      toast.error('No summary arrived. Check the summary trigger’s execution history.');
    }, GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  async function request() {
    tickAtRequest.current = summaryTick;
    setPending(true);
    try {
      await api.generateSummary();
      toast('Summary requested — the agent files it in about a minute.');
    } catch (e) {
      setPending(false);
      tickAtRequest.current = null;
      toast.error(e instanceof Error ? e.message : 'Could not request the summary.');
    }
  }

  return { pending, request };
}
