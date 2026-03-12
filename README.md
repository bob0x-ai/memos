# MEMOS Plugin (OpenClaw Memory)

MEMOS is a Graphiti-backed memory plugin for OpenClaw.
It gives agents:

- automatic memory capture from conversations
- automatic memory recall before responses
- policy-scoped access by role and department
- explicit tools for search, manual store, cross-department lookup, and summary drill-down
- deliberate team announcements and company-wide broadcasts
- Prometheus metrics for observability

## What This Plugin Does

1. Stores agent conversation signals into Graphiti.
2. Recalls relevant memory during future conversations.
3. Enforces role-based policy from YAML:
   - `worker`
   - `management`
   - `contractor`
4. Provides summary-first recall for management, with drill-down to details.
5. Supports explicit team announcements and company-wide broadcasts without exposing private management discussions.

## Core Concepts

- Department: Memory namespace (for example `ops`, `devops`, `company`).
- Role: Policy defaults (access level, recall behavior, capture enabled/disabled).
- Agent assignment: Each known agent maps to a role and department.
- Unknown agents: fall back to contractor policy.

## How Storage Metadata Is Determined

Storage writes happen in two paths: auto-capture (`agent_end`) and explicit `memory_store`.

### Auto-Capture (`agent_end`)

1. Plugin builds a capture excerpt from the last user/assistant exchange.
2. `content_type` and `importance` are classified:
   - primary: OpenAI classifier call
   - fallback: local heuristic classifier
3. `access_level` comes from agent role policy (`roles.*.access_level`) resolved from YAML.
4. Episode is sent to Graphiti `POST /messages` with metadata:
   - `department` (used as `group_id`)
   - `access_level`
   - `content_type`
   - `importance`
   - agent/session/user identifiers

### Explicit Store (`memory_store`)

- `text` is required.
- `content_type`/`importance` are optional:
  - if omitted, classifier fallback chain is used.
- `access_level` is optional:
  - defaults to agent policy level
  - override is allowed only if it does not exceed agent permissions.

### Deliberate Announcement/Broadcast

- `memos_announce` (management/confidential only):
  - stores to caller's own department (`group_id=<caller_department>`)
  - fixed `access_level=restricted`
  - use for "inform my team about management decision"
- `memos_broadcast` (management/confidential only):
  - stores to shared `company` department (`group_id=company`)
  - fixed `access_level=public`
  - use for true company-wide signals

## Setup

### 1) Start Graphiti stack

Use your stack deployment for Graphiti + Neo4j.

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
          "graphiti_url": "http://localhost:8000",
          "auto_capture": true,
          "auto_recall": true,
          "recall_limit": 10
        }
      }
    }
  }
}
```

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
- `llm` (model defaults + prompt templates)

## LLM Prompt Templates

Prompt templates are configurable in YAML under `llm.prompts`:

- `classification_system`
- `classification_user_template`
- `reranker_system`
- `summarization_system`

Default location:
- `config/memos.config.yaml`

Example:
```yaml
llm:
  model: gpt-4o-mini
  prompts:
    classification_system: "You are a precise classifier. Return only requested output, with no extra text."
    classification_user_template: |
      Classify this conversation excerpt.
      ...
      Excerpt: {content}
    reranker_system: 'You are a relevance reranker. Return ONLY JSON: {"ranked_ids":[...]} ordered best to worst.'
    summarization_system: 'You summarize memory facts for executives. Return strict JSON only: {"summary":"...","highlights":["..."],"risks":["..."],"source_fact_ids":["..."]}.'
```

Important boundary:
- Entity/relationship extraction prompt is not built by this plugin.
- MEMOS sends messages + metadata to Graphiti `/messages`; Graphiti runs its own async extraction pipeline.

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
Explicitly store a fact/memory (manual capture path).

```json
{
  "text": "Rollback requires DB migration guard checks",
  "content_type": "sop",
  "importance": 4,
  "access_level": "restricted"
}
```

Notes:
- `content_type` and `importance` are optional (classifier fallback is used if omitted).
- Store is denied if policy capture is disabled (for example contractor fallback).

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
{
  "text": "Company decision: all production incidents must include postmortem within 24h.",
  "content_type": "decision",
  "importance": 5
}
```

Behavior:
- stored to caller department
- `access_level` forced to `restricted`

### 7) `memos_broadcast`
Deliberately publish company-wide broadcast (management/confidential only).

```json
{
  "text": "Company policy: postmortems are required within 24h for sev-1 incidents.",
  "content_type": "decision",
  "importance": 5
}
```

Behavior:
- stored to `company` department
- `access_level` forced to `public`

## Common Workflows

### Private management discussion (default)
- Talk to `main` normally.
- Auto-capture stores in `ops` with `access_level=confidential`.
- Workers in other departments do not see these memories.

### Share decision with own department (deliberate)
- `main` calls `memos_announce`.
- Memory is stored in `main`'s department with `access_level=restricted`.

### Share decision company-wide (deliberate)
- `main` calls `memos_broadcast`.
- Memory is stored in shared `company` department with `access_level=public`.
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
