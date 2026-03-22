# MEMOS Graphiti MCP Notes

This document captures the current MEMOS memory architecture after the MCP migration.

## Phase 1 Architecture

- MEMOS uses Graphiti MCP as the primary backend.
- MEMOS keeps the older Graphiti REST service as a temporary fallback.
- MEMOS no longer performs duplicate LLM classification during automatic conversation capture.
- Graphiti owns semantic extraction.
- The shared Graphiti MCP `config.yaml` entity types are the extraction source of truth.

In short:

- MEMOS: noise gate, policy, recall formatting, monitoring, metrics
- Graphiti: extraction, graph updates, embeddings, search

## Why This Changed

The earlier integration sent messages to the Graphiti REST server and also did plugin-side LLM classification. That was wasteful because:

- MEMOS classification did not hard-gate storage on auto-capture
- Graphiti still performed its own extraction afterward
- the stock REST wrapper did not expose Graphiti core ontology features cleanly

Using Graphiti MCP gives us a shared service boundary other clients can reuse, such as ElizaOS or future coding-agent integrations.

## Current Backend Behavior

### Primary backend

- Config key: `graphiti_backend: "mcp"`
- MCP URL: `graphiti_mcp_url`
- Expected default: `http://localhost:8001/mcp/`

### Fallback backend

- Config key: `graphiti_enable_rest_fallback: true`
- REST URL: `graphiti_url`
- Expected legacy fallback: `http://localhost:8000`

### Backend observability

Use `memos_backend_requests_total` to see which backend handled requests and whether fallback occurred.

## Context Monitoring

Slash command:

- `/memos context on`
- `/memos context off`

Scope:

- per conversation
- not global

When enabled, MEMOS posts a visible `MEMOS Context` monitor message for recall turns in supported routable chats.

State storage:

- plugin state file under OpenClaw state dir
- file name: `memos/context-visibility.json`

## Noise Gate

Automatic capture now blocks obvious transient chatter before Graphiti ingest, including patterns such as:

- `standing by`
- `will do`
- `checking`
- `done`
- `acknowledged`

Durable operational details are still kept when they contain clear signals like:

- ports
- URLs
- commands
- file paths
- IDs
- concrete requirements or decisions

## Recall Suppression

Existing low-value memories already in Graphiti are not deleted in Phase 1.

Instead, MEMOS suppresses banal recalled facts before context formatting, so junk stops surfacing immediately while new junk is also blocked at capture time.

## Retrieval Gap We Confirmed

The current live behavior is narrower than it first looked:

- MEMOS is successfully capturing episodes into Graphiti.
- Graphiti is successfully extracting entities and fact edges from those episodes.
- `search_memory_facts` can still return no results for queries that obviously match stored facts.

We confirmed this against a real management-agent episode about the MEMOS MCP migration:

- the episode was stored in Graphiti
- Graphiti extracted entities such as `memos plugin`, `custom entity types`, `http wrapper`, and `mcp endpoint`
- Graphiti also created fact edges like:
  - `The HTTP wrapper dropped custom entity types instead of passing them through to Graphiti.`
  - `The memos memory plugin was rebuilt to use the MCP endpoint of the HTTP wrapper as an abstraction layer.`
- yet MEMOS fact recall still saw zero results from `search_memory_facts`

Practical takeaway:

- the current recall bottleneck is retrieval/ranking, not capture or extraction
- management summary recall now uses a pragmatic staged fallback when fact search misses:
  - plain fact search
  - centered fact search around top matched nodes
  - node-summary fallback
- worker raw-fact recall remains fact-only in this phase

Operational note:

- the legacy Graphiti REST fallback does not expose node search cleanly
- the new management node fallback is therefore MCP-native and will only help when the MCP backend is active

## Ontology Ownership

Phase 1 uses shared static entity types from Graphiti MCP config.

The shared ontology currently includes:

- `Person`
- `Preference`
- `Requirement`
- `Procedure`
- `Location`
- `Event`
- `Organization`
- `Service`
- `Project`
- `Issue`
- `Decision`
- `Document`
- `Topic`
- `Object`

MEMOS keeps a matching local validation list for manual flows, but Graphiti MCP config remains the extraction source of truth.

## Phase 2

Custom edge types are intentionally deferred.

What we know:

- `graphiti_core` supports custom `edge_types` and `edge_type_map`
- the current upstream Graphiti MCP server forwards configured `entity_types`
- the current upstream Graphiti MCP server does not yet expose custom edge types in the same way

If edge precision becomes the next bottleneck, Phase 2 should patch Graphiti MCP to expose custom edge types rather than reintroducing MEMOS-side extraction logic.
