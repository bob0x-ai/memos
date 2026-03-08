#!/bin/bash
# Extended OpenAI API Timing Test
# Multiple samples to check consistency

echo "═══════════════════════════════════════════════════"
echo "Extended OpenAI API Timing Test (5 samples each)"
echo "═══════════════════════════════════════════════════"
echo ""

API_KEY="${OPENAI_API_KEY:-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}"

echo "1. Embeddings API (text-embedding-3-small)"
for i in 1 2 3 4 5; do
  start_time=$(date +%s%N)
  curl -s -X POST https://api.openai.com/v1/embeddings \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"input": "Deploy the payment service", "model": "text-embedding-3-small"}' > /dev/null
  end_time=$(date +%s%N)
  elapsed=$(( (end_time - start_time) / 1000000 ))
  echo "   Sample $i: ${elapsed}ms"
done

echo ""
echo "2. Chat Completions API (gpt-4o-mini)"
for i in 1 2 3; do
  start_time=$(date +%s%N)
  curl -s -X POST https://api.openai.com/v1/chat/completions \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "gpt-4o-mini",
      "messages": [
        {"role": "system", "content": "Extract entities from the following text. Return as JSON."},
        {"role": "user", "content": "Deploy the payment service using Stripe API for authentication"}
      ],
      "max_tokens": 200,
      "temperature": 0.1
    }' > /dev/null
  end_time=$(date +%s%N)
  elapsed=$(( (end_time - start_time) / 1000000 ))
  echo "   Sample $i: ${elapsed}ms"
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "Network latency check (ping to api.openai.com):"
ping -c 3 api.openai.com | grep "time=" | awk '{print "   " $7}'
