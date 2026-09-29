import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { inference } from './inference.js';
import { stats, insertSummary } from '../db/index.js';
import { emit, EVENTS } from './events.js';

const SUMMARY_TOOL = {
  name: 'file_summary',
  description: 'Record the operations summary for the reporting period. Call this once.',
  input_schema: {
    type: 'object',
    properties: {
      headcount_ask: {
        type: 'string',
        description:
          'A specific, straight-faced headcount request for Facilities. One sentence, containing a number.',
      },
      narrative: {
        type: 'string',
        description:
          'Three to five sentences of executive summary. Utterly deadpan. Cite the actual figures given.',
      },
    },
    required: ['headcount_ask', 'narrative'],
    additionalProperties: false,
  },
};

/**
 * The editorial voice, read from the same file the cron agent is given.
 *
 * This used to be a second copy of those instructions living here, and the
 * two drifted — exactly as the ticket prompt did, where a stale copy made
 * the agent file the example instead of the complaint. What differs between
 * the two paths is mechanics: the agent queries Postgres from its own shell,
 * this process already has the figures. The voice is the part that must not
 * diverge, so there is one of it.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const VOICE_PATH = path.join(here, '..', '..', 'agents', 'summary-voice.txt');

let voice = null;
function summaryVoice() {
  if (voice === null) {
    try {
      voice = fs.readFileSync(VOICE_PATH, 'utf8').trim();
    } catch (err) {
      throw new Error(
        `could not read agents/summary-voice.txt (${err.code}) — the summary takes its ` +
          'instructions with the cron agent and cannot run without them',
      );
    }
  }
  return voice;
}

/**
 * The closing beat of the talk: total tickets, top three components by volume,
 * and a recommended headcount ask for Facilities.
 *
 * One path, one button. This used to have a twin — a cron trigger running a
 * summary agent on a schedule — which meant two copies of one job and a
 * scheduled run nobody was watching. The button is the version a presenter
 * actually uses, so it is the only version.
 *
 * The voice lives in agents/summary-voice.txt rather than inline, because it
 * is prose worth editing without touching JavaScript.
 */
export async function generateSummary() {
  const s = await stats();
  const topComponents = s.byComponent.slice(0, 3);

  const facts = [
    `Total tickets filed: ${s.tickets}`,
    `Total complaints received: ${s.complaints}`,
    '',
    'Top components by volume:',
    ...(topComponents.length
      ? topComponents.map((c, i) => `  ${i + 1}. ${c.component} — ${c.count} tickets`)
      : ['  (none yet)']),
    '',
    'Severity distribution:',
    ...(s.bySeverity.length
      ? s.bySeverity.map((r) => `  ${r.severity}: ${r.count}`)
      : ['  (none yet)']),
    '',
    'Ticket volume by owning team:',
    ...(s.byOwner.length ? s.byOwner.map((r) => `  ${r.owner}: ${r.count}`) : ['  (none yet)']),
  ].join('\n');

  const response = await inference().messages.create({
    model: config.inference.model,
    max_tokens: 4000,
    system: summaryVoice(),
    messages: [
      {
        role: 'user',
        content: `Intake data for the reporting period:\n\n${facts}\n\nWrite the summary.`,
      },
    ],
    tools: [SUMMARY_TOOL],
    tool_choice: { type: 'tool', name: SUMMARY_TOOL.name },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `model declined to write the summary (${response.stop_details?.category ?? 'unspecified'})`,
    );
  }

  const call = (response.content ?? []).find(
    (b) => b.type === 'tool_use' && b.name === SUMMARY_TOOL.name,
  );
  if (!call) throw new Error(`model returned no ${SUMMARY_TOOL.name} call`);

  const parsed = call.input ?? {};

  const summary = await insertSummary({
    totalTickets: s.tickets,
    topComponents,
    headcountAsk: String(parsed.headcount_ask ?? 'No additional headcount requested at this time.').trim(),
    narrative: String(parsed.narrative ?? '').trim() || 'No narrative produced for this period.',
  });

  emit(EVENTS.SUMMARY, summary);
  return summary;
}
