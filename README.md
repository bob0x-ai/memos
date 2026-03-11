# MEMOS - Graphiti Memory Plugin for OpenClaw

A knowledge graph-based memory system for OpenClaw agents using [Graphiti](https://github.com/getzep/graphiti).

## Features

- **Temporal Knowledge Graph**: Entities, relationships, and facts with bi-temporal tracking
- **Department Scoping**: Configurable groups for agent isolation (ops, devops, etc.)
- **Cross-Department Queries**: Agents can query other departments' memories
- **Automatic Capture**: Per-turn episode extraction with trivial message filtering
- **Smart Recall**: Hybrid semantic + keyword search
- **Prometheus Metrics**: Built-in observability
- **Rate Limit Resilience**: Exponential backoff retry for OpenAI API

## Architecture

```
OpenClaw Agent
    ↓
MEMOS Plugin
    ↓ (HTTP)
Graphiti Server
    ↓ (Cypher)
FalkorDB (Knowledge Graph)
```

## Installation

### 1. Start Graphiti + FalkorDB

```bash
cd ~/stack
docker-compose up -d falkordb graphiti
```

### 2. Configure OpenAI API Key

Create `~/stack/.env.graphiti`:

```bash
OPENAI_API_KEY="your-api-key-here"
```

### 3. Install Plugin

```bash
cd ~/plugin-dev/memos
npm install
npm run build
```

### 4. Configure OpenClaw

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "slots": {
      "memory": "memos"
    },
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

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `graphiti_url` | string | `http://localhost:8000` | Graphiti server URL |
| `auto_capture` | boolean | `true` | Capture episodes after agent responses |
| `auto_recall` | boolean | `true` | Recall facts before agent prompts |
| `recall_limit` | number | `10` | Maximum facts to recall |
| `sop_search_enabled` | boolean | `false` | Enable SOP document search (Phase 2) |

## Policy Configuration

Department, role, and agent policy is configured in `config/memos.config.yaml`:

```yaml
departments:
  ops: {}
  devops: {}

roles:
  worker: ...
  management: ...
  contractor: ...

agents:
  main:
    role: management
    department: ops
```

## Agent Tools

### `memos_recall`

Search the current department's memory:

```json
{
  "query": "What did we discuss about deployments?",
  "limit": 5
}
```

### `memos_cross_dept`

Query another department's memory:

```json
{
  "department": "devops",
  "query": "API rate limiting issues",
  "limit": 5
}
```

## How It Works

### Capture Flow

1. Agent responds to user
2. `agent_end` hook triggered
3. Check if exchange is worth remembering (heuristics)
4. Build episode with metadata:
   - `reference_time`: Timestamp for temporal queries
   - `agent_id`: Which agent
   - `user_id`: Who the agent talked to
   - `session_id`: Conversation ID
5. Send to Graphiti with retry logic
6. Graphiti extracts entities and relationships

### Recall Flow

1. User sends message
2. `before_prompt_build` hook triggered
3. Build query from recent messages
4. Search Graphiti (hybrid: semantic + BM25)
5. Format results with highlighted entities
6. Inject into system context

## Message Filtering

Trivial exchanges are automatically filtered:

- "thanks" / "you're welcome"
- "ok" / "okay"
- Short messages (< 50 chars)
- Acknowledgment patterns

## Prometheus Metrics

Available at `/metrics`:

- `memos_episodes_captured_total` - Episodes stored
- `memos_episodes_filtered_total` - Episodes filtered
- `memos_recall_operations_total` - Recall operations
- `memos_recall_results_count` - Results per recall
- `memos_graphiti_health` - Graphiti server health
- `memos_cross_dept_queries_total` - Cross-dept queries

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Type check
npm run typecheck

# Unit/integration tests (offline-safe defaults)
npm test -- --runInBand

# Live LLM integration tests (requires real OPENAI_API_KEY)
npm run test:llm

# Lint
npm run lint
```

## License

MIT
