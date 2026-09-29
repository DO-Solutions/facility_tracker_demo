# Facility Issue Tracker

A live demo for DigitalOcean **Managed Agents Runtime Services**.

A QR code on screen points at a form with one field: *"Complain about anything.
One sentence."* Every submission spawns its own microVM, which takes the
grievance completely seriously and files it as an enterprise incident ticket.
The room watches its own nonsense land on a wall in real time.

> *"The lift plays jazz."*
> → **P4** · Elevators & Vertical Transit · owner Facilities · SLA 168h
> **Unsolicited Ambient Music Genre Broadcast Within Vertical Transit Infrastructure**
> *Elevator audio subsystem defaulted to jazz preset following maintenance cycle firmware reset.*

Every card on that wall is a webhook, a fresh microVM, an LLM call, a database
write, a GitHub issue, and a live push to the browser — about a minute, end to
end, for roughly 20¢.

---

## What happens when someone submits

```mermaid
sequenceDiagram
    autonumber
    actor Guest as Phone in the room
    participant App as App Platform
    participant Trig as Harness Runtime trigger
    participant VM as microVM session
    participant Inf as DO inference
    participant PG as Managed Postgres
    participant AG as Action Gateway
    participant GH as GitHub issues
    participant Wall as The wall

    Guest->>App: one sentence
    App->>PG: store complaint
    App-->>Guest: thank-you page
    Note over App,Guest: instant — nothing waits on the agent

    App->>Trig: signed webhook
    Trig->>VM: start a fresh sandbox
    Note over Trig,VM: one session per trigger — eight triggers, eight at once

    VM->>Inf: classify this grievance
    Inf-->>VM: title, component, severity, owner, SLA, root cause
    VM->>PG: INSERT the ticket
    Note over VM,PG: ticket first — everything after this is a bonus

    VM->>AG: github_create_issue
    AG->>GH: credential added here, never in the sandbox
    GH-->>AG: issue number + url
    AG-->>VM: issue number + url
    VM->>AG: github_add_issue_labels
    VM->>PG: link the issue to the ticket
    Note over VM: sandbox is discarded

    Wall->>PG: poll
    PG-->>Wall: new ticket
    Note over Wall: card lands, counter ticks
```

The web tier never sees the ticket get written. That is the point of the
shape: 200 people can submit at once and the form stays instant, because
nothing on the request path waits for an agent.

### Throughput

Eight complaints at a time, because there are eight intake triggers.

A Harness Runtime trigger runs exactly **one session at a time** — a platform
behaviour with no setting on the trigger to change it. But the limit is per
trigger rather than per team, so `deploy.sh` creates a pool of identical
intake triggers and the app round-robins across them. Concurrency is just the
pool size.

Measured on the deployed stack: **eight complaints submitted within two
seconds all finished within 89 seconds.** Through a single trigger the last
of them would have landed around the eight-minute mark.

`INTAKE_SHARDS` in `.env` sets the pool size, default 8. Triggers cost
nothing to create and only running sessions are billed, so raise it for a
bigger room — verified working at 8, and lowering it removes the extras on
the next deploy.

---

## Deploy it

You need `doctl` (authenticated), `node` 22+, `jq`, and a GitHub repo the
DigitalOcean GitHub app can read.

```bash
cp .env.example .env     # DIGITALOCEAN_ACCESS_TOKEN, GITHUB_REPO, ADMIN_PASSWORD
./deploy.sh
```

```mermaid
flowchart TD
    D["./deploy.sh"] --> PG[("Managed Postgres<br/><small>schema · mars_writer role</small>")]
    D --> WH["Webhook trigger<br/><small>one microVM per complaint</small>"]
    D --> CL["Close trigger<br/><small>closes one ticket's issue</small>"]
    D --> APP["App Platform<br/><small>form · dashboard · wall</small>"]
    C["./scripts/connect-github.sh<br/><small>OAuth — you click this one</small>"] --> AG["GitHub connection<br/><small>Action Gateway holds the credential</small>"]
```

Re-running is safe; every step checks for what it already made.

Then one step that cannot be automated, because it is OAuth — authorizing
GitHub, so the agents can file issues:

```bash
./scripts/connect-github.sh    # prints a link; open it, approve
```

Skip it and the demo still works, minus the issues. `deploy.sh` tells you
which of the two states you are in rather than assuming.

**Cost while it's up:** about $5/mo for the app and $15/mo for the database,
plus roughly **20¢ per complaint** in sandbox time and tokens — call it $20
for a 100-person room. `./destroy.sh` removes all of it.

---

## Run the demo

