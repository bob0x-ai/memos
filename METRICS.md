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
