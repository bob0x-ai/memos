# MEMOS Plugin (OpenClaw Memory)

MEMOS is a Graphiti-backed memory plugin for OpenClaw.
It gives agents:

- automatic memory capture from conversations
- automatic memory recall before responses
- policy-scoped access by role and Graphiti group selection
- explicit tools for search, manual store, cross-department lookup, and summary drill-down
- deliberate team announcements and company-wide broadcasts
- Graphiti MCP as the primary memory backend, with REST fallback during migration
- visible per-chat context monitoring via `/memos context on` and `/memos context off`
- Prometheus metrics for observability
- LLM token and cost metrics for both direct MEMOS calls and Graphiti OpenAI project usage

## What This Plugin Does

1. Stores agent conversation signals into Graphiti.
2. Recalls relevant memory during future conversations.
   - Management summary recall now uses a staged Graphiti MCP retrieval cascade: fact search, centered fact search around matched nodes, then node summaries as a final fallback.
3. Enforces role-based policy from YAML:
   - `worker`
   - `management`
   - `contractor`
4. Provides summary-mode recall for management, with drill-down to details.
5. Supports explicit team announcements and company-wide broadcasts without exposing private management discussions.

## Core Concepts

- Group boundary: The real storage boundary is Graphiti `group_id`.
- Department: Shared team group (for example `ops`, `devops`, `company`).
- Role: Policy defaults (who captures where, how recall works, whether capture is enabled).
- Agent assignment: Each known agent maps to a role and department.
- Unknown agents: fall back to contractor policy.

## How Capture Works Now

Storage writes happen in two paths: auto-capture (`agent_end`) and explicit tool calls.

### Auto-Capture (`agent_end`)

1. MEMOS sanitizes the last user/assistant exchange.
2. A deterministic noise gate rejects trivial status chatter such as acknowledgements, `standing by`, `will do`, `done`, and similar transient updates.
3. Accepted exchanges are stored into a real Graphiti group based on role policy:
   - `private` -> `group_id = agent_id`
   - `department` -> `group_id = agent.department`
   - `company` -> `group_id = company`
4. The plugin sends the exchange to Graphiti MCP `add_memory` as a conversation episode.
4. Graphiti owns semantic extraction from there, using the shared entity ontology in its own `config.yaml`.

Important:

- MEMOS no longer does a duplicate LLM classification call on the auto-capture hot path.
- The shared Graphiti ontology is now the source of truth for extraction behavior.
- The old Graphiti REST server remains available only as a temporary fallback during migration.

### Explicit Store (`memory_store`)

- `text` is required.
- `memory_store` always stores to the current agent's private group (`group_id = agent_id`).
- No MEMOS-side `content_type`, `importance`, or `access_level` metadata is attached anymore.

### Deliberate Announcement/Broadcast

- `memos_announce` (management/confidential only):
  - stores to caller's own department (`group_id=<caller_department>`)
  - use for "inform my team about management decision"
- `memos_broadcast` (management/confidential only):
  - stores to shared `company` department (`group_id=company`)
  - use for true company-wide signals

## Setup

### 1) Start Graphiti stack

Use your stack deployment for Neo4j plus both Graphiti services:

- Graphiti MCP on `http://localhost:8001/mcp/` (primary)
- Graphiti REST on `http://localhost:8000` (temporary fallback)

Important credential split:

- Graphiti runtime key belongs in `stack/.env.graphiti` as `OPENAI_API_KEY`
- MEMOS reporting key belongs in the OpenClaw process environment as `OPENAI_ADMIN_KEY`

### 2) Build plugin

```bash
cd ~/plugin-dev/memos
npm install
npm run build
```

### 2b) Bundled Memory Skill

This repo bundles a memory skill at:

- `skills/memory/SKILL.md`

On plugin startup, MEMOS syncs that file into:

- `~/.openclaw/skills/memory/SKILL.md`

Override target skills directory with:

- `OPENCLAW_SKILLS_DIR=/custom/path`

### 3) Enable plugin in OpenClaw

Example snippet in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "slots": { "memory": "memos" },
    "entries": {
      "memos": {
        "enabled": true,
        "config": {
          "graphiti_backend": "mcp",
          "graphiti_mcp_url": "http://localhost:8001/mcp/",
          "graphiti_url": "http://localhost:8000",
          "graphiti_enable_rest_fallback": true,
          "auto_capture": true,
          "auto_recall": true,
          "recall_limit": 10
        }
      }
    }
  }
}
```

### 4) Optional: Enable OpenAI reporting for Graphiti usage and billed cost

If you want MEMOS to poll OpenAI organization reporting APIs for Graphiti extraction and embedding usage, export these variables in the environment of the OpenClaw process:

```bash
export OPENAI_ADMIN_KEY=sk-admin-readonly-...
export MEMOS_OPENAI_GRAPHITI_PROJECT_ID=proj_...
export MEMOS_OPENAI_REPORTING_ENABLED=true
export MEMOS_OPENAI_REPORTING_INTERVAL_SECONDS=300
```

Important:

- `OPENAI_ADMIN_KEY` should not be added to `.env.graphiti`
- `MEMOS_OPENAI_GRAPHITI_PROJECT_ID` must be the real OpenAI project ID, not the display name
- Graphiti should use a dedicated OpenAI project so its usage and costs stay isolated

## Policy Configuration

Policy source of truth is YAML:

- `config/memos.config.yaml` (runtime)
- `config/memos.test.yaml` (tests)

Key blocks:

- `departments`
- `roles`
- `agents`
- `unknown_agent_policy`
- `overrides`
- `summarization`
- `llm` (model defaults + summarization prompt)

## LLM Prompt Templates

Prompt templates are configurable in YAML under `llm.prompts`:

- `summarization_system`

Default location:
- `config/memos.config.yaml`

Example:
```yaml
llm:
  model: gpt-4o-mini
  prompts:
    summarization_system: 'You summarize memory facts for executives. Return strict JSON only: {"summary":"...","highlights":["..."],"risks":["..."],"source_fact_ids":["..."]}.'
