import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Section } from '@/components/AdminShell';
import { CloseTicketButton } from '@/components/CloseTicket';
import { Severity } from '@/components/Severity';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api, type Ticket } from '@/lib/api';
import { cn } from '@/lib/utils';

const PER_PAGE = 25;

export default function Tickets() {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [component, setComponent] = useState('');
  const [severity, setSeverity] = useState('');
  const [vocab, setVocab] = useState<{ components: string[]; severities: string[] }>({
    components: [], severities: [],
  });

  useEffect(() => { api.vocab().then(setVocab); }, []);

  useEffect(() => {
    api
      .tickets({ q, component, severity, limit: PER_PAGE, offset: (page - 1) * PER_PAGE })
      .then((d) => { setRows(d.tickets); setTotal(d.total); });
  }, [q, component, severity, page]);

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const select =
    'border-input bg-background h-9 rounded-md border px-2.5 text-[13.5px] outline-none focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px]';

  return (
    <>
      <Section>{total} ticket{total === 1 ? '' : 's'}</Section>

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Search titles, root causes, original complaints…"
          className="h-9 min-w-[230px] flex-1"
        />
        <select value={component} onChange={(e) => { setComponent(e.target.value); setPage(1); }} className={select}>
          <option value="">All components</option>
          {vocab.components.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} className={select}>
          <option value="">All severities</option>
          {vocab.severities.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setQ(''); setComponent(''); setSeverity(''); setPage(1); }}
        >
          Reset
        </Button>
      </div>

      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">#</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Component</TableHead>
              <TableHead>Sev</TableHead>
              <TableHead className="text-right">Affected</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">SLA</TableHead>
              <TableHead>Root cause hypothesis</TableHead>
              <TableHead>Issue</TableHead>
              <TableHead>Filed</TableHead>
              <TableHead className="w-[104px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-muted-foreground py-10 text-center">
                  No tickets match.
                </TableCell>
              </TableRow>
            )}
            {rows.map((t) => (
              <TableRow
                key={t.id}
                className={cn('[&>td]:py-3 [&>td]:align-top', t.closed_at && 'opacity-55')}
              >
                <TableCell className="text-muted-foreground font-mono">{t.id}</TableCell>
                <TableCell className="max-w-[320px] whitespace-normal">
                  <div className="text-foreground font-medium">{t.title}</div>
                  {t.complaint_body && (
                    <div className="text-muted-foreground mt-0.5 text-[12.5px] italic">
                      “{t.complaint_body}”
                    </div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{t.component}</TableCell>
                <TableCell><Severity level={t.severity} /></TableCell>
                <TableCell className="tabular text-right">{t.affected_users}</TableCell>
                <TableCell className="whitespace-nowrap">{t.suggested_owner}</TableCell>
                <TableCell className="tabular text-right">{t.sla_hours}h</TableCell>
                <TableCell className="text-muted-foreground max-w-[300px] text-[13px] whitespace-normal">
                  {t.root_cause_hypothesis}
                </TableCell>
                <TableCell className="font-mono text-[11.5px] whitespace-nowrap">
                  {t.issue_url ? (
                    <a href={t.issue_url} target="_blank" rel="noopener noreferrer"
                       className="text-primary inline-flex items-center gap-1 hover:underline">
                      #{t.issue_number}<ExternalLink className="size-3" />
                    </a>
                  ) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-[11.5px] whitespace-nowrap">
                  {new Date(t.created_at).toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  <CloseTicketButton
                    ticket={t}
                    onClosed={(next) =>
                      setRows((rs) => rs.map((r) => (r.id === next.id ? next : r)))
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {pages > 1 && (
        <div className="text-muted-foreground mt-4 flex items-center gap-2 text-[13px]">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Previous
          </Button>
          <span>Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </Button>
        </div>
      )}
    </>
  );
}
