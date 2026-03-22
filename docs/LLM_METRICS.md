# MEMOS LLM Metrics Reference

This document describes the LLM token and cost metrics emitted by MEMOS, where the data comes from, and how to configure the required credentials safely.

## Two Metric Families

MEMOS now exposes two separate LLM metric families on purpose:

- Direct plugin telemetry:
  - exact request, token, latency, and estimated-cost metrics for OpenAI calls made by the MEMOS plugin itself
  - currently covers `summarization`
- OpenAI reporting telemetry:
  - organization usage and billed-cost data polled from OpenAI reporting APIs
  - covers Graphiti-owned `embedding` and `extraction` work

Keep these separate in dashboards. Plugin-side cost is estimated from model pricing, while reporting-side cost is billed usage from OpenAI.

## Metric Names

### Direct plugin telemetry

- `memos_llm_requests_total{provider,source,use_case,model,status}`
- `memos_llm_input_tokens_total{provider,source,use_case,model}`
- `memos_llm_output_tokens_total{provider,source,use_case,model}`
- `memos_llm_total_tokens_total{provider,source,use_case,model}`
- `memos_llm_duration_seconds{provider,source,use_case,model}`
- `memos_llm_estimated_cost_usd_total{provider,source,use_case,model}`

Expected labels:

- `provider`: currently `openai`
- `source`: `plugin`
- `use_case`: `summarization`
- `status`: `ok` or `error`

### OpenAI reporting telemetry

- `memos_openai_usage_input_tokens_total{source,use_case,model,project_id}`
- `memos_openai_usage_output_tokens_total{source,use_case,model,project_id}`
- `memos_openai_usage_requests_total{source,use_case,model,project_id}`
- `memos_openai_billed_cost_usd_total{source,use_case,line_item,project_id}`
- `memos_openai_reporting_last_success_timestamp_seconds`
- `memos_openai_reporting_errors_total{endpoint,error_type}`

Expected labels:

- `source`: `graphiti`
- `use_case`: `embedding` or `extraction`
- `project_id`: the OpenAI project ID configured in `MEMOS_OPENAI_GRAPHITI_PROJECT_ID`

## Data Sources

### Direct plugin telemetry

Source: live `usage` fields returned by direct OpenAI `chat/completions` calls inside MEMOS.

Covered code paths:

- `src/utils/summarization.ts`

Important:

- MEMOS no longer does plugin-side classification or reranking in the active runtime path
- Graphiti MCP now owns extraction for automatic memory ingestion

If an OpenAI response does not include `usage`, MEMOS still records the request and duration, but it does not invent token values.

### OpenAI reporting telemetry

Source: OpenAI organization reporting APIs, polled on an interval:

- `GET /organization/usage/completions`
- `GET /organization/usage/embeddings`
- `GET /organization/costs`

MEMOS filters these results to the configured Graphiti project so Graphiti traffic does not get mixed with plugin traffic.

## Cost Semantics

There are two different cost concepts:

- Estimated cost:
  - metric: `memos_llm_estimated_cost_usd_total`
  - scope: direct MEMOS plugin calls only
  - source: local model pricing table, optionally overridden by `MEMOS_OPENAI_PRICING_JSON`
- Billed cost:
  - metric: `memos_openai_billed_cost_usd_total`
  - scope: OpenAI-reported billed usage for the Graphiti project
  - source: OpenAI Costs API

Do not sum estimated and billed cost together.

## Environment Variables

### Graphiti runtime key

Put the Graphiti runtime key in:

- `stack/.env.graphiti`

Example:

```env
OPENAI_API_KEY=sk-proj-...
```

This key should belong to the dedicated Graphiti OpenAI project.

### MEMOS reporting credentials

Put the OpenAI admin/reporting key in the environment of the OpenClaw process that loads MEMOS.

Example:

```bash
export OPENAI_ADMIN_KEY=sk-admin-readonly-...
export MEMOS_OPENAI_GRAPHITI_PROJECT_ID=proj_...
export MEMOS_OPENAI_REPORTING_ENABLED=true
export MEMOS_OPENAI_REPORTING_INTERVAL_SECONDS=300
```

Do not put `OPENAI_ADMIN_KEY` into `.env.graphiti`. Graphiti does not need the admin key, and MEMOS will not see Graphiti’s environment file.

Optional pricing override:

```bash
export MEMOS_OPENAI_PRICING_JSON='{"gpt-4o-mini":{"inputPer1M":0.15,"outputPer1M":0.6},"text-embedding-3-small":{"inputPer1M":0.02,"outputPer1M":0}}'
```

## Attribution Rules

- Plugin-side direct calls are always labeled `source="plugin"`.
- Graphiti usage from `/organization/usage/embeddings` is labeled `use_case="embedding"`.
- Graphiti usage from `/organization/usage/completions` is labeled `use_case="extraction"`.
- Graphiti billed costs use `line_item` from the Costs API and derive `use_case="embedding"` only when the line item clearly references embeddings; otherwise the billed cost is labeled `use_case="extraction"`.

## Known Limitations

- Plugin-side token metrics are exact only for direct OpenAI calls made from the MEMOS plugin.
- Graphiti extraction and embedding metrics depend on OpenAI reporting APIs and poll cadence, so they are not request-local.
- OpenAI billed cost buckets can lag behind live request activity.
- If `MEMOS_OPENAI_GRAPHITI_PROJECT_ID` is missing or wrong, reporting metrics stay idle even though direct plugin metrics still work.

## Troubleshooting

- `memos_llm_*` present, but `memos_openai_*` missing:
  - check `OPENAI_ADMIN_KEY`
  - check `MEMOS_OPENAI_GRAPHITI_PROJECT_ID`
  - check `MEMOS_OPENAI_REPORTING_ENABLED`
- `memos_openai_reporting_errors_total` increasing:
  - inspect MEMOS logs for HTTP status details from OpenAI reporting endpoints
- Graphiti usage still mixed with other workloads:
  - verify the Graphiti runtime key belongs to a dedicated OpenAI project
- Estimated cost looks right but billed cost is empty:
  - confirm the admin key has reporting read access and wait for OpenAI costs buckets to populate
