import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function Stat({
  label, value, sub, tone = 'default', big = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'default' | 'primary' | 'warn' | 'bad';
  big?: boolean;
}) {
  const tones = {
    default: 'text-card-foreground',
    primary: 'text-primary',
    warn: 'text-p3',
    bad: 'text-destructive',
  } as const;

  return (
    <Card className="gap-0 px-4 py-3.5">
      <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.1em] uppercase">
        {label}
      </p>
      <p
        className={cn(
          'tabular mt-1.5 leading-none font-semibold tracking-tight',
          big ? 'text-4xl' : 'text-3xl',
          tones[tone],
        )}
      >
        {value}
      </p>
      {sub && <p className="text-muted-foreground mt-1.5 text-xs">{sub}</p>}
    </Card>
  );
}
