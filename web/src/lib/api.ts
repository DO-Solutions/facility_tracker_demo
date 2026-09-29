/** Everything the browser knows about the server lives here. */

export type Ticket = {
  id: number;
  complaint_id: number | null;
  title: string;
  component: string;
  severity: 'P1' | 'P2' | 'P3' | 'P4';
  affected_users: number;
  suggested_owner: string;
  sla_hours: number;
  root_cause_hypothesis: string;
  created_at: string;
  session_id: string | null;
  issue_number: number | null;
  issue_url: string | null;
  // Written by the app the moment the operator clicks Close.
  closed_at: string | null;
  // Written by the close agent once the GitHub issue is actually shut, about
  // a minute later. Null while that is still in flight.
  issue_closed_at: string | null;
  complaint_body?: string | null;
};

export type Complaint = {
  id: number;
  body: string;
  submitted_at: string;
  dispatched_at?: string | null;
  source: string;
  status: 'pending' | 'processing' | 'ticketed' | 'failed';
  error: string | null;
  session_id: string | null;
};

export type ComplaintDetail = Complaint & {
  dispatched_at: string | null;
  ticket: {
    id: number;
    title: string;
    component: string;
    severity: string;
    affected_users: number;
    suggested_owner: string;
    sla_hours: number;
    root_cause_hypothesis: string;
    created_at: string;
    issue_number: number | null;
    issue_url: string | null;
    issue_at: string | null;
  } | null;
};

export type Stats = {
  complaints: number;
  tickets: number;
  pending: number;
  processing: number;
  failed: number;
  /** Tickets citing an issue number that is not their own. Zero is healthy. */
  drifted: number;
  /** The widest ticket/issue gap seen. */
  driftMax: number;
  byComponent: { component: string; count: number }[];
  bySeverity: { severity: string; count: number }[];
  byOwner: { owner: string; count: number }[];
};

export type Summary = {
  id: number;
  generated_at: string;
  total_tickets: number;
  top_components: { component: string; count: number }[];
  headcount_ask: string;
  narrative: string;
};

export type Sessions = { total: number; running: number; paused: number; other: number };

class HttpError extends Error {
  // Written out rather than a parameter property: the project builds with
  // `erasableSyntaxOnly`, which rejects TS-only constructor shorthand.
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new HttpError(res.status, `${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  stats: () => get<Stats>('/api/stats'),
  tickets: (params: Record<string, string | number> = {}) => {
    const q = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== '' && v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
    return get<{ tickets: Ticket[]; total: number }>(`/api/tickets?${q}`);
  },
  complaints: (status = '') => get<{ complaints: Complaint[] }>(`/api/complaints?status=${status}`),
  complaint: (id: number) => get<ComplaintDetail>(`/api/complaints/${id}`),
  summaries: () => get<{ summaries: Summary[] }>('/api/summaries'),
  vocab: () => get<{ components: string[]; severities: string[] }>('/api/vocab'),
  me: () => get<{ authenticated: boolean }>('/api/me'),

  async login(password: string) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new HttpError(res.status, 'Incorrect password.');
    return res.json();
  },

  logout: () => fetch('/api/logout', { method: 'POST' }),

  async closeTicket(id: number) {
    const res = await fetch(`/api/tickets/${id}/close`, {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(res.status, json.error ?? 'Could not close the ticket.');
    return json as { ticket: Ticket; tracker: string };
  },

  async reset() {
    const res = await fetch('/api/reset', {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(res.status, json.error ?? 'Reset failed.');
    return json as { database: string; tracker: string; nextTicket: number };
  },

  async generateSummary() {
    const res = await fetch('/api/summaries/run', {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'failed' }));
      throw new HttpError(res.status, body.error ?? 'Could not generate the summary.');
    }
    return res.json() as Promise<Summary>;
  },

  async complain(body: string) {
    const res = await fetch('/api/complain', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(res.status, json.error ?? 'Intake is unavailable.');
    return json as { id: number };
  },
};

export { HttpError };
