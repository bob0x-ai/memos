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

---

## Phase 7: Permission Scoping & Structured Ontology

**Status:** ✅ Implemented and tested (46 tests passing)

### 7.1 YAML Configuration Engine

Configuration moved from JSON to YAML for better readability and structure:

**Location:** `config/memos.config.yaml`

```yaml
name: memos
version: 1.0.0

ontology:
  entity_types:
    - Person
    - System
    - Project
    - Error
    - Document
    - Organization
  
  content_types:
    - fact
    - decision
    - preference
    - learning
    - summary
    - sop
    - warning
    - contact
  
  access_levels:
    - public
    - restricted
    - confidential

departments:
  ops:
    agents: [main, mother, masa, scout]
    access_level: restricted
  devops:
    agents: [kernel, nyx, warden]
    access_level: restricted
  management:
    agents: [coo, ceo]
    access_level: confidential

agents:
  kernel:
    department: devops
    access_level: restricted
    recall:
      content_types: [fact, learning, warning, sop]
      max_results: 10
      reranker: rrf
      min_importance: 2
  
  coo:
    department: management
    access_level: confidential
    recall:
      content_types: [summary, decision]
      max_results: 5
      reranker: cross_encoder
```

### 7.2 Ontology Definition

**Entity Types (6):**

| Type | Description | Examples |
|------|-------------|----------|
| Person | Humans | Kendra, user_bob, admin |
| System | Technical systems | stripe-api, neo4j, server-01 |
| Project | Work initiatives | payment-migration, q4-audit |
| Error | Known issues | ECONNREFUSED, timeout-500 |
| Document | Reference docs | SOP-001, runbook-deploy |
| Organization | Groups/teams | ops-team, acme-corp |

**Content Types (8):**

| Type | Description | Access |
|------|-------------|--------|
| fact | Objective statement | All levels |
| decision | Choice made | restricted+ |
| preference | User/team preference | All levels |
| learning | Lesson from experience | restricted+ |
| summary | Aggregated content | management |
| sop | Standard procedure | restricted+ |
| warning | Risk or issue | All levels |
| contact | Person info | restricted+ |

**Access Levels (3):**

```
confidential (management) → sees everything
restricted (workers) → sees restricted + public
public (contractors) → sees public only
```

### 7.3 Node Properties Schema

```typescript
interface MemosNode {
  // Graphiti-managed
  uuid: string;
  name: string;
  group_id: string;  // department
  
  // MEMOS-managed
  entity_type?: 'Person' | 'System' | 'Project' | 'Error' | 'Document' | 'Organization';
  content_type: 'fact' | 'decision' | 'preference' | 'learning' | 'summary' | 'sop' | 'warning' | 'contact';
  access_level: 'public' | 'restricted' | 'confidential';
  importance: 1 | 2 | 3 | 4 | 5;
  
  // Metadata
  source_agent: string;
  source_episode: string;
  created_at: Date;
  updated_at: Date;
  expires_at?: Date;
}
```

### 7.4 Content Classification

**Implementation:** LLM-based with heuristic fallback

```typescript
// LLM classification (primary)
async function classifyContent(content: string): Promise<{
  content_type: string;
  importance: number;
}>

// Heuristic fallback (offline)
function classifyContentHeuristic(content: string): ClassificationResult
```

**Classification Categories:**
- **Decision:** "We decided to use Stripe"
- **Preference:** "I prefer dark mode"  
- **Warning:** "Don't run this on production"
- **Learning:** "We learned that retry logic fixes this"
- **Contact:** "Kendra is the admin"
- **SOP:** "To deploy, run these commands"
- **Fact:** Default for objective statements

**Importance Scale (1-5):**
- 1 = Trivial (pleasantries, acknowledgments)
- 2 = Low (minor details)
- 3 = Medium (useful context)
- 4 = High (important decisions/facts)
- 5 = Critical (must remember)

### 7.5 Enhanced Capture Hook

```typescript
// capture.ts
async function captureHook(event, ctx) {
  // 1. Check if worth remembering
  if (isPleasantry(content)) return;
  
  // 2. Classify content
  const classification = await classifyContent(content);
  
  // 3. Build episode with metadata
  const episode = {
    content,
    group_id: agentConfig.department,
    reference_time: new Date(),
    update_communities: true,  // Enable community detection
    metadata: {
      agent_id: ctx.agentId,
      access_level: agentConfig.access_level,
      content_type: classification.content_type,
      importance: classification.importance,
    }
  };
  
  // 4. Send to Graphiti
  await graphitiClient.addEpisode(episode);
}
```

### 7.6 Enhanced Recall Hook with Access Control

```typescript
// recall.ts
async function recallHook(event, ctx) {
  // 1. Get agent configuration
  const agentConfig = getAgentConfig(ctx.agentId);
  
  // 2. Build access filter
  const allowedAccessLevels = getAccessFilter(agentConfig.access_level);
  const allowedContentTypes = agentConfig.recall.content_types;
  const minImportance = agentConfig.recall.min_importance;
  
  // 3. Search with filters
  const results = await graphitiClient.search({
    query,
    group_ids: [agentConfig.department],
    access_levels: allowedAccessLevels,
    content_types: allowedContentTypes,
    min_importance: minImportance
  });
  
  // 4. Rerank (RRF or cross-encoder)
  const reranked = rrfRerank(results, agentConfig.recall.max_results);
  
  // 5. Inject into context
  return { prependSystemContext: formatContext(reranked) };
}
```

### 7.7 Access Control Implementation

