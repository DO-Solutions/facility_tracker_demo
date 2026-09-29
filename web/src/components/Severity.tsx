import { cn } from '@/lib/utils';

const TONE: Record<string, string> = {
  P1: 'bg-p1/15 text-p1 ring-p1/30',
  P2: 'bg-p2/15 text-p2 ring-p2/30',
  P3: 'bg-p3/15 text-p3 ring-p3/30',
  P4: 'bg-p4/15 text-p4 ring-p4/30',
};

export function Severity({ level, className }: { level: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wide ring-1 ring-inset',
        TONE[level] ?? TONE.P4,
        className,
      )}
    >
      {level}
    </span>
  );
}

/** The vertical accent down the left edge of a ticket card. */
export const SEVERITY_BAR: Record<string, string> = {
  P1: 'before:bg-p1',
  P2: 'before:bg-p2',
  P3: 'before:bg-p3',
  P4: 'before:bg-p4',
};
