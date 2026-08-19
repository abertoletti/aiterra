# Local seven-agent Azure Foundry pilot

This guide runs the Aiterra world, JSONL persistence, observer, and seven external character runtimes on one workstation. Only model inference leaves the machine when Azure Foundry is selected.

## Requirements

- Node.js 22 or newer.
- An Azure Foundry deployment with a working Chat Completions target URI.
- The deployment name or model identifier expected in the request body.
- An API key or Azure ML endpoint token.
- Local TCP port 3000 available.

The runner uses the configured REST endpoint directly. It does not use the deprecated Azure AI Inference beta SDK.

## 1. Verify the repository

```powershell
node --version
npm run check
npm test
npm run test:20
```

## 2. Generate local identities and settings

```powershell
npm run pilot:setup
```

This creates `.env` only when the file does not already exist. It generates distinct Aiterra agent and owner tokens for `pilot-01` through `pilot-07`. The file is ignored by Git.

If `.env` already exists from the earlier five-agent pilot, upgrade it in place without replacing Azure credentials:

```powershell
npm run pilot:setup:7
```

Alternatively, generate a separate file with:

```powershell
node src/create-local-pilot-env.js --output .env.pilot.local
```

When using the separate file, replace the npm wrappers with `node --env-file=.env.pilot.local src/index.js`, `node --env-file=.env.pilot.local src/smoke-azure-foundry.js`, and `node --env-file=.env.pilot.local src/run-5-agent-pilot.js`. Do not commit a custom environment file containing secrets.

## 3. Configure the Azure endpoint

Set these non-secret values in `.env`:

```dotenv
AZURE_FOUNDRY_ENDPOINT=https://the-exact-chat-completions-target-uri
AZURE_FOUNDRY_MODEL=the-deployment-name-or-model-id
AZURE_FOUNDRY_AUTH_MODE=api-key
AZURE_FOUNDRY_API_VERSION=
```

Use the exact target URI shown by the deployment. It may already include `/chat/completions`, a deployment path, and an `api-version` query parameter.

- Use `api-key` when Azure documents the `api-key` request header for the deployment.
- Use `bearer` when the endpoint example uses `Authorization: Bearer`, including applicable managed online endpoints.
- Set `AZURE_FOUNDRY_API_VERSION` only when the target URI does not already contain `api-version`.
- For a Foundry Models deployment, `AZURE_FOUNDRY_MODEL` is normally the deployment name.
- For a dedicated vLLM managed endpoint, it can be a catalog model ID such as `deepseek-ai/DeepSeek-V4-Flash` when the endpoint documentation requires it.

Keep the credential outside the file when possible. In the terminal that will run the smoke test and agents:

```powershell
$secret = Read-Host "Azure Foundry key" -AsSecureString
$env:AZURE_FOUNDRY_API_KEY = [System.Net.NetworkCredential]::new("", $secret).Password
```

The value exists only in that PowerShell process and its child processes. The Aiterra world server does not need the Azure credential.

## 4. Start a new persistent world

In the first terminal:

```powershell
npm run pilot:server
```

Open `http://127.0.0.1:3000` and verify:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

The configured event log is `.data/local-pilot-7/world-events.jsonl`. World configuration is applied only to an empty or new log. To start another experiment without destroying evidence, change `EVENT_LOG_PATH` to a new directory. To intentionally delete the current local run, stop the agents and server first, then use `npm run pilot:reset`.

The checked-in fast-cycle configuration starts seven residents and twenty jobs across four locations. Two jobs require a two-person team with collective skill coverage. Vera is deliberately charming, deceptive, and self-serving; Rook is deliberately hostile, dominating, and vindictive. These are fictional behavioral test profiles and still cannot override server authority. Job durations range from 20 to 35 world minutes, and one world day lasts four real hours. If the event log was created with an older configuration, reset it before the next run; restarting the server alone deliberately replays the old persistent world.

## 5. Test one Azure request

In the second terminal, after setting `AZURE_FOUNDRY_API_KEY`:

```powershell
npm run pilot:model:smoke
```

The command makes one paid inference request and prints the response ID, model, usage when supplied by Azure, and content. It never prints the credential.

Do not continue if the endpoint returns an authentication, deployment, quota, or model error. Correct the endpoint contract first.

## 6. Start seven agents

```powershell
npm run pilot:agents:7
```

Defaults:

- duration: 30 real minutes;
- model rate limit: 10 calls per minute for each agent, replenished automatically;
- inference concurrency: 2;
- observation recovery poll: every 5 seconds;
- one authenticated SSE stream per character;
- at most three chained actions per decision cycle;
- one world day: 4 real hours;
- initial opportunities: 20 jobs lasting 20–35 world minutes;
- conversations: 1 base energy to start, 1 energy per message through turn 4, 2 energy from turn 5, 8 turns maximum, with the final 3 turns marked as the closing window;
- repeated pairs: 30 world-minute cooldown, then a 2-energy start surcharge per recent same-pair conversation in the two-world-hour fatigue window;
- social commitments: invitations can target a location or scheduled event; acceptance creates a server-tracked meeting with reminder, kept/missed outcome, and trust consequences;
- team work: two configured jobs recruit two residents, check collective skill coverage, start both workers together, and split compensation.

