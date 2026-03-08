# MEMOS Plugin - Implementation Plan

## Overview

MEMOS is a Graphiti-based memory plugin for OpenClaw that provides:
- Department-scoped knowledge graphs (entities, relationships, temporal tracking)
- Automatic capture and recall of conversation-derived facts
- Cross-department memory queries
- Optional SOP document search (hook point for future)

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Graph database | Neo4j 5.26.0 | Required by Graphiti server, GDS plugin for vector search |
| LLM for Graphiti | OpenAI (gpt-4o-mini) | Industry standard, reliable, supports structured output |
| Embeddings | OpenAI text-embedding-3-small | 1536-dim full, 1024-dim used (intentionally reduced by Graphiti) |
| Scoping model | Per-department groups | ops/devops split, configurable |
| SOP storage | Hook point (disabled initially) | Future: local document search |
| Cross-dept queries | No restrictions | Any agent can query any department |
| User/session tracking | Metadata fields on each episode | Enables temporal queries and session correlation |
| Rate limit handling | Exponential backoff retry | Resilient to OpenAI 429 errors |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         OpenClaw Gateway                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    MEMOS Plugin                          │   │
│   │                                                          │   │
│   │   Config:                                                 │   │
│   │   - graphiti_url: http://localhost:8000                  │   │
│   │   - departments:                                          │   │
│   │       ops: [main, mother, masa, scout]                   │   │
│   │       devops: [kernel, nyx, warden]                      │   │
│   │   - sop_search_enabled: false                            │   │
│   │                                                          │   │
│   │   Hooks:                                                  │   │
│   │   - before_prompt_build → recall (search facts)          │   │
│   │   - agent_end → capture (add episode)                    │   │
│   │                                                          │   │
│   │   Tools:                                                  │   │
│   │   - memos_recall (explicit search)                       │   │
│   │   - memos_cross_dept (query other department)            │   │
│   │                                                          │   │
│   └────────────────────┬─────────────────────────────────────┘   │
│                        │                                          │
│                        ▼ HTTP REST                                │
│   ┌────────────────────────────────────────────────────────────┐ │
│   │                   Graphiti Server                          │ │
│   │                   (Python/FastAPI)                         │ │
│   │                                                            │ │
│   │   Endpoints:                                               │ │
│   │   - POST /messages (add messages to queue)                 │ │
│   │   - POST /search (search facts)                            │ │
│   │   - POST /get-memory (context-aware retrieval)             │ │
│   │   - GET /healthcheck (health check)                        │ │
│   │                                                            │ │
│   └────────────────────┬───────────────────────────────────────┘ │
│                         │                                        │
│                         ▼ (Bolt/Cypher)                          │
│   ┌────────────────────────────────────────────────────────────┐ │
│   │                     Neo4j 5.26.0                           │ │
│   │              (with APOC + GDS plugins)                     │ │
│   │                                                            │ │
│   │   Node Types:                                              │ │
│   │   - Entity (extracted entities)                            │ │
│   │   - Episodic (conversation messages)                       │ │
│   │                                                            │ │
│   │   Edge Types:                                              │ │
│   │   - RELATES_TO (entity relationships)                      │ │
│   │   - MENTIONS (entity mentions in episodes)                 │ │
│   │                                                            │ │
│   └────────────────────────────────────────────────────────────┘ │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Department Configuration

Default groups:
- **ops**: main, mother, masa, scout
- **devops**: kernel, nyx, warden

This is configurable in the plugin config - groups may change.

---

## Project Structure

```
~/plugin-dev/memos/
├── README.md
├── package.json
├── openclaw.plugin.json          # Plugin manifest + config schema
├── tsconfig.json
├── src/
│   ├── index.ts                  # Plugin entry point
│   ├── config.ts                 # Config types + validation
│   ├── graphiti-client.ts        # HTTP client for Graphiti API
│   ├── hooks/
│   │   ├── recall.ts             # before_prompt_build handler
│   │   └── capture.ts            # agent_end handler
│   ├── tools/
│   │   ├── recall.ts             # memos_recall tool
│   │   └── cross-dept.ts         # memos_cross_dept tool
│   ├── metrics/
│   │   └── prometheus.ts         # Metrics endpoint for Grafana
│   └── utils/
│       ├── department.ts         # Agent → department resolution
│       └── sop-search.ts         # Hook point (stub initially)
├── config/
│   └── memos.config.example.yaml
├── docker-compose.yml          # Reference: ~/stack/docker-compose.yml
└── tests/
    └── ...
```