```typescript
// Access hierarchy
const ACCESS_LEVEL_HIERARCHY = {
  'confidential': ['confidential', 'restricted', 'public'],
  'restricted': ['restricted', 'public'],
  'public': ['public']
};

// Check access
function canAccess(userLevel: string, nodeLevel: string): boolean {
  return ACCESS_LEVEL_HIERARCHY[userLevel].includes(nodeLevel);
}
```

### 7.8 Test Coverage

**Test Suites:** 5 files, 46 tests passing

| Test Suite | Tests | Coverage |
|------------|-------|----------|
| access.test.ts | 16 | Access hierarchy, filtering |
| ontology.test.ts | 11 | Entity/content type validation |
| classification.test.ts | 7 | Content type + importance |
| capture.test.ts | 6 | Episode capture with metadata |
| recall.test.ts | 6 | Access-filtered retrieval |

**Test Isolation:**
- Separate config: `config/memos.test.yaml`
- Test departments: `test-ops`, `test-devops`, `test-management`
- Test agents: `test-main`, `test-kernel`, `test-coo`

---

## Phase 8: Hierarchical Summarization

**Status:** 🟡 Design complete, implementation pending

### 8.1 Community Detection Strategy

**Approach:** Use Graphiti's built-in community detection

```typescript
// Every add_episode call includes:
{
  update_communities: true
}
```

- No separate cron job needed
- Communities update incrementally per episode
- Leiden algorithm via Neo4j GDS

### 8.2 Summary Node Generation

**Trigger:** After community detection completes (async)

```typescript
async function generateSummary(communityId: string, level: number) {
  // 1. Get community members
  const members = await getCommunityMembers(communityId);
  
  // 2. Check cache
  const cached = await getCachedSummary(communityId);
  if (cached && !isStale(cached, members)) {
    return cached.summary;
  }
  
  // 3. Generate summary via LLM
  const summary = await llm.summarize(members, {
    focus: level === 2 ? 'executive' : 'detailed'
  });
  
  // 4. Store as Summary node
  await storeSummary(communityId, level, summary);
  
  return summary;
}
```

### 8.3 Hierarchical Structure

```
Level 2 (Management)
├── Summary: "Department Overview"
│   ├── Level 1 (Team Lead)
│   │   ├── Summary: "Project Cluster A"
│   │   │   ├── Level 0 (Worker)
│   │   │   │   ├── Fact 1
│   │   │   │   ├── Fact 2
│   │   │   │   └── Fact 3
```

**Summary Caching:**

| Property | Value |
|----------|-------|
| Cache Location | Neo4j property on Community node |
| TTL | 4 hours |
| Invalidation | On new episode in community |
| Storage | `summary_cache`, `summary_cache_timestamp`, `summary_content_hash` |

### 8.4 Recall Hook v2 (Level-Aware)

```typescript
async function recallHookV2(event, ctx) {
  const agentConfig = getAgentConfig(ctx.agentId);
  
  // Determine query level based on access
  const queryLevel = agentConfig.access_level === 'confidential' ? 2 : 0;
  
  if (queryLevel === 2 && agentConfig.recall.include_details === false) {
    // Management: summaries only
    results = await querySummaryNodes({
      level: 2,
      access_level: agentConfig.access_level,
      content_types: ['summary', 'decision']
    });
  } else {
    // Workers: detailed facts
    results = await graphitiClient.search({
      group_ids: [agentConfig.department],
      access_levels: allowedAccessLevels,
      content_types: agentConfig.recall.content_types
    });
  }
  
  return formatContext(results);
}
```

### 8.5 Drill-Down Tool

```typescript
const memosDrillDown = {
  name: 'memos_drill_down',
  description: 'Get detailed facts underlying a summary',
  parameters: {
    summary_id: { type: 'string' },
    limit: { type: 'number', default: 10 }
  },
  
  async execute({ summary_id, limit }, ctx) {
    // Verify access
    if (ctx.agentAccessLevel !== 'confidential') {
      return { error: 'Insufficient access' };
    }
    
    // Get underlying facts
    const facts = await neo4j.query(`
      MATCH (s:Summary {uuid: $summaryId})-[:SUMMARIZES]->(e:Entity)
      RETURN e LIMIT $limit
    `, { summaryId: summary_id, limit });
    
    return { summary_id, facts };
  }
};
```

### 8.6 Implementation Timeline

**Phase 8.1:** Community Detection Integration
- Enable `update_communities: true` in capture hook ✅
- Verify Leiden algorithm working with test data

**Phase 8.2:** Summary Generation Service
- Implement summary generation logic
- Add LLM client for summarization
- Create Summary node schema

**Phase 8.3:** Caching Layer
- Implement cache storage in Neo4j
- Add TTL and invalidation logic
- Cache hit/miss metrics

**Phase 8.4:** Enhanced Recall
- Update recall hook for level-aware querying
- Add drill-down tool
- Test with management agents

---

## Updated Deployment Status

✅ **Phase 1:** Infrastructure - Neo4j 5.26.0 + Graphiti running  
✅ **Phase 2:** Plugin Core - HTTP client, config, validation complete  
✅ **Phase 3:** Hooks - Capture and recall implemented  
✅ **Phase 4:** Tools - memos_recall and memos_cross_dept complete  
✅ **Phase 5:** SOP Search - Hook point ready for Phase 2  
✅ **Phase 6:** Observability - Prometheus metrics added  
✅ **Phase 7:** Permission Scoping - YAML config, ontology, access control (46 tests passing)  
🟡 **Phase 8:** Hierarchical Summarization - Design complete, implementation pending  

## Next Steps

1. Configure OpenClaw to use memos plugin
2. Test with real agent conversations
3. Monitor OpenAI API usage and costs
4. (Optional) Add SOP document search in Phase 2