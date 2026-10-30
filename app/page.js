import Breaker from "./Breaker.js";

const MAIL = "hello@work.kingdomofkumar.com";
const SHOP = "https://www.kingdomofkumar.com";

export default function Page() {
  const l29 = process.env.NEXT_PUBLIC_DODO_CHECKOUT_URL_29 || "";
  const l79 = process.env.NEXT_PUBLIC_DODO_CHECKOUT_URL_79 || "";
  const mail = (s) => `mailto:${MAIL}?subject=${encodeURIComponent(s)}`;

  return (
    <div className="wrap">
      <div className="top">
        <span><b>Kingdom of Kumar Lab</b> / TokenGuard</span>
        <span>Mayank Raj · <a href={SHOP}>kingdomofkumar.com</a></span>
      </div>

      <Breaker />

      <section className="band" id="how">
        <div className="l"><h2>How the breaker works</h2></div>
        <div className="r">
          <ol className="steps">
            <li><b>Point your client at it.</b> Base URL <code>/v1</code>, plus an <code>x-tokenguard-budget</code> header naming the agent.</li>
            <li><b>Pre-flight.</b> Before anything goes upstream: is the budget exhausted, or could this call (input estimate + <code>max_tokens</code>) push it past the limit? If so, HTTP 429 and the upstream never sees it.</li>
            <li><b>Account.</b> Tokens from the upstream <code>usage</code> field; chars/4 if it is missing. USD from a price table you configure.</li>
            <li><b>Warn at 80%.</b> The call that crosses the soft line is flagged in the body and in <code>x-tokenguard-soft-alert</code>.</li>
          </ol>
        </div>
      </section>

      <section className="band">
        <div className="l">
          <h2>Price</h2>
          <p className="fine" style={{ marginTop: 0 }}>Checkout is on <a href={SHOP}>kingdomofkumar.com</a>. Until the buttons point there, email and we’ll send an invoice link.</p>
        </div>
        <div className="r">
          <div className="plans">
            <div className="plan">
              <div className="price">$0</div>
              <div><h3>Free</h3><ul><li>Demo mode: mock upstream, simulated tokens</li><li>Or pass-through with your own upstream key</li><li>Run it yourself, MIT licensed</li></ul></div>
              <a className="btn" href="#demo">Try the breaker</a>
            </div>
            <div className="plan">
              <div className="price">$29<small>/mo</small></div>
              <div><h3>Team</h3><ul><li>Hosted proxy with persistent budgets</li><li>Per-agent history and Slack chargeback drafts</li><li>Hosted MCP endpoint</li></ul></div>
              <a className="btn solid" href={l29 || mail("TokenGuard Team $29/mo")}>{l29 ? "Checkout" : "Email to start"}</a>
            </div>
            <div className="plan">
              <div className="price">$79<small>/mo</small></div>
              <div><h3>Platform</h3><ul><li>Everything in Team</li><li>Many budgets across teams and projects</li><li>Setup call with Mayank</li></ul></div>
              <a className="btn" href={l79 || mail("TokenGuard Platform $79/mo")}>{l79 ? "Checkout" : "Email to start"}</a>
            </div>
          </div>
          <p className="fine">The paid tiers describe what we plan to build them to include. Persistent hosted budgets are not built yet; what runs today is the free tier on this page.</p>
        </div>
      </section>

      <section className="band">
        <div className="l">
          <h2>Why budgets at the gateway</h2>
          <p className="fine" style={{ marginTop: 0 }}>We name these products as prior art for the idea. We quote no figures from them, and have not checked their pages for this build.</p>
        </div>
        <div className="r">
          <ul className="ev">
            <li><span className="big">01</span><span><b>Google Gemini Enterprise</b>: token budgets for agent usage. Evidence that vendors treat per-agent token limits as a product need.</span></li>
            <li><span className="big">02</span><span><b>Databricks Unity AI Gateway</b>: governance and limits applied at a gateway in front of model endpoints, the same place TokenGuard sits.</span></li>
            <li><span className="big">03</span><span><b>Speakeasy</b>: writing on gateway-style controls for LLM and MCP traffic.</span></li>
          </ul>
        </div>
      </section>

      <section className="band" id="mcp">
        <div className="l">
          <h2>Use it from Claude or Cursor</h2>
          <p className="fine" style={{ marginTop: 0 }}>Tools: <code>set_budget</code>, <code>get_usage</code>, <code>check_allow</code>, <code>draft_slack_chargeback</code>.</p>
        </div>
        <div className="r">
          <pre>{`{
  "mcpServers": {
    "kok-tokenguard": {
      "command": "node",
      "args": ["/absolute/path/to/tokenguard/mcp/server.js"],
      "env": { "TOKENGUARD_STATE_FILE": "/tmp/tokenguard.json" }
    }
  }
}`}</pre>
          <p className="fine">Hosted: <code>POST /api/mcp</code> (JSON-RPC 2.0). The stdio server has its own state; point both at the same <code>TOKENGUARD_STATE_FILE</code> only when they run on one machine.</p>
        </div>
      </section>

      <footer>
        <span>© Kingdom of Kumar. MIT licensed.</span>
        <span><a href={`mailto:${MAIL}`}>{MAIL}</a></span>
      </footer>
    </div>
  );
}
