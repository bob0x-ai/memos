# MEMOS Metrics Reference

This document lists all Prometheus metrics emitted by the MEMOS plugin.

## Where Metrics Come From

- Metrics are defined in `src/metrics/prometheus.ts`.
- The plugin exposes metrics through `getMetrics()` in `src/index.ts`.
- In OpenClaw deployments, these metric names should appear in the configured metrics scrape path for the runtime.

## Metric Types

- `Counter`: monotonically increasing value.
- `Gauge`: value can go up/down.
- `Histogram`: count + bucketed distribution + `_sum` for latency/result size analysis.

## Capture Metrics

### `memos_episodes_captured_total` (Counter)
- Labels: `department`, `agent_id`
- Meaning: number of successful stored episodes.

### `memos_episodes_filtered_total` (Counter)
- Labels: `department`
- Meaning: number of capture attempts filtered/skipped (policy/trivial/no department).

### `memos_capture_duration_seconds` (Histogram)
- Labels: `department`
- Meaning: capture operation duration.

### `memos_capture_errors_total` (Counter)
- Labels: `department`, `error_type`
- Meaning: capture/store failures.

## Recall Metrics

### `memos_recall_operations_total` (Counter)
- Labels: `department`, `agent_id`
- Meaning: recall hook invocations.

### `memos_recall_results_count` (Histogram)
- Labels: `department`
- Meaning: number of recalled items after filtering/rerank.

### `memos_recall_duration_seconds` (Histogram)
- Labels: `department`
- Meaning: recall execution time.

### `memos_recall_errors_total` (Counter)
- Labels: `department`, `error_type`
- Meaning: recall failures.

## Tool Metrics

### `memos_tool_calls_total` (Counter)
- Labels: `tool`, `department`
- Meaning: number of tool invocations.

### `memos_tool_errors_total` (Counter)
- Labels: `tool`, `department`
- Meaning: tool failures/denials.

### `memos_cross_dept_queries_total` (Counter)
- Labels: `source_dept`, `target_dept`
- Meaning: successful cross-department query count.

## Graphiti Health

### `memos_graphiti_health` (Gauge)
- Labels: none
- Values:
  - `1`: healthy
  - `0`: unhealthy

### `memos_backend_requests_total` (Counter)
- Labels: `operation`, `backend`, `outcome`
- Meaning: backend-specific Graphiti operations during the MCP-first migration.
- Expected `backend` values:
  - `mcp`
  - `rest`
- Expected `operation` values include:
  - `add_messages`
  - `search_facts`
  - `get_memory`
  - `detect_capabilities`
  - `health_check`
  - `clear`
- Expected `outcome` values:
  - `ok`
  - `error`

## Direct LLM Metrics

### `memos_llm_requests_total` (Counter)
- Labels: `provider`, `source`, `use_case`, `model`, `status`
- Meaning: direct MEMOS LLM requests by outcome.

### `memos_llm_input_tokens_total` (Counter)
- Labels: `provider`, `source`, `use_case`, `model`
- Meaning: direct MEMOS input tokens from OpenAI `usage`.

### `memos_llm_output_tokens_total` (Counter)
- Labels: `provider`, `source`, `use_case`, `model`
- Meaning: direct MEMOS output tokens from OpenAI `usage`.

### `memos_llm_total_tokens_total` (Counter)
- Labels: `provider`, `source`, `use_case`, `model`
- Meaning: direct MEMOS total tokens from OpenAI `usage`.

### `memos_llm_duration_seconds` (Histogram)
- Labels: `provider`, `source`, `use_case`, `model`
- Meaning: direct MEMOS LLM latency.

### `memos_llm_estimated_cost_usd_total` (Counter)
- Labels: `provider`, `source`, `use_case`, `model`
- Meaning: estimated USD cost for direct MEMOS LLM calls.

Direct `use_case` values:
- `summarization`

## OpenAI Reporting Metrics

### `memos_openai_usage_input_tokens_total` (Counter)
- Labels: `source`, `use_case`, `model`, `project_id`
- Meaning: token input totals from the OpenAI Usage API.

### `memos_openai_usage_output_tokens_total` (Counter)
- Labels: `source`, `use_case`, `model`, `project_id`
- Meaning: token output totals from the OpenAI Usage API.

### `memos_openai_usage_requests_total` (Counter)
- Labels: `source`, `use_case`, `model`, `project_id`
- Meaning: request totals from the OpenAI Usage API.

### `memos_openai_billed_cost_usd_total` (Counter)
- Labels: `source`, `use_case`, `line_item`, `project_id`
- Meaning: billed USD cost totals from the OpenAI Costs API.

### `memos_openai_reporting_last_success_timestamp_seconds` (Gauge)
- Labels: none
- Meaning: last successful OpenAI reporting poll timestamp.

### `memos_openai_reporting_errors_total` (Counter)
- Labels: `endpoint`, `error_type`
- Meaning: reporting poll errors by endpoint and error class.

Reporting `use_case` values:
- `embedding`
- `extraction`

## Summary Metrics

### `memos_summary_requests_total` (Counter)
- Labels: `agent_id`, `mode`
- `mode`: `native_communities` or `fallback_summaries`
- Meaning: summary generation requests.

### `memos_summary_cache_hits_total` (Counter)
- Labels: `agent_id`
- Meaning: summary cache hit count.

### `memos_summary_cache_misses_total` (Counter)
- Labels: `agent_id`
- Meaning: summary cache miss count.

### `memos_summary_generation_duration_seconds` (Histogram)
- Labels: `agent_id`, `provider`
- `provider`: `cache`, `llm`, `heuristic`
- Meaning: summary generation latency.

### `memos_summary_generation_errors_total` (Counter)
- Labels: `agent_id`, `error_type`
- Meaning: summary generation failures (for example LLM unavailable/invalid response).

### `memos_summary_mode_total` (Counter)
- Labels: `mode`
- Meaning: selected summary mode count at recall time.

## Drill-Down Metrics

### `memos_drill_down_calls_total` (Counter)
- Labels: `agent_id`, `outcome`
- `outcome` values include:
  - `success`
  - `expired`
  - `not_found`
  - `denied_access`
  - `denied_no_policy`
  - `error`

### `memos_drill_down_errors_total` (Counter)
- Labels: `agent_id`, `error_type`
- `error_type` values include:
  - `access_denied`
  - `no_policy`
  - `not_found`
  - `expired`
  - `internal`

### `memos_drill_down_duration_seconds` (Histogram)
- Labels: `agent_id`, `outcome`
- Meaning: drill-down latency by outcome.

## Practical Checks

### Is recall active?
- `rate(memos_recall_operations_total[5m]) > 0`

### Are summaries using cache?
- Compare:
  - `rate(memos_summary_cache_hits_total[5m])`
  - `rate(memos_summary_cache_misses_total[5m])`

### Are drill-down calls failing due to expiry?
- `rate(memos_drill_down_calls_total{outcome="expired"}[5m])`
- `rate(memos_drill_down_errors_total{error_type="expired"}[5m])`

### Is Graphiti unhealthy?
- `memos_graphiti_health == 0`

### Are direct MEMOS summarization tokens increasing?
- `sum by (use_case, model) (rate(memos_llm_total_tokens_total[5m]))`

### Is Graphiti generating embedding traffic?
- `sum by (model) (rate(memos_openai_usage_input_tokens_total{use_case="embedding"}[15m]))`

### Are billed Graphiti costs arriving?
- `increase(memos_openai_billed_cost_usd_total[1d])`
