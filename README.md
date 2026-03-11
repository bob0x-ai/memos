# MEMOS Plugin (OpenClaw Memory)

MEMOS is a Graphiti-backed memory plugin for OpenClaw.
It gives agents:

- automatic memory capture from conversations
- automatic memory recall before responses
- policy-scoped access by role and department
- explicit tools for search, manual store, cross-department lookup, and summary drill-down
- Prometheus metrics for observability

## What This Plugin Does

1. Stores agent conversation signals into Graphiti.
2. Recalls relevant memory during future conversations.
3. Enforces role-based policy from YAML:
   - `worker`
   - `management`
   - `contractor`
4. Provides summary-first recall for management, with drill-down to details.

## Core Concepts

- Department: Memory namespace (for example `ops`, `devops`).
- Role: Policy defaults (access level, recall behavior, capture enabled/disabled).
- Agent assignment: Each known agent maps to a role and department.
- Unknown agents: fall back to contractor policy.

## Setup

### 1) Start Graphiti stack

Use your stack deployment for Graphiti + Neo4j.

### 2) Build plugin

```bash
cd ~/plugin-dev/memos
npm install
npm run build
```

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
