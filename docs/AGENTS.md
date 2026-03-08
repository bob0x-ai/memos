# MEMOS Plugin - Agent Guidelines

## Overview

MEMOS (Memory Enhanced Multiagent Organizational System) is a Graphiti-based memory plugin for OpenClaw that provides temporal knowledge graphs with department scoping for AI agents.

## Quick Start

```bash
# Start services
cd ~/stack
docker-compose up -d neo4j graphiti

# Test the plugin
cd ~/plugin-dev/memos
npm run test:standalone
npm run test:e2e
```

## Architecture

```
OpenClaw Agent
    ↓
MEMOS Plugin (TypeScript)
    ↓ (HTTP)
Graphiti Server (Python/FastAPI)
    ↓ (Bolt/Cypher)
Neo4j (Knowledge Graph)
```

## Configuration

### Docker Compose (~/stack/docker-compose.yml)

```yaml
neo4j:
  image: neo4j:5.26.0
  environment:
    - NEO4J_AUTH=neo4j/memospass123
    - NEO4J_PLUGINS=["apoc", "graph-data-science"]
    - NEO4J_dbms_security_procedures_unrestricted=apoc.*,gds.*
    - NEO4J_dbms_security_procedures_allowlist=apoc.*,gds.*

graphiti:
  image: zepai/graphiti:latest
  environment:
    - OPENAI_API_KEY=${OPENAI_API_KEY}
    - MODEL_NAME=gpt-4o-mini
    - EMBEDDING_MODEL_NAME=text-embedding-3-small
    - NEO4J_URI=bolt://neo4j:7687
    - NEO4J_USER=neo4j
    - NEO4J_PASSWORD=memospass123
```

### OpenClaw Config (~/.openclaw/openclaw.json)

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
          "departments": {
            "ops": ["main", "mother", "masa", "scout"],
            "devops": ["kernel", "nyx", "warden"]
          },
          "auto_capture": true,
          "auto_recall": true,
          "recall_limit": 10
        }
      }
    }
  }
}
```

## Key Technical Details

### Embedding Dimensions
- **Model**: OpenAI text-embedding-3-small
- **Full dimensions**: 1536
- **Used dimensions**: 1024 (intentionally reduced by Graphiti for performance)
- This is working as designed - no action needed

### Entity Extraction Flow
1. Agent sends message
2. `agent_end` hook triggers
3. Plugin sends to Graphiti `/messages` endpoint
4. Graphiti queues async extraction job
5. OpenAI extracts entities and relationships
6. Neo4j stores: Episodic nodes → Entity nodes → RELATES_TO edges
7. Search available immediately after extraction (~10-30 seconds)

### Department Scoping
- Each department = separate Neo4j group
- Agents can query own department by default
- Cross-department queries via `memos_cross_dept` tool

## Testing

### Unit Tests
```bash
npm test
```

### Standalone Tests (API connectivity)
```bash
npm run test:standalone
```

### E2E Tests (Full pipeline)
```bash
npm run test:e2e
```

## Troubleshooting

### Graphiti can't connect to Neo4j
- Check Neo4j is fully started: `docker logs nsm-neo4j | grep "Started"`
- Restart Graphiti after Neo4j is ready: `docker restart nsm-graphiti`

### No entities extracted
- Check OpenAI dashboard for API usage
- Verify API key: `docker exec nsm-graphiti env | grep OPENAI`
- Check logs: `docker logs nsm-graphiti | tail -50`

### Search returns empty
- Extraction is async - wait 10-30 seconds
- Check entities exist: `docker exec nsm-neo4j cypher-shell "MATCH (n:Entity) RETURN count(n)"`

## Development

### Build
```bash
npm run build
```

### Watch mode
```bash
npm run dev
```

### Type checking
```bash
npm run typecheck
```

## File Structure

```
~/plugin-dev/memos/
├── src/
│   ├── index.ts              # Main plugin entry
│   ├── graphiti-client.ts    # HTTP client
│   ├── config.ts             # Configuration types
│   ├── hooks/
│   │   ├── capture.ts        # agent_end hook
│   │   └── recall.ts         # before_prompt_build hook
│   ├── tools/
│   │   └── recall.ts         # Agent tools
│   └── utils/
│       ├── department.ts     # Dept resolution
│       └── filter.ts         # Message filtering
├── tests/
│   ├── *.test.ts            # Unit tests
│   ├── standalone.test.js   # API tests
│   └── e2e.test.js          # Integration tests
├── docs/
│   ├── IMPLEMENTATION_PLAN.md
│   └── AGENTS.md
├── config/
│   └── memos.config.example.yaml
└── README.md
```

## Important Notes

- **Connection timing**: Graphiti must start AFTER Neo4j is fully ready
- **Async extraction**: Entity extraction takes 10-30 seconds (OpenAI API latency)
- **1024 dimensions**: This is intentional - Graphiti reduces dimensions for performance
- **No manual indexing**: Graphiti auto-creates all Neo4j indexes on startup

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `POST /messages` | Store conversation messages |
| `POST /search` | Search for facts |
| `POST /get-memory` | Context-aware memory retrieval |
| `GET /healthcheck` | Health check |
| `DELETE /group/{id}` | Delete department data |

## Resources

- Graphiti: https://github.com/getzep/graphiti
- Graphiti Server: https://github.com/getzep/graphiti/tree/main/server
- Neo4j: https://neo4j.com/docs/
- OpenAI Embeddings: https://platform.openai.com/docs/guides/embeddings