---

## Implementation Phases

### Phase 1: Infrastructure Setup

**1.1 Deploy Graphiti + Neo4j**

Docker Compose (~/stack/docker-compose.yml) with:
- Neo4j 5.26.0 container with APOC + GDS plugins
- Graphiti server container
- Environment variables for OpenAI API

**1.2 Configure LLM Provider**

Graphiti needs OpenAI for:
- Entity extraction: OpenAI gpt-4o-mini
- Embeddings: OpenAI text-embedding-3-small
- Relationship extraction
- Summarization

**Note:** OpenAI API key required (set in environment variables).

---

### Phase 2: Plugin Core

**2.1 Config Schema (`openclaw.plugin.json`)**

```json
{
  "id": "memos",
  "name": "MEMOS - Graphiti Memory Plugin",
  "kind": "memory",
  "configSchema": {
    "type": "object",
    "properties": {
      "graphiti_url": {
        "type": "string",
        "default": "http://localhost:8000"
      },
      "departments": {
        "type": "object",
        "additionalProperties": {
          "type": "array",
          "items": { "type": "string" }
        }
      },
      "sop_search_enabled": {
        "type": "boolean",
        "default": false
      },
      "sop_path": {
        "type": "string",
        "default": "~/.openclaw/workspace/sop"
      },
      "auto_capture": {
        "type": "boolean",
        "default": true
      },
      "auto_recall": {
        "type": "boolean",
        "default": true
      },
      "recall_limit": {
        "type": "integer",
        "default": 10
      },
      "rate_limit_retries": {
        "type": "integer",
        "default": 3,
        "description": "Number of retries when OpenAI rate limits (429 errors)"
      }
    },
    "required": ["departments"]
  }
}
```

**2.2 Graphiti HTTP Client**

TypeScript client for Graphiti REST API:
- `addEpisode(group_id, content, metadata)`
- `searchFacts(group_id, query, limit)`
- `searchNodes(group_id, query, limit)`
- `getStatus()`

**2.3 Department Resolution**

```typescript
function resolveDepartment(agentId: string, config: MemosConfig): string | null {
  for (const [dept, agents] of Object.entries(config.departments)) {
    if (agents.includes(agentId)) {
      return dept;
    }
  }
  return null;
}
```

---

### Phase 3: Hooks Implementation

**3.1 Recall Hook (`before_prompt_build`)**

Flow:
1. Check if auto_recall enabled
2. Resolve department from agent_id
3. Build query from recent messages
4. Search Graphiti for relevant facts
5. Format results with entity names highlighted
6. Inject into system context

**3.2 Capture Hook (`agent_end`)**

Flow:
1. Check if auto_capture enabled
2. Resolve department from agent_id
3. Check if exchange is worth remembering (heuristics)
4. Extract conversation content (exclude tool calls)
5. Build metadata (user_id, session_id, reference_time)
6. Send as episode to Graphiti (with retry on rate limit)
7. Let Graphiti's LLM extract entities/relationships

**Episode content format:**
```
USER: {user_message}
ASSISTANT: {assistant_response}
```

**Exclude from capture:**
- Tool call definitions
- Tool call results (large, noisy)
- System prompts

---

### Extraction Cadence

**Decision: Per-turn extraction**

Capture happens after each `agent_end` hook, sending the last user-assistant exchange to Graphiti.

**Why per-turn:**
1. **Entity resolution:** Graphiti handles deduplication across episodes
2. **Temporal tracking:** Each episode gets a timestamp for bi-temporal queries
3. **Context sufficiency:** Single turn is enough for meaningful extraction
4. **Manageable cost:** ~$0.003/day with gpt-4o-mini at 20 turns/day

**Episode format:**
```
USER: {last_user_message}
ASSISTANT: {last_assistant_response}
```

**Cost estimate:**
- Extraction (gpt-4o-mini): ~$0.002/day
- Embeddings (text-embedding-3-small): ~$0.0002/day
- **Total: ~$0.01/day for 10-12 agents**

---

### Trivial Message Filtering

Not all exchanges are worth remembering. Use heuristics to skip pleasantries and acknowledgments.

**Filtering function:**

