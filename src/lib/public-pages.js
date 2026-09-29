/**
 * The three public pages, rendered as self-contained HTML.
 *
 * These are deliberately not part of the React app. A phone in the room
 * loads this once, on venue wifi, two hundred at a time — and the admin
 * bundle it would otherwise pull down is ~112 KB gzipped of React, router
 * and a table that a person filing a complaint has no use for. This is
 * about four, in a single request with the CSS inlined.
 *
 * The form works with JavaScript disabled or still loading: it is a plain
 * POST that redirects. The small script at the bottom only adds a character
 * counter and a double-submit guard, and nothing breaks without it. On the
 * one page that absolutely has to work at 09:00, that seemed worth more
 * than component reuse.
 */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/* Mirrors the shadcn slate tokens the admin uses, trimmed to what these
   pages actually paint. Inlined rather than linked so the page is one
   request. */
const CSS = `
:root{--bg:#f7f8fa;--fg:#0f172a;--muted:#64748b;--line:#e2e8f0;--card:#fff;
--primary:#2563eb;--primary-fg:#fff;--ring:rgba(37,99,235,.35);--bad:#dc2626;--ok:#059669;
--radius:.5rem;--sans:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
--mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font-family:var(--sans);line-height:1.55;
-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
main{min-height:100dvh;display:grid;place-items:center;padding:20px}
.card{width:100%;max-width:36rem;background:var(--card);border:1px solid var(--line);
border-radius:var(--radius);box-shadow:0 1px 2px rgba(15,23,42,.05),0 8px 24px rgba(15,23,42,.06);overflow:hidden}
header{padding:28px 32px 20px;border-bottom:1px solid var(--line)}
.eyebrow{margin:0 0 10px;font-family:var(--mono);font-size:11px;letter-spacing:.14em;
text-transform:uppercase;color:var(--muted)}
h1{margin:0 0 6px;font-size:27px;font-weight:650;letter-spacing:-.02em}
.sub{margin:0;color:var(--muted);font-size:15px}
form{padding:24px 32px}
label{display:block;margin-bottom:8px;font-size:12px;font-weight:650;letter-spacing:.06em;
text-transform:uppercase;color:var(--muted)}
textarea{width:100%;min-height:104px;resize:vertical;padding:12px 14px;font:inherit;font-size:16px;
color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:calc(var(--radius) - 2px);
line-height:1.5}
textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px var(--ring)}
.hint{display:flex;justify-content:space-between;gap:12px;margin-top:8px;font-size:12px;color:var(--muted)}
.count.over{color:var(--bad);font-weight:650}
.row{display:flex;align-items:center;gap:14px;margin-top:20px;flex-wrap:wrap}
button,.btn{font:inherit;font-size:15px;font-weight:600;color:var(--primary-fg);background:var(--primary);
border:1px solid var(--primary);border-radius:calc(var(--radius) - 2px);padding:10px 20px;cursor:pointer;
text-decoration:none;display:inline-block}
button:hover,.btn:hover{background:#1d4ed8;border-color:#1d4ed8}
button:disabled{opacity:.55;cursor:not-allowed}
.btn-ghost{color:var(--fg);background:var(--card);border-color:var(--line)}
.btn-ghost:hover{background:var(--bg);border-color:var(--muted)}
.note{font-size:13px;color:var(--muted)}
.legal{margin:0;padding:18px 32px 24px;border-top:1px solid var(--line);
font-size:11.5px;line-height:1.6;color:var(--muted)}
.alert{margin-bottom:16px;padding:10px 14px;border-radius:calc(var(--radius) - 2px);font-size:14px;
background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.receipt{padding:44px 32px;text-align:center}
.tick{width:48px;height:48px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center;
background:#ecfdf5;color:var(--ok);font-size:24px}
.receipt h1{font-size:23px}
.receipt p{margin:0 auto 8px;max-width:42ch;color:var(--muted);font-size:15px}
.ref{margin-top:20px;padding-top:20px;border-top:1px solid var(--line);
font-family:var(--mono);font-size:13px;color:var(--muted)}
.qr{min-height:100dvh;display:grid;place-items:center;background:#fff;text-align:center;padding:40px}
.qr h1{font-size:clamp(30px,5vw,56px);letter-spacing:-.03em}
.qr p{font-size:clamp(16px,2vw,22px);color:var(--muted);margin:0 0 34px}
.qr img{width:min(46vh,400px);display:block;margin:0 auto}
.qr .url{margin-top:24px;font-family:var(--mono);font-size:clamp(14px,1.6vw,19px);
color:var(--muted);word-break:break-all}
`.replace(/\n\s*/g, '');

function shell(title, body) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='13'>📋</text></svg>">
<style>${CSS}</style>
</head><body>${body}</body></html>`;
}

export const MAX_LENGTH = 280;

export function formPage({ error = null, body = '' } = {}) {
  return shell(
    'Facility Issue Tracker',
    `<main><div class="card">
<header>
  <p class="eyebrow">Form FIT-1 · Grievance Intake</p>
  <h1>Facility Issue Tracker</h1>
  <p class="sub">Complain about anything. One sentence.</p>
</header>
<form method="post" action="/complain">
  ${error ? `<div class="alert" role="alert">${esc(error)}</div>` : ''}
  <label for="body">Nature of grievance</label>
  <textarea id="body" name="body" required autofocus maxlength="${MAX_LENGTH + 40}"
    placeholder="The coffee here is cold.">${esc(body)}</textarea>
  <div class="hint">
    <span>All submissions are triaged and assigned an owner.</span>
    <span class="count" id="count">0 / ${MAX_LENGTH}</span>
  </div>
  <div class="row">
    <button type="submit" id="go">Submit grievance</button>
    <span class="note">No login. No follow-up. No appeal.</span>
  </div>
</form>
<p class="legal">By submitting this form you consent to your grievance being classified against a
fixed schema, assigned a severity and a service-level objective, and routed to a team that did not
ask for it. Response times are indicative and non-binding. This department does not acknowledge
receipt, provide status updates, or entertain escalation.</p>
</div></main>
<script>
(function(){
  var t=document.getElementById('body'),c=document.getElementById('count'),
      f=t.form,b=document.getElementById('go'),max=${MAX_LENGTH};
  function tick(){c.textContent=t.value.length+' / '+max;
    c.classList.toggle('over',t.value.length>max);}
  t.addEventListener('input',tick);tick();
  // A room full of phones guarantees a double tap.
  f.addEventListener('submit',function(){b.disabled=true;b.textContent='Filing…';});
})();
</script>`,
  );
}

export function thanksPage({ id = null } = {}) {
  const ref = Number.isFinite(id)
    ? `<p class="ref">Reference FIT-${String(id).padStart(6, '0')}</p>`
    : '';
  return shell(
    'Grievance received',
    `<main><div class="card"><div class="receipt">
  <div class="tick">✓</div>
  <h1>Your grievance has been received.</h1>
  <p>It is being triaged against the standard schema and will be assigned a component, a severity,
     an owner and a service-level objective.</p>
  <p class="note">You will not be contacted. There is no status page.</p>
  ${ref}
  <p style="margin-top:22px"><a class="btn btn-ghost" href="/">File another</a></p>
</div></div></main>`,
  );
}

export function qrPage({ target }) {
  return shell(
    'Complain about anything',
    `<main class="qr"><div>
  <h1>Facility Issue Tracker</h1>
  <p>Complain about anything. One sentence.</p>
  <img src="/qr.svg?url=${encodeURIComponent(target)}" alt="QR code linking to the form">
  <p class="url">${esc(target)}</p>
</div></main>`,
  );
}