```

Important boundary:
- Entity extraction is not configured in MEMOS anymore.
- Graphiti MCP owns extraction using its own shared `config.yaml` entity types.
- The shared ontology now includes the default types plus `Person`, `Service`, `Project`, `Issue`, and `Decision`.
- MEMOS remains responsible for noise gating, policy, recall formatting, and monitoring.
- For management roles, MEMOS now tries Graphiti fact search first, then centered fact search around top matched nodes, and only then falls back to node summaries if retrieval still misses.

## Context Monitoring

You can make recalled MEMOS context visible in the current conversation:

- `/memos context on`
- `/memos context off`

When enabled, MEMOS posts a visible `MEMOS Context` message back into the current supported chat surface on each recall turn:

- if context was injected, you see the exact formatted block
- if recall found nothing useful, you see `No relevant context found.`

This is best-effort on routable chat surfaces and is intended for monitoring/debugging recall quality.

## LLM Metrics

MEMOS now emits two separate LLM observability layers:

- Direct MEMOS LLM metrics:
  - `memos_llm_requests_total`
  - `memos_llm_input_tokens_total`
  - `memos_llm_output_tokens_total`
  - `memos_llm_total_tokens_total`
  - `memos_llm_duration_seconds`
  - `memos_llm_estimated_cost_usd_total`
- OpenAI reporting metrics for the Graphiti project:
  - `memos_openai_usage_input_tokens_total`
  - `memos_openai_usage_output_tokens_total`
  - `memos_openai_usage_requests_total`
  - `memos_openai_billed_cost_usd_total`
  - `memos_openai_reporting_last_success_timestamp_seconds`
  - `memos_openai_reporting_errors_total`

What these mean:

- Direct MEMOS metrics are exact for plugin-side `summarization`
- Graphiti `embedding` and `extraction` metrics come from OpenAI organization reporting APIs
- Estimated plugin cost and billed OpenAI cost are intentionally separate and should not be combined into one number

For the full metric taxonomy and troubleshooting notes, see:

- `METRICS.md`
- `docs/LLM_METRICS.md`
- `docs/GRAPHITI_MCP.md`

## Available Tools

### 1) `memos_recall`
Explicit recall search under policy scope.

```json
{ "query": "deployment checklist", "limit": 10 }
```

### 2) `memory_search`
Compatibility alias for explicit search (same behavior as `memos_recall`).

```json
{ "query": "deployment checklist", "limit": 10 }
```

### 3) `memory_store`
Explicitly store a private memory for the current agent.

```json
{ "text": "Rollback requires DB migration guard checks" }
```

Notes:
- Store is denied if policy capture is disabled (for example contractor fallback).
- Stored to `group_id = agent_id`.

### 4) `memos_cross_dept`
Query another department (allowed for confidential, or own department).

```json
{ "department": "devops", "query": "incident trend", "limit": 5 }
```

### 5) `memos_drill_down`
Expand a summary into underlying facts (confidential only).

```json
{ "summary_id": "sum_0123456789abcdef", "limit": 10 }
```

Drill-down status outcomes:
- success
- expired summary
- not found summary

### 6) `memos_announce`
Deliberately publish team announcement (management/confidential only).

```json
{ "text": "Company decision: all production incidents must include postmortem within 24h." }
```

Behavior:
- stored to caller department
- no extra MEMOS content/access metadata is attached

### 7) `memos_broadcast`
Deliberately publish company-wide broadcast (management/confidential only).

```json
{ "text": "Company policy: postmortems are required within 24h for sev-1 incidents." }
```

Behavior:
- stored to `company` department
- no extra MEMOS content/access metadata is attached

## Common Workflows

### Private management discussion (default)
- Talk to `main` normally.
- Auto-capture stores in `main`'s private group (`group_id = main`).
- Workers in other departments do not see these memories because MEMOS never queries another agent's private group automatically.

### Share decision with own department (deliberate)
- `main` calls `memos_announce`.
- Memory is stored in `main`'s department group.

### Share decision company-wide (deliberate)
- `main` calls `memos_broadcast`.
- Memory is stored in shared `company` group.
- Worker recall queries own department + `company`, so teams receive the announcement context.

## Observability

Metrics are exported from the plugin via Prometheus metric names.

For full metric reference (names, labels, interpretation), see:
- [METRICS.md](/home/openclaw/plugin-dev/memos/METRICS.md)

## Development

```bash
# compile
npm run build

# type check
npm run typecheck

# standard tests (offline-safe defaults)
npm test -- --runInBand

# live LLM integration tests (requires real OPENAI_API_KEY)
npm run test:llm
```

## Notes for Future Refactors

- Keep policy logic centralized in `src/utils/config.ts`.
- Preserve `summary_id` + drill-down provenance contract in `src/utils/summarization.ts`.
- If Graphiti community endpoints become available, native summary mode can replace fallback mode without changing agent-facing tools.