The rate is controlled by a per-agent sliding window. When an agent reaches its limit, it logs `RATE WAIT`, waits for the next slot, refreshes its observation, and resumes; the other agents continue independently. Acknowledgement events can advance a character projection, so the supervisor refreshes the observation after acknowledging before it plans the next action.

`availableActions` is an informative decision surface, not a promise that every listed proposal will be accepted. Visible jobs include their duration, compensation, requirements, unmet requirements, and current feasibility. Co-present residents stay visible when occupied and expose an availability status. An agent may deliberately submit a currently blocked proposal; the authoritative server returns a stable rejection, and the supervisor remembers it rather than repeating the same rejected action against unchanged state.

Configure the window with:

```powershell
$env:PILOT_MAX_MODEL_CALLS = "10"
$env:PILOT_MODEL_CALL_WINDOW_MS = "60000"
npm run pilot:agents:7
```

Press `Ctrl+C` for a graceful stop. The runner writes `.data/local-pilot-7/agent-report.json` with per-character actions, reported token usage, model failures, fallback actions, acknowledgements, stale retries, social-energy totals/average/rejections, and world metrics.

### Observe agents while the pilot is running

On Windows, the command opens one independent live console window for each agent. By default, the main terminal only manages the pilot lifecycle, so agent activity is not mixed there. Set `PILOT_MAIN_CONSOLE_COMBINED=true` if you also want the combined feed. Each line identifies the character and distinguishes observations, raw model output, decisions, accepted actions, rate-limit waits, and conversation messages:

```text
18:42:10 [Mira/pilot-01] THINK    startup · idle
18:42:11 [Mira/pilot-01] DECIDE   start_conversation -> pilot-02 · "Hello Jonas..." · 842 tokens
18:42:11 [Mira/pilot-01] ACT      start_conversation -> pilot-02 · "Hello Jonas..."
18:42:11 [Jonas/pilot-02] EVENT    conversation_response · Mira started a conversation
18:42:12 [Jonas/pilot-02] MESSAGE  heard from pilot-01 · Hello Jonas...
```

To follow only one character for a run, set its ID in the agent terminal before starting the pilot:

```powershell
$env:PILOT_CONSOLE_AGENT = "pilot-01"
npm run pilot:agents:7
```

Set `PILOT_LOG_LEVEL` to `ERROR`, `WARN`, `INFO`, `VERBOSE`, or `QUIET`. `VERBOSE` includes complete observation summaries, raw provider responses, rejected output, rationales, usage, accepted actions, authoritative action rejections, suppressed unchanged retries, and exchanged dialogue; credentials and authorization headers are never logged. Set `PILOT_OPEN_AGENT_CONSOLES=false` to keep only the combined terminal. Every record is preserved as JSON Lines under `.data/local-pilot-7/agent-activity-<timestamp>.jsonl`, and each agent also receives a readable log under `.data/local-pilot-7/agent-consoles-<timestamp>/`.

If the pilot is already running and you need to reopen its seven windows, run `npm run pilot:consoles`. It attaches read-only viewers to the latest per-agent logs without restarting or duplicating the agents.

The local world observer is available at `http://127.0.0.1:3000` while the server is running. Use the character selector to inspect current activity, energy, credits, relationships, and that character's authoritative timeline. The browser shows committed world outcomes; the agent terminal additionally shows model rationale and token use.

## 7. Acceptance checks

For the seven-agent run, verify:

- all seven compatibility checks succeed;
- every accepted action is present in the authoritative event log;
- at least one conversation completes;
- at least one directional relationship changes;
- at least one secondary goal is adopted or completed after a perceived event;
- at least one job starts and completes;
- no character remains in an active conversation indefinitely;
- conversation turns remain purposeful enough to reach an explicit close, invitation, appraisal, or concrete follow-up before the 8-turn safety limit;
- at least one invitation is accepted or declined and one commitment resolves as kept or missed;
- at least one two-person team job recruits a complete team or exposes why it failed to form;
- Vera or Rook creates at least one observable rejection, deception claim, conflict, broken commitment, or negative appraisal without bypassing server authority;
- `unavailableAgents`, `deliveryFailures`, and unacknowledged delivery counts remain zero;
- the owner summary contains factual, source-linked highlights;
- model errors and fallback actions are understandable from the report.

The deterministic twenty-agent test remains the mechanical regression gate. The seven-agent Azure pilot evaluates unscripted decision quality, antagonistic behavior, provider compatibility, latency, cost, and emergent stories.

## 8. Reset a local run

Stop both `npm run pilot:agents:7` and `npm run pilot:server` with `Ctrl+C`, then run:

```powershell
npm run pilot:reset
```

The command lists the exact targets and requires typing `RESET`. It deletes the world event log, final report, master activity logs, and per-agent console logs. It preserves `.env`, Azure settings, source code, and `config/world.local-5.json`. For automation after the targets have been reviewed, use `npm run pilot:reset -- --yes`; preview without deleting with `npm run pilot:reset -- --dry-run`.
