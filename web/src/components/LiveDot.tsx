import { cn } from '@/lib/utils';

export function LiveDot({ live }: { live: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] uppercase',
        live ? 'text-emerald-400' : 'text-muted-foreground',
      )}
    >
      <span className="relative flex size-2">
        {live && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        )}
        <span
          className={cn(
            'relative inline-flex size-2 rounded-full',
            live ? 'bg-emerald-400' : 'bg-muted-foreground/50',
          )}
        />
      </span>
      {live ? 'live' : 'reconnecting'}
    </span>
  );
}
