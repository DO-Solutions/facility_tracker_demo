import { config } from '../config.js';

/**
 * The one place in this app that holds a GitHub credential, and the one job
 * it does: emptying the tracker between run-throughs.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * Everything the *demo* does with GitHub goes through Action Gateway, which
 * holds the credential and substitutes it at tool-execution time so no token
 * ever reaches a sandbox. That is the point being demonstrated and it does not
 * change.
 *
 * Reset is not part of the demo. It is stage machinery — the thing you press
 * between rehearsals — and it needs one capability the demo deliberately does
 * not have: **delete**. Action Gateway exposes `update_issue` and no delete,
 * which is the right way round for an agent that should not be able to erase
 * its own audit trail. So clearing the tracker was a manual script, and the
 * Reset button could only close issues, leaving the tracker to fill up with
 * hundreds of closed tickets across a conference day.
 *
 * A scoped token, used from an admin-only route, does that job in about a
 * second instead of a minute of agent time.
 *
 * ── The rules it lives under ────────────────────────────────────────────────
 *
 *   - It is a SECRET in the App Platform spec, never a build arg, never
 *     rendered into a page, never logged.
 *   - It is never passed to an agent, a trigger, or a sandbox. Nothing in
 *     agents/ can see it. The demo's credential story is unchanged.
 *   - It is reachable only from POST /api/reset, which is behind the admin
 *     password.
 *   - It needs `admin` on the tracker repository, because GitHub's
 *     `deleteIssue` is a GraphQL mutation that requires it — there is no REST
 *     delete endpoint and no lesser permission that suffices. Scope it to
 *     that one repository and nothing else.
 *   - Without it the demo is fully functional; reset simply closes issues
 *     instead of deleting them, and says so.
 */

const GQL = 'https://api.github.com/graphql';
const REST = 'https://api.github.com';

function headers() {
  return {
    authorization: `Bearer ${config.github.issueToken}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'facility-issue-tracker',
  };
}

export function tokenConfigured() {
  return Boolean(config.github.issueToken && config.github.issueRepo);
}

/** Every issue in the tracker, open or closed, as {number, nodeId}. */
async function allIssues() {
  const [owner, repo] = config.github.issueRepo.split('/');
  const out = [];

  // Pull requests come back from this endpoint too and cannot be deleted the
  // same way, so they are filtered out rather than attempted and failed.
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `${REST}/repos/${owner}/${repo}/issues?state=all&per_page=100&page=${page}`,
      { headers: headers(), signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) throw new Error(`listing issues returned ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const i of batch) if (!i.pull_request) out.push({ number: i.number, nodeId: i.node_id });
    if (batch.length < 100) break;
  }
  return out;
}

async function deleteIssue(nodeId) {
  const res = await fetch(GQL, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      query: 'mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }',
      variables: { id: nodeId },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (body.errors?.length) throw new Error(body.errors[0].message);
  if (!res.ok) throw new Error(`deleteIssue returned ${res.status}`);
}

/**
 * Ask GitHub what the next issue number will be.
 *
 * Deleting issues does not rewind the counter — #51 follows #50 even when
 * every issue is gone — and nothing exposes the counter directly. Creating one
 * issue and deleting it is the only way to read it back, which matters because
 * ticket #N is supposed to be issue #N and the numbering has to survive a
 * reset.
 */
async function probeNextIssueNumber() {
  const [owner, repo] = config.github.issueRepo.split('/');
  const res = await fetch(`${REST}/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ title: 'counter probe', body: 'Deleted immediately.' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`counter probe returned ${res.status}`);
  const issue = await res.json();
  await deleteIssue(issue.node_id).catch(() => {});
  return issue.number + 1;
}

/**
 * Empty the tracker and report the number the next issue will take.
 *
 * Deletions run sequentially on purpose. GitHub's secondary rate limits are
 * unfriendly to bursts of mutations, and a reset that trips one halfway leaves
 * a half-cleared tracker — slower and complete beats faster and ambiguous.
 */
export async function clearTracker() {
  if (!tokenConfigured()) {
    return { deleted: 0, nextIssue: null, reason: 'no GITHUB_ISSUE_TOKEN configured' };
  }

  const issues = await allIssues();
  let deleted = 0;
  const failures = [];

  for (const issue of issues) {
    try {
      await deleteIssue(issue.nodeId);
      deleted += 1;
    } catch (err) {
      failures.push(`#${issue.number}: ${err.message}`);
    }
  }

  const nextIssue = await probeNextIssueNumber().catch(() => null);
  return { deleted, nextIssue, failures };
}