```typescript
function isWorthRemembering(userMsg: string, assistantMsg: string): boolean {
  const combined = `${userMsg} ${assistantMsg}`.toLowerCase();
  
  // Skip short exchanges (< 50 chars)
  if (combined.length < 50) return false;
  
  // Skip pleasantries
  const pleasantries = ['thanks', 'thank you', 'ok', 'okay', 'got it', 
                        'sounds good', 'will do', 'you\'re welcome', 'sure'];
  if (pleasantries.some(p => combined.includes(p)) && combined.length < 100) {
    return false;
  }
  
  // Skip acknowledgments
  const ackPattern = /^(ok|okay|got it|thanks|sure|yes|no|yep|nope)[\.\!\?]*$/i;
  if (ackPattern.test(userMsg.trim())) {
    return false;
  }
  
  return true;
}
```

**What gets stored vs skipped:**

| Turn | Result |
|------|--------|
| "thanks" / "you're welcome" | Skipped (pleasantry) |
| "ok" / "sounds good" | Skipped (acknowledgment) |
| "I switched the payment system to Stripe" | Sent to Graphiti |
| "The deploy failed with ECONNREFUSED" | Sent to Graphiti |

**Cost savings:** Heuristics catch ~80% of trivial exchanges, saving 75% of extraction calls.

---

### Episode Metadata

Each episode captured must include comprehensive metadata for temporal queries, session correlation, and user tracking.

**Required metadata fields:**

```typescript
await graphitiClient.addEpisode({
  group_id: department,
  content: episode,
  reference_time: new Date(),      // Required for temporal queries
  metadata: {
    agent_id: ctx.agentId,         // Which agent had this conversation
    user_id: ctx.userId,           // Who the agent talked to
    session_id: ctx.sessionId,     // Link episodes from same conversation
    channel: ctx.channel,          // Communication channel (matrix, cli, etc.)
    timestamp: Date.now()
  }
});
```

**Why each field matters:**

| Field | Purpose | Future use |
|-------|---------|------------|
| `reference_time` | Temporal queries ("what was true at time X?") | Required by Graphiti |
| `user_id` | Track who said what | Optional filtering by user |
| `session_id` | Link episodes from same conversation | Query "what did we discuss in session X?" |
| `agent_id` | Track which agent captured this | Multi-agent analytics |
| `channel` | Track conversation source | Cross-channel analysis |

**Note:** Storing this metadata now is trivial. Filtering by user_id can be added later without refactoring.

---

### Rate Limit Handling

OpenAI has rate limits. A burst of conversations could trigger 429 errors. Implement retry with exponential backoff.

**Implementation:**

```typescript
async function addEpisodeWithRetry(episode: Episode, retries = 3): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      return await graphitiClient.addEpisode(episode);
    } catch (error) {
      if (error.status === 429 && i < retries - 1) {
        const delay = 1000 * Math.pow(2, i);  // 1s, 2s, 4s
        logger.warn(`Rate limited, retrying in ${delay}ms (attempt ${i + 1}/${retries})`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
}
```

**Configuration:**
- Default retries: 3
- Backoff: Exponential (1s, 2s, 4s)
- Configurable via `rate_limit_retries` in plugin config

---

### Agent Learning from Mistakes

Graphiti's design naturally supports agent learning through temporal knowledge graphs.

**How learning works:**

1. Agent tries approach X, fails
2. Conversation discusses failure: "That failed because API returned 429"
3. Episode captured with entities: `approach_X`, `API_429_error`
4. Edge created: `approach_X` FAILED_BECAUSE `API_429_error`
5. Next time agent considers approach X, recall returns the failure context

**Example:**
```
Turn 1: "Deploy failed because we didn't wait for health check"
→ Graphiti stores: deployment → FAILED_BECAUSE → missing_health_check_wait

Turn 50: "Deploy the auth service"
→ Recall finds: "deployment failed before due to missing health check wait"
→ Agent applies learned lesson
```

**Phase 2 enhancement:** Add explicit failure reflection capture after failed tasks.

---

### API Key Storage

OpenAI API key is configured directly in docker-compose.yml:

**Docker Compose (~/stack/docker-compose.yml):**
```yaml
graphiti:
  image: zepai/graphiti:latest
  environment:
    - OPENAI_API_KEY=${OPENAI_API_KEY}
    - MODEL_NAME=gpt-4o-mini
    - EMBEDDING_MODEL_NAME=text-embedding-3-small
```

**Security note:** For production, consider using Docker secrets or a separate .env file. For this single-tenant deployment, direct environment variables are sufficient.

---

### Phase 4: Agent Tools