| Screen | URL |
| --- | --- |
| Project this first | `/qr` — full-screen QR pointing at the form |
| Project this during | `/admin/wall` — the live card wall |
| For you | `/admin` — volumes, filters, the summary |

Sign in with `ADMIN_PASSWORD`.

**The arc.** Put the QR up and let the room submit. The first card lands in
about a minute and the rest follow roughly a minute apart. The session counter
on the wall ticks as sandboxes come and go — that's the scale story, without
anyone saying the word. Close with the executive summary: total tickets, top
three components, and a straight-faced headcount ask for Facilities. Press **Generate now** on
`/admin/summary` when you want it.

**Closing one ticket.** Every row on `/admin/tickets`, and every card on the
dashboard, has a **Close** button. The ticket closes immediately; its GitHub
issue is closed a minute or so later by an agent, because only a
trigger-started session can reach Action Gateway. The badge says which of the
two has happened. The projected wall has no Close button on purpose.

**Reset demo**, beside Sign out, wipes the database and **deletes** every
issue in the tracker, so the next run-through starts on an empty board.
Ticket numbering continues from GitHub's next issue number, so ticket #N
stays issue #N. Takes about twenty seconds for twenty issues.

Deleting needs a credential the demo itself does not have — the agents can
open and close issues through Action Gateway and nothing more. `GITHUB_ISSUE_TOKEN`
is stage machinery, not part of the demo, and `.env.example` says so at
length. Leave it unset and everything still works; reset just leaves the
tracker alone.

**Rehearsing.** `node scripts/seed.js --fake -n 20` fills the wall instantly:
no agents, no cost, deterministic rows. Use it for layout and for checking the
projector.

Dropping `--fake` runs the real thing — one microVM and one GitHub issue per
complaint, one after another. That is the only way to rehearse the agent, but
it spends sandbox time and leaves real issues in the tracker.
`npm run db:reset -- --yes` wipes the database between run-throughs (it names
the cluster before it does anything); the issues you close or delete yourself.

---

## Running it locally

There is no local database. A local run points at the cluster you deployed,
so what you develop against is what the demo runs on — and it is also how you
present if the venue blocks your App Platform URL.

```bash
npm install
./scripts/link-local.sh > .env.local
npm run dev
```

```mermaid
flowchart LR
    L["npm run dev<br/><small>localhost:3000</small>"] -->|reads| PG[("Managed Postgres")]
    L -->|signed webhook| T["Harness Runtime trigger"]
    T --> V["microVM session"]
    V -->|writes| PG
    V -->|Action Gateway| GH["GitHub issues"]
    A["App Platform<br/><small>still running</small>"] -->|reads| PG
```

Submissions still fire the live trigger and still spawn real microVMs; only
the web tier has moved. There is no in-process shortcut — the agent's
instructions live in `agents/complaint-prompt.txt` and that is the only copy,
so what you test is what the demo runs.

Iterating on that prompt: edit it, `./deploy.sh` to push it to the trigger,
then submit. For layout and CSS work, `node scripts/seed.js --fake -n 20`
fills the wall instantly without touching an agent.

---

## Worth knowing

- **Nothing fails closed.** Model output is snapped to the controlled
  vocabulary rather than validated strictly — a slightly-wrong ticket beats a
  missing one in front of an audience.
- **Submissions are data, not instructions.** Anything trying to give the
  agent orders gets filed under `Human Factors`.
- **The agent's database role can insert a ticket, close a complaint and link
  an issue — nothing else.** It cannot read what anyone wrote, and cannot
  delete. Enforced by Postgres grants, asserted at deploy time.
- **Each ticket also opens a GitHub issue**, labelled by severity and
  component, through Action Gateway — which holds the credential and supplies
  it when the tool runs, so no GitHub token ever reaches the sandbox. The
  database row is written first and the issue second, so a tracker failure
  costs a link, not a ticket.
- **Authorize GitHub with `./scripts/connect-github.sh`, not the control
  panel.** Action Gateway resolves a connection by *actor*, and a
  trigger-started session runs as your DigitalOcean account UUID — not your
  username. A connection authorized against any other actor is invisible
  here, and the only symptom is issues silently never appearing. The script
  always targets the right one.
- **Where the minute goes.** Tool execution is about 10s of it; the rest is
  sandbox startup and model generation. Installing the Postgres client the
  image lacks costs under 2s, so that is not the thing to optimise.
- **The form is rate limited** (12 per IP per minute), and the inference
  service allows 240 requests/minute per team. Neither is the constraint
  today — the one-run-at-a-time trigger is.

