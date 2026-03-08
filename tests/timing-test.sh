#!/bin/bash
# OpenAI API Timing Test
# Measures latency for embeddings and chat completions

echo "═══════════════════════════════════════════════════"
echo "OpenAI API Timing Test"
echo "═══════════════════════════════════════════════════"
echo ""

API_KEY="${OPENAI_API_KEY:-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}"

echo "1. Testing Embeddings API (text-embedding-3-small)"
echo "   Input: 'Deploy the payment service'"
echo ""

start_time=$(date +%s%N)
curl -s -X POST https://api.openai.com/v1/embeddings \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Deploy the payment service",
    "model": "text-embedding-3-small"
  }' > /dev/null
end_time=$(date +%s%N)

elapsed=$(( (end_time - start_time) / 1000000 ))
echo "   Result: ${elapsed}ms"
echo ""

echo "2. Testing Chat Completions API (gpt-4o-mini)"
echo "   Input: 'Extract entities from: Deploy the payment service'"
echo ""

start_time=$(date +%s%N)
curl -s -X POST https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "Extract entities from the following text. Return as JSON."},
      {"role": "user", "content": "Deploy the payment service"}
    ],
    "max_tokens": 150,
    "temperature": 0.1
  }' > /dev/null
end_time=$(date +%s%N)

elapsed=$(( (end_time - start_time) / 1000000 ))
echo "   Result: ${elapsed}ms"
echo ""

echo "═══════════════════════════════════════════════════"
echo "Expected times:"
echo "  - Embeddings: 100-500ms"
echo "  - Chat: 500-2000ms"
echo "═══════════════════════════════════════════════════"
