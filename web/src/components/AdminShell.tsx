import { NavLink, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { LiveDot } from '@/components/LiveDot';
import { ResetButton } from '@/components/ResetButton';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const LINKS = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/tickets', label: 'Tickets' },
  { to: '/admin/complaints', label: 'Intake' },
  { to: '/admin/summary', label: 'Executive summary' },
  { to: '/admin/wall', label: 'Wall' },
];

export function AdminShell({ live, children }: { live: boolean; children: React.ReactNode }) {
  const navigate = useNavigate();

  return (
    <div className="dark bg-background text-foreground min-h-dvh">
      <nav className="border-border bg-card/80 sticky top-0 z-10 flex h-14 items-center gap-5 border-b px-6 backdrop-blur">
        <NavLink to="/admin" className="text-sm font-semibold tracking-tight whitespace-nowrap">
          Facility Issue Tracker
          <span className="text-muted-foreground font-normal"> / Operations</span>
        </NavLink>

        <div className="flex flex-1 flex-wrap gap-1">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
                )
              }
            >
              {l.label}
            </NavLink>
          ))}
          <a
            href="/qr"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground rounded-md px-2.5 py-1.5 text-[13.5px]"
          >
            QR
          </a>
        </div>

        <LiveDot live={live} />
        <ResetButton />
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await api.logout();
            navigate('/admin/login');
          }}
        >
          Sign out
        </Button>
      </nav>

      <div className="mx-auto max-w-[1280px] px-6 pt-6 pb-16">{children}</div>
    </div>
  );
}

export function Section({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-muted-foreground mt-8 mb-3 text-[11px] font-semibold tracking-[0.12em] uppercase first:mt-0">
      {children}
    </h2>
  );
}
