/**
 * The controlled vocabularies every ticket is flattened into.
 *
 * Controlled vocabularies are deliberate. The joke lands harder when a
 * complaint about a loud chewer is filed under a component that sounds like it
 * came out of a CMDB, and the closing executive summary can only rank "top
 * three components by volume" if the model cannot invent a new component name
 * for every ticket.
 *
 * The instructions that produce a ticket live in exactly one place:
 * agents/complaint-prompt.txt, which the Harness Runtime trigger runs. This
 * file holds only the vocabularies — used by the dashboard filters, by the
 * seed script, and by coerceTicket below — plus the coercion that keeps a
 * near-miss from becoming a lost ticket.
 *
 * If you add a component or an owner here, add it to that prompt too. They
 * are the only two places the vocabulary appears.
 */

export const COMPONENTS = [
  'Beverages',
  'Catering',
  'HVAC',
  'Workplace Acoustics',
  'Furniture & Ergonomics',
  'Restrooms',
  'Networking',
  'Conferencing & AV',
  'Access Control',
  'Parking & Transit',
  'Lighting',
  'Elevators & Vertical Transit',
  'Custodial Services',
  'IT Support',
  'Human Factors',
  'Scheduling & Calendaring',
  'Signage & Wayfinding',
  'Landscaping',
  'Printing & Reprographics',
  'Miscellaneous',
];

export const OWNERS = [
  'Facilities',
  'IT Support',
  'Workplace Experience',
  'Human Resources',
  'Security',
  'Network Operations',
  'Catering Services',
  'Building Maintenance',
  'Office of the CTO',
];

export const SEVERITIES = ['P1', 'P2', 'P3', 'P4'];
export const SLA_HOURS = [4, 8, 24, 48, 72, 168];

const SLA_BY_SEVERITY = { P1: 4, P2: 24, P3: 72, P4: 168 };

/** Nearest allowed value, case- and whitespace-insensitive, else the fallback. */
function snap(value, allowed, fallback) {
  const raw = String(value ?? '').trim();
  const hit = allowed.find((a) => a.toLowerCase() === raw.toLowerCase());
  if (hit) return hit;

  // Tolerate a near-miss like "Beverage" or "AV" before giving up.
  const loose = allowed.find(
    (a) => a.toLowerCase().includes(raw.toLowerCase()) || raw.toLowerCase().includes(a.toLowerCase()),
  );
  return raw && loose ? loose : fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Forces any plausible model output into a valid ticket.
 *
 * The API's JSON-schema subset carries our vocabularies to the model as
 * description hints rather than hard enums, so "Beverage" instead of
 * "Beverages" is a live possibility. On stage, a ticket that lands slightly
 * wrong beats a ticket that does not land, so nothing here throws.
 */
export function coerceTicket(raw) {
  const severity = snap(raw?.severity, SEVERITIES, 'P3');

  return {
    title: String(raw?.title ?? 'Unspecified grievance').trim().slice(0, 300) || 'Unspecified grievance',
    component: snap(raw?.component, COMPONENTS, 'Miscellaneous'),
    severity,
    affected_users: clampInt(raw?.affected_users, 1, 5000, 4),
    suggested_owner: snap(raw?.suggested_owner, OWNERS, 'Workplace Experience'),
    sla_hours: snap(String(raw?.sla_hours ?? ''), SLA_HOURS.map(String), String(SLA_BY_SEVERITY[severity])),
    root_cause_hypothesis:
      String(raw?.root_cause_hypothesis ?? 'Root cause not established at intake.')
        .trim()
        .slice(0, 500) || 'Root cause not established at intake.',
  };
}

/** Normalises a model-produced ticket into the row shape the DB expects. */
export function toRow(parsed, { complaintId = null, sessionId = null } = {}) {
  const t = coerceTicket(parsed);
  return {
    complaint_id: complaintId,
    title: t.title,
    component: t.component,
    severity: t.severity,
    affected_users: t.affected_users,
    suggested_owner: t.suggested_owner,
    sla_hours: Number(t.sla_hours),
    root_cause_hypothesis: t.root_cause_hypothesis,
    session_id: sessionId,
  };
}
