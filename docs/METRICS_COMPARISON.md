# Metrics Endpoints - Nemos2 vs MEMOS

## Overview

Both plugins expose Prometheus-compatible metrics at `/metrics` endpoints, but with **different metric names and structures** due to different underlying architectures.

## Nemos2 Metrics Endpoint

**Endpoint:** `http://localhost:9464/metrics`

### Metric Categories

| Category | Metric Pattern | Description |
|----------|----------------|-------------|
| **LLM Usage** | `memory_llm_*_total` | Token counts (input, output, cached, total) |
| **LLM Missing** | `memory_llm_usage_missing_total` | Messages without usage data |
| **Embeddings** | `memory_embedding_calls_total` | Embedding API calls |
| **Summarization** | `memory_summarization_calls_total` | Summarization API calls |
| **Qdrant** | `memory_qdrant_calls_total` | Qdrant operations (upsert, search, retrieve, delete, ensure_collection) |
| **Queue** | `memory_queue_*_total` | Write queue operations (raw enqueued, embed, upsert, backpressure) |
| **Queue Gauges** | `memory_queue_*_pending_total` | Pending queue counts (raw, vector, total pending) |
| **Search** | `memory_search_*` | Search operations (total, duration, results count) |
| **Store** | `memory_store_*` | Storage operations (total, duration) |
| **Errors** | `memory_errors_total` | Plugin errors by category |
| **System** | `memory_up` | Plugin health (gauge) |
| **Department** | `memory_unresolved_department_total` | Agents without department mapping |

## MEMOS Metrics Endpoint

**Endpoint:** `http://localhost:8000/metrics` (Graphiti server)

### Metric Categories

| Category | Metric Pattern | Description |
|----------|----------------|-------------|
| **Capture** | `memos_episodes_captured_total` | Episodes stored (department, agent_id) |
| **Capture** | `memos_episodes_filtered_total` | Filtered as trivial (department) |
| **Capture** | `memos_capture_duration_seconds` | Duration histogram (department) |
| **Capture** | `memos_capture_errors_total` | Errors (department, error_type) |
| **Recall** | `memos_recall_operations_total` | Recall operations (department, agent_id) |
| **Recall** | `memos_recall_results_count` | Results count histogram (department) |
| **Recall** | `memos_recall_duration_seconds` | Duration histogram (department) |
| **Recall** | `memos_recall_errors_total` | Recall errors (department, error_type) |
| **Tools** | `memos_tool_calls_total` | Tool invocations (tool, department) |
| **Tools** | `memos_tool_errors_total` | Tool errors (tool, department) |
| **Health** | `memos_graphiti_health` | Server health (gauge: 1=healthy, 0=unhealthy) |
| **Cross-dept** | `memos_cross_dept_queries_total` | Cross-department queries (source_dept, target_dept) |

## Key Differences

| Aspect | Nemos2 | MEMOS |
|--------|--------|-------|
| **Server** | In-plugin (Node.js/TypeScript) | Graphiti server (Python/FastAPI) |
| **Port** | 9464 (configurable) | 8000 (Graphiti default) |
| **Metric Prefix** | `memory_*` | `memos_*` |
| **LLM Token Tracking** | ✅ Detailed (input/output/cached) | ❌ Not tracked (done externally) |
| **Queue Metrics** | ✅ Isolated queues (raw, vector) | ❌ No queue - async extraction |
| **Qdrant Metrics** | ✅ All operations tracked | ❌ abstraction layer |
| **Embedding Dimensions** | Hardcoded (768) | Configurable (1024 reduction) |
| **Department Labels** | Yes (scope, agent_id) | Yes (department, agent_id) |
| **Error Categories** | Open-ended (operator-defined) | Structured (hook, tool, extraction) |

## Migration Considerations

When switching from Nemos2 to MEMOS:

1. **Update Grafana dashboards** to use `memos_*` instead of `memory_*`
2. **Alert rules** need metric name changes
3. **Token tracking** - MEMOS delegates to OpenAI API key usage (monitor via OpenAI dashboard)
4. **Queue metrics** - MEMOS doesn't have persistent queues; extraction is async

## Example Metrics Output

### Nemos2 (excerpt)
```
# HELP memory_llm_input_tokens_total Total input tokens used
# TYPE memory_llm_input_tokens_total counter
memory_llm_input_tokens_total{provider="google",model="gemini-embedding-001"} 15000

# HELP memory_queue_pending_total Pending queue items
# TYPE memory_queue_pending_total gauge
memory_queue_pending_total 23

# HELP memory_search_total Search operations
# TYPE memory_search_total counter
memory_search_total{status="ok"} 1500
memory_search_total{status="error"} 5
```

### MEMOS (excerpt)
```
# HELP memos_episodes_captured_total Total number of episodes captured
# TYPE memos_episodes_captured_total counter
memos_episodes_captured_total{department="ops",agent_id="main"} 450

# HELP memos_graphiti_health Graphiti server health (1 = healthy, 0 = unhealthy)
# TYPE memos_graphiti_health gauge
memos_graphiti_health 1

# HELP memos_tool_calls_total Total number of tool calls
# TYPE memos_tool_calls_total counter
memos_tool_calls_total{tool="memos_recall",department="ops"} 50
```

## Grafana Dashboard Mapping

| Nemos2 Panel | MEMOS Equivalent |
|--------------|------------------|
| Memory Operations | `memos_episodes_captured_total` + `memos_recalls_operations_total` |
| Queue Depth | N/A (no queue in MEMOS) |
| Embedding Tokens | Check OpenAI dashboard |
| Qdrant Health | `memos_graphiti_health` + `memos_capture_errors_total` |
| Search Success Rate | `memos_recall_operations_total` with status labels (if added) |

## Recommendation

For monitoring MEMOS:
1. Use **OpenAI dashboard** for token tracking
2. Monitor **Graphiti logs** for extraction errors
3. Track `memos_capture_errors_total` and `memos_recalls_errors_total` for issues
4. Use `memos_graphiti_health` for overall system health