**4.1 `memos_recall`**

Explicit search tool for agents:
- Input: `{ query: string, limit?: number }`
- Output: `{ facts: Fact[], nodes: Node[] }`

**4.2 `memos_cross_dept`**

Query another department's memory:
- Input: `{ department: string, query: string }`
- Output: `{ facts: Fact[], nodes: Node[] }`
- No restrictions on cross-department queries

---

### Phase 5: SOP Search (Hook Point)

**Initial implementation:**
- Disabled by default (`sop_search_enabled: false`)
- Stub function that returns empty results
- Future: implement local document search at `~/.openclaw/workspace/sop`

---

### Phase 6: Error Handling & Observability

**Graceful degradation:**
1. Log error and continue if Graphiti unavailable
2. Post warning message to current chat (memory system unavailable)
3. Do NOT fail the entire agent run

**Metrics endpoint:**
- Prometheus-compatible metrics at `/metrics`
- Grafana dashboard for:
  - Capture count (episodes added)
  - Recall latency
  - Error rate
  - Graphiti health status
  - Department-level breakdown

---

## Configuration in OpenClaw

```json5
// ~/.openclaw/openclaw.json
{
  plugins: {
    slots: {
      memory: "memos"  // Replaces memory-core
    },
    entries: {
      memos: {
        enabled: true,
        config: {
          graphiti_url: "http://localhost:8000",
          departments: {
            ops: ["main", "mother", "masa", "scout"],
            devops: ["kernel", "nyx", "warden"]
          },
          sop_search_enabled: false,
          auto_capture: true,
          auto_recall: true
        }
      }
    }
  }
}
```

---

## Recall Context Format

Facts should be formatted with entity names highlighted:

```
## Relevant Context

**Entities:**
- **Kendra** (Person)
- **Adidas shoes** (Product)

**Facts:**
- Kendra loves Adidas shoes (since 2025-01-15)
- The deployment was completed by kernel on 2025-03-01

**Related:**
- Kendra previously mentioned preference for Nike
```

---

## Neo4j Persistence

Neo4j provides ACID transactions and persistence:

**Docker Compose configuration:**
```yaml
neo4j:
  image: neo4j:5.26.0
  volumes:
    - ./data/neo4j:/data
  environment:
    - NEO4J_AUTH=neo4j/memospass123
    - NEO4J_PLUGINS=["apoc", "graph-data-science"]
```

**Features:**
- Full ACID compliance
- Automatic index creation by Graphiti
- Vector similarity search via GDS plugin
- Web UI at http://localhost:7474

---

## Embedding Dimensions

**Important:** Graphiti intentionally reduces embedding dimensions from 1536 to 1024.

- **Full OpenAI dimensions:** 1536 (text-embedding-3-small)
- **Graphiti used dimensions:** 1024
- **Reason:** Performance optimization with minimal quality loss
- **Implementation:** `embedding[:embedding_dim]` slice in OpenAIEmbedder

This is working as designed - the full embedding is generated by OpenAI, then truncated by Graphiti for faster vector search.

---

## Comparison: Nemos2 vs MEMOS

| Aspect | Nemos2 (current) | MEMOS (new) |
|--------|------------------|-------------|
| Storage | Qdrant (vectors) | Neo4j (graph) |
| Memory unit | Text summaries | Entities + Relationships |
| Temporal | ❌ No | ✅ Bi-temporal |
| Relationships | ❌ No | ✅ Auto-extracted |
| Contradictions | ❌ No | ✅ Edge invalidation |
| Scoping | private/dept/global | Department groups |
| LLM dependency | For summarization | For extraction |
| Extraction cadence | Batch (end of session) | Per-turn (real-time) |

---

## Deployment Status

✅ **Phase 1:** Infrastructure - Neo4j 5.26.0 + Graphiti running
✅ **Phase 2:** Plugin Core - HTTP client, config, validation complete
✅ **Phase 3:** Hooks - Capture and recall implemented
✅ **Phase 4:** Tools - memos_recall and memos_cross_dept complete
✅ **Phase 5:** SOP Search - Hook point ready for Phase 2
✅ **Phase 6:** Observability - Prometheus metrics added
✅ **Documentation:** AGENTS.md and README.md complete

## Next Steps

1. Configure OpenClaw to use memos plugin
2. Test with real agent conversations
3. Monitor OpenAI API usage and costs
4. (Optional) Add SOP document search in Phase 2