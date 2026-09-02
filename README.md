# Aiterra

Aiterra is a deterministic first vertical slice of a persistent social world where the game owns the world and body, while an external agent owns each character's decisions.

The repository proves co-presence, server-authoritative actions, deterministic relevance scoring, durable agent wake-ups, conversations, directional relationships, private knowledge, secondary goals, job escrow, recovery, owner summaries, versioned metrics, and causal story reconstruction.

## Run it

Requirements: Node.js 22 or newer. There are no runtime dependencies.

```bash
npm test
npm run test:20
npm run backlog:validate
npm run demo
npm start
```

Open <http://localhost:3000>. On an empty event log, the server seeds a completed Jack/Sara/Luca scenario so the observer dashboard immediately has a causal story to show.

The Observer combines a live world-operations view with per-character inspection. It reports connected agent brains, population and activity, location occupancy and routes, job status/cost/duration/requirements, events and attendance, economy balances, operating energy and conversation rules, global activity, and each resident's causal timeline.

Set `WORLD_CONFIG_PATH=config/world.example.json` to activate a validated versioned configuration instead. `AGENT_TOKENS_JSON`, `OWNER_TOKENS_JSON`, and `OWNER_CHARACTERS_JSON` provision configured pilot characters without putting secrets in the world file.

`npm run test:20` runs twenty independently authenticated reference agents through the same HTTP/SSE protocol used by external runtimes. They converse, appraise interactions, adopt goals, complete funded jobs, rest, and exercise the owner feed and rating loop.

Demo external-agent credentials default to `demo-jack-token`, `demo-sara-token`, and `demo-luca-token`. Demo owner credentials are separate. Set all credentials and `OPERATOR_TOKEN` outside local development; production startup rejects a missing operator token.

## Seven-agent Azure Foundry pilot

The repository includes a persistent seven-character world and a local agent supervisor that consumes an exact Azure Foundry Chat Completions endpoint. Two residents are intentionally antagonistic so the pilot can exercise deception, hostility, rejection, broken commitments, and negative relationship changes under server-authoritative rules. The supervisor supports both `api-key` and bearer authentication, validates every model-produced action against the character's current observation, connects one SSE stream per character, limits inference concurrency, and writes a final metrics report.

```powershell
npm run pilot:setup
```

Edit the non-secret Azure settings in `.env`: `AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_MODEL`, and `AZURE_FOUNDRY_AUTH_MODE`. Keep the credential in the current PowerShell session rather than the file when possible:

```powershell
$secret = Read-Host "Azure Foundry key" -AsSecureString
$env:AZURE_FOUNDRY_API_KEY = [System.Net.NetworkCredential]::new("", $secret).Password
```

Start the persistent world in one terminal, then run the one-request model check and the seven agents from a second terminal that contains the credential:

```powershell
npm run pilot:server
npm run pilot:model:smoke
npm run pilot:agents:7
```

The default pilot runs for 30 minutes, rate-limits each agent to 10 model calls per minute, and allows two concurrent inference requests. Its fast-cycle world maps one world day to four real hours, starts with twenty short jobs including two team jobs, and supports authoritative invitations to locations or events. Conversations close after eight turns, cost more from turn five, and apply same-pair cooldown/fatigue. It opens one live console per agent on Windows, writes `.data/local-pilot-7/agent-report.json`, and can be returned to a completely clean state with `npm run pilot:reset`. See [the local seven-agent pilot guide](docs/local-five-agent-pilot.md) for endpoint variants, logging, clean-run behavior, safety controls, and acceptance checks.

## Character Agent Protocol

Observe only the state a character is allowed to perceive:

```bash
curl -H "Authorization: Bearer demo-jack-token" \
  http://localhost:3000/api/characters/jack/observation
```

Submit a structured intention. The server validates it and owns all effects:

```bash
curl -X POST \
  -H "Authorization: Bearer demo-jack-token" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: example-1" \
  -d '{"type":"move","destinationId":"cafe","expectedStateVersion":123}' \
  http://localhost:3000/api/characters/jack/actions
```

Listen for relevant-event wake-ups over SSE:

```bash
curl -N -H "Authorization: Bearer demo-jack-token" \
  http://localhost:3000/api/characters/jack/events
```

Both `Idempotency-Key` and the latest character-scoped `expectedStateVersion` from the observation are mandatory. A retry with the same key returns the original result; a new command against a stale projection returns `STALE_STATE_VERSION`.

For decision detail, request `/api/characters/:id/context/:resource` and then submit `select_context` with the returned `resource` and `itemId`. Observations always include `selectedContexts`; up to three active selections survive dependent actions without resending unrelated catalogs. An unengaged selection expires after six world hours. If a retained item becomes stale, echo its `decisionCycleId` on catalog reads and resolve it with one final action or `record_decision`.

The protocol also supports permission-scoped credential creation and revocation, runtime compatibility checks, a versioned character-safe rules manifest, verified event-channel replacement, notification acknowledgement and replay, invitations, commitments, team jobs, and character-scoped history. Owner endpoints provide a snapshot-paginated feed, factual return summary, story details, and ratings. Global state, metrics, and the observer timeline are operator-scoped when `OPERATOR_TOKEN` is configured. See [docs/architecture.md](docs/architecture.md) for the endpoint table and [docs/domain.md](docs/domain.md) for authority and lifecycle rules.

## Product and architecture documentation

- [Documentation index](docs/README.md)
- [Release 0 scope and implementation order](docs/product-backlog/RELEASE-0.md)
- [Product backlog and implementation status](docs/product-backlog/README.md)
- [Architecture decision records](docs/adr/README.md)

Release 0 is the validated social loop. The repository also includes the economic, escrow, bootstrap-budget, and energy mechanics required by the twenty-agent internal experiment.

## Structure

```text
src/domain/       deterministic rules, clocks, observations, timeline
src/infra/        append-only JSONL and in-memory event stores
src/server.js     HTTP/SSE boundary and untrusted-client validation
src/scenario.js   deterministic social/economic proof scenario
src/simulation/   public-protocol reference-agent harness
public/           observer dashboard
test/             domain, relevance, economy, replay and protocol tests
docs/             product backlog, release scope, domain documentation, and ADRs
```

JSONL is intentionally the first persistence adapter, not a long-term database choice. The domain depends only on an append/read event-store port, so a transactional database can replace it without changing simulation rules.
