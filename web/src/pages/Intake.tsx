import { Fragment, useCallback, useEffect, useState } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { Progress } from '@/components/Progress';
import { Severity } from '@/components/Severity';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Section } from '@/components/AdminShell';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api, type Complaint, type ComplaintDetail } from '@/lib/api';
import { cn } from '@/lib/utils';

const STATUSES = ['pending', 'processing', 'ticketed', 'failed'] as const;

const TONE: Record<string, string> = {
  ticketed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  failed: 'bg-destructive/15 text-destructive border-destructive/25',
  processing: 'bg-p3/15 text-p3 border-p3/25',
};

export default function Intake() {
  const [rows, setRows] = useState<Complaint[]>([]);
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ComplaintDetail | null>(null);

  useEffect(() => { api.complaints(status).then((d) => setRows(d.complaints)); }, [status]);

  const load = useCallback((id: number) => {
    api.complaint(id).then(setDetail).catch(() => setDetail(null));
  }, []);

  // While a complaint is still moving, poll it. The SSE feed carries
  // tickets, not per-complaint stage changes, and this panel is the one
  // place that cares about the difference between "fired" and "written".
  useEffect(() => {
    if (openId === null) return;
    load(openId);
    const settled = detail?.status === 'ticketed' || detail?.status === 'failed';
    if (settled) return;
    const t = setInterval(() => load(openId), 2000);
    return () => clearInterval(t);
  }, [openId, load, detail?.status]);

  function toggle(id: number) {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setDetail(null);
    setOpenId(id);
  }

  return (
    <>
      <Section>Raw intake</Section>

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-9 rounded-md border px-2.5 text-[13.5px] outline-none focus-visible:ring-[3px]"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button variant="outline" size="sm" onClick={() => setStatus('')}>Reset</Button>
      </div>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">#</TableHead>
              <TableHead>Complaint</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Session</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-10 text-center">
                  Nothing yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <Fragment key={c.id}>
              <TableRow
                onClick={() => toggle(c.id)}
                className="[&>td]:py-3 [&>td]:align-top hover:bg-accent/50 cursor-pointer"
              >
                <TableCell className="text-muted-foreground font-mono">
                  <span className="inline-flex items-center gap-1">
                    <ChevronRight
                      className={cn('size-3.5 transition-transform', openId === c.id && 'rotate-90')}
                    />
                    {c.id}
                  </span>
                </TableCell>
                <TableCell className="max-w-[460px] whitespace-normal">“{c.body}”</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('font-normal', TONE[c.status])}>
                    {c.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-[11px]">
                  {c.session_id ? c.session_id.slice(0, 8) : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[260px] text-xs whitespace-normal">
                  {c.error ?? ''}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-[11.5px] whitespace-nowrap">
                  {new Date(c.submitted_at).toLocaleString()}
                </TableCell>
              </TableRow>

              {openId === c.id && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="bg-muted/30 whitespace-normal p-0">
                    <div className="grid gap-8 px-6 py-5 lg:grid-cols-[minmax(0,320px)_1fr]">
                      <div>
                        <p className="text-muted-foreground mb-3 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
                          Progress
                        </p>
                        {detail ? (
                          <Progress complaint={detail} />
                        ) : (
                          <p className="text-muted-foreground text-sm">Loading…</p>
                        )}
                      </div>

                      <div>
                        <p className="text-muted-foreground mb-3 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
                          Result
                        </p>
                        {detail?.ticket ? (
                          <div>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <Severity level={detail.ticket.severity} />
                              <Badge variant="secondary" className="font-normal">
                                {detail.ticket.component}
                              </Badge>
                              <Badge variant="outline" className="text-muted-foreground font-normal">
                                {detail.ticket.suggested_owner}
                              </Badge>
                            </div>
                            <p className="text-foreground font-medium">{detail.ticket.title}</p>
                            <p className="text-muted-foreground mt-1.5 text-[13px]">
                              {detail.ticket.root_cause_hypothesis}
                            </p>
                            <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
                              <span>{detail.ticket.affected_users} affected</span>
                              <span>SLA {detail.ticket.sla_hours}h</span>
                              <span>ticket #{detail.ticket.id}</span>
                              {detail.ticket.issue_url && (
                                <a
                                  href={detail.ticket.issue_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary inline-flex items-center gap-1 hover:underline"
                                >
                                  GH #{detail.ticket.issue_number}
                                  <ExternalLink className="size-3" />
                                </a>
                              )}
                            </div>
                            {detail.session_id && (
                              <p className="text-muted-foreground/70 mt-3 font-mono text-[11px]">
                                session {detail.session_id}
                              </p>
                            )}
                          </div>
                        ) : detail?.status === 'failed' ? (
                          <p className="text-destructive text-sm">{detail.error ?? 'Failed.'}</p>
                        ) : (
                          <p className="text-muted-foreground text-sm">
                            No ticket yet — a microVM is working on it.
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
