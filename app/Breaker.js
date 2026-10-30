"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const SEGS = 50;
const SAMPLES = [
  "Summarise the Q3 incident report in five bullets.",
  "Write a SQL query that returns the top 10 customers by revenue, with a short explanation of the joins you chose.",
  "Draft a polite reply to a customer who was double charged. Include the refund timeline and an apology, keep it under 120 words, and avoid jargon.",
];
const usd = (n) => `$${Number(n ?? 0).toFixed(4)}`;

export default function Breaker() {
  const [form, setForm] = useState({ id: "support-agent", limitUsd: "0.05", softPct: "80" });
  const [b, setB] = useState(null);
  const [log, setLog] = useState([]);
  const [prompt, setPrompt] = useState(SAMPLES[2]);
  const [maxTok, setMaxTok] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [last, setLast] = useState(null);
  const burning = useRef(false);

  const refresh = useCallback(async (id) => {
    const r = await fetch(`/api/usage?id=${encodeURIComponent(id)}`);
    if (r.ok) setB((await r.json()).budget);
  }, []);

  async function create(e) {
    e.preventDefault();
    setErr("");
    const r = await fetch("/api/budget", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: form.id, name: form.id, limitUsd: Number(form.limitUsd), softPct: Number(form.softPct) / 100, reset: true }),
    });
    const j = await r.json();
    if (!r.ok) return setErr(j.error || `HTTP ${r.status}`);
    setB(j);
    setLog([]);
    setLast(null);
  }

  async function fire() {
    if (!b) return null;
    const body = { model: key ? undefined : "tokenguard-demo", messages: [{ role: "user", content: prompt }] };
    if (maxTok) body.max_tokens = Number(maxTok);
    const headers = { "content-type": "application/json", "x-tokenguard-budget": b.id };
    if (key) headers.authorization = `Bearer ${key}`;
    const r = await fetch("/api/v1/chat/completions", { method: "POST", headers, body: JSON.stringify(body) });
    const j = await r.json();
    setLast({ status: r.status, json: j });
    const entry =
      r.status === 200
        ? { ok: true, status: 200, mode: j.tokenguard.mode, i: j.tokenguard.tokens.input, o: j.tokenguard.tokens.output, cost: j.tokenguard.costUsd, soft: j.tokenguard.softAlert, tripNext: j.tokenguard.hardStopNext }
        : { ok: false, status: r.status, msg: j.error?.code || "error", detail: j.error?.message };
    setLog((l) => [{ n: l.length + 1, ...entry }, ...l]);
    const nb = j.tokenguard?.budget || j.error?.budget;
    if (nb) setB(nb);
    return entry;
  }

  async function once() {
    setBusy(true);
    try { await fire(); } finally { setBusy(false); }
  }

  async function burn() {
    burning.current = true;
    setBusy(true);
    try {
      for (let i = 0; i < 400 && burning.current; i++) {
        const e = await fire();
        if (!e || !e.ok) break;
        await new Promise((r) => setTimeout(r, 120));
      }
    } finally {
      burning.current = false;
      setBusy(false);
    }
  }

  useEffect(() => () => { burning.current = false; }, []);

  const pct = b ? Math.min(100, b.percentUsed) : 0;
  const lit = Math.round((pct / 100) * SEGS);
  const softAt = b ? Math.round(b.softPct * SEGS) : Math.round(0.8 * SEGS);
  const state = b?.state || "idle";

  return (
    <div className={`grid st-${state}`} id="demo">
      <div className="rail">
        <h1>Stop the bill <em>before</em> it posts.</h1>
        <p className="lede">A proxy that sits between your agents and the model API, keeps a running tally in tokens and dollars, and cuts the line at the limit.</p>

        <form onSubmit={create}>
          <label htmlFor="id">Agent / budget name</label>
          <input id="id" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} maxLength={40} required />
          <div className="two">
            <div>
              <label htmlFor="lim">Limit (USD)</label>
              <input id="lim" type="number" step="0.01" min="0.01" value={form.limitUsd} onChange={(e) => setForm({ ...form, limitUsd: e.target.value })} required />
            </div>
            <div>
              <label htmlFor="sp">Soft alert at %</label>
              <input id="sp" type="number" min="1" max="99" value={form.softPct} onChange={(e) => setForm({ ...form, softPct: e.target.value })} required />
            </div>
          </div>
          <button className="run" type="submit">{b ? "Reset & re-arm budget" : "Arm budget"}</button>
        </form>
        {err && <p className="fine bad">{err}</p>}

        <div className={`fire ${b ? "" : "off"}`}>
          <label htmlFor="pr">Prompt to send</label>
          <textarea id="pr" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <div className="chips">
            {SAMPLES.map((s, i) => (
              <button type="button" key={i} onClick={() => setPrompt(s)}>{["short", "medium", "long"][i]}</button>
            ))}
          </div>
          <label htmlFor="mt">max_tokens (optional; used in the pre-flight check)</label>
          <input id="mt" type="number" min="1" value={maxTok} onChange={(e) => setMaxTok(e.target.value)} placeholder="none" />
          <div className="btns">
            <button className="run" disabled={!b || busy} onClick={once}>Fire 1 call</button>
            <button className="run alt" disabled={!b || busy} onClick={burn}>Burn until it trips</button>
          </div>
          <details>
            <summary>Pass-through mode (your own key)</summary>
            <label htmlFor="k">Upstream API key</label>
            <input id="k" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="leave empty for demo mode" />
            <p className="fine">If filled, calls go to the server’s OPENAI_BASE_URL with your key and cost real money. The key is sent only as this request’s Authorization header; TokenGuard does not store or log it. Leave empty for the free simulated demo.</p>
          </details>
        </div>
      </div>

      <div className="main">
        <div className="method">
          <b>{key ? "Mode: pass-through" : "Mode: demo"}</b>
          {key
            ? "Real upstream. Token counts come from the provider’s usage field (chars/4 if it omits one). Cost = tokens × the configured price table."
            : "No model is called. A mock upstream echoes your prompt and reports deterministic, simulated token counts derived from prompt length. The accounting, soft alert and 429 are the real code paths."}
        </div>

        <div className="breaker">
          <div className="bk-head">
            <span className="word">{b ? { armed: "Armed", warning: "Warning", tripped: "Tripped" }[state] : "Not armed"}</span>
            <span className="amt">{b ? `${usd(b.spentUsd)} / ${usd(b.limitUsd)}` : "—"}</span>
          </div>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Budget used">
            {Array.from({ length: SEGS }, (_, i) => (
              <i key={i} className={`${i < lit ? "on" : ""} ${i >= softAt ? "hot" : ""} ${i === softAt ? "mark" : ""}`} />
            ))}
          </div>
          <div className="scale"><span>0</span><span style={{ left: `${(b?.softPct ?? 0.8) * 100}%` }} className="soft">soft alert</span><span>hard stop</span></div>
          <dl className="stats">
            <div><dt>Used</dt><dd>{b ? `${b.percentUsed.toFixed(1)}%` : "—"}</dd></div>
            <div><dt>Input tok</dt><dd>{b ? b.inputTokens.toLocaleString() : "—"}</dd></div>
            <div><dt>Output tok</dt><dd>{b ? b.outputTokens.toLocaleString() : "—"}</dd></div>
            <div><dt>Calls</dt><dd>{b ? b.calls : "—"}</dd></div>
            <div><dt>Blocked</dt><dd>{b ? b.blockedCalls : "—"}</dd></div>
          </dl>
          {b?.softAlert && !b.hardStop && <p className="note">Soft alert: {Math.round(b.softPct * 100)}% of the budget is gone. Calls still pass; every response carries <code>softAlert: true</code>.</p>}
          {b?.hardStop && <p className="note">Breaker tripped. Further calls get HTTP 429 and never reach the upstream.</p>}
        </div>

        {!b && <div className="empty"><p>Arm a budget on the left. A small limit like $0.05 trips within a few calls at the demo price table.</p></div>}

        {log.length > 0 && (
          <div className="ledger">
            {log.slice(0, 40).map((l) => (
              <div key={l.n} className={`lrow ${l.ok ? "" : "blocked"}`}>
                <span className="n">#{l.n}</span>
                {l.ok ? (
                  <>
                    <span className="http">200</span>
                    <span>{l.i} in · {l.o} out{l.soft ? " · soft alert" : ""}{l.tripNext ? " · limit reached" : ""}</span>
                    <span className="num">{usd(l.cost)}</span>
                  </>
                ) : (
                  <>
                    <span className="http">{l.status}</span>
                    <span>{l.msg}: {l.detail}</span>
                    <span className="num">$0</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {last && (
          <details>
            <summary>Last raw response (HTTP {last.status})</summary>
            <pre>{JSON.stringify(last.json, null, 2)}</pre>
          </details>
        )}
        <p className="fine">Budgets here live in server memory and are shared by every visitor to this instance. Name yours something unique.</p>
      </div>
    </div>
  );
}
