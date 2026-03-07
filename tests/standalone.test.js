#!/usr/bin/env node
/**
 * Standalone test runner for MEMOS plugin
 * Tests Graphiti integration without OpenClaw
 */

const axios = require('axios');

const GRAPHITI_URL = process.env.GRAPHITI_URL || 'http://localhost:8000';
const TEST_GROUP = 'test-ops';

async function testHealth() {
  console.log('1. Testing Graphiti health...');
  try {
    const response = await axios.get(`${GRAPHITI_URL}/healthcheck`);
    console.log('   ✅ Graphiti API is healthy');
    return true;
  } catch (error) {
    console.log('   ❌ Graphiti not accessible:', error.message);
    return false;
  }
}

async function testAddMessages() {
  console.log('\n2. Testing add messages...');
  try {
    const response = await axios.post(`${GRAPHITI_URL}/messages`, {
      group_id: TEST_GROUP,
      messages: [
        {
          content: 'I need to deploy the payment service using Stripe',
          role_type: 'user',
          role: 'user',
          timestamp: new Date().toISOString(),
          source_description: 'test-conversation'
        },
        {
          content: 'What stack are you using for the payment service?',
          role_type: 'assistant',
          role: 'assistant',
          timestamp: new Date().toISOString(),
          source_description: 'test-conversation'
        }
      ]
    });
    console.log('   ✅ Messages added (status:', response.status, ')');
    return true;
  } catch (error) {
    console.log('   ❌ Failed to add messages:', error.response?.data || error.message);
    return false;
  }
}

async function testSearch(query) {
  console.log(`\n3. Testing search: "${query}"...`);
  try {
    const response = await axios.post(`${GRAPHITI_URL}/search`, {
      query: query,
      group_ids: [TEST_GROUP],
      max_facts: 5
    });
    const results = response.data.results || [];
    console.log(`   ✅ Found ${results.length} results`);
    if (results.length > 0) {
      console.log('   First result:', results[0].fact);
    } else {
      console.log('   (Graphiti may still be processing - extraction is async)');
    }
    return results;
  } catch (error) {
    console.log('   ❌ Search failed:', error.response?.data || error.message);
    return null;
  }
}

async function testGetMemory() {
  console.log('\n4. Testing get_memory...');
  try {
    const response = await axios.post(`${GRAPHITI_URL}/get-memory`, {
      group_id: TEST_GROUP,
      messages: [
        {
          content: 'Tell me about the payment service deployment',
          role_type: 'user',
          role: 'user',
          timestamp: new Date().toISOString()
        }
      ],
      max_facts: 5,
      center_node_uuid: null
    });
    const facts = response.data.facts || [];
    console.log(`   ✅ Got memory with ${facts.length} facts`);
    if (facts.length === 0) {
      console.log('   (This is normal - Graphiti extracts entities asynchronously)');
    }
    return response.data;
  } catch (error) {
    console.log('   ❌ Get memory failed:', error.response?.data || error.message);
    return null;
  }
}

async function testTrivialFiltering() {
  console.log('\n5. Testing trivial message filtering logic...');
  
  const tests = [
    { user: 'thanks', assistant: "you're welcome", shouldCapture: false },
    { user: 'ok', assistant: 'sounds good', shouldCapture: false },
    { user: 'I need to deploy the payment service', assistant: 'What stack?', shouldCapture: true },
    { user: 'Deploy failed with error 500', assistant: 'Let me check the logs', shouldCapture: true }
  ];
  
  let passed = 0;
  for (const test of tests) {
    const combined = (test.user + ' ' + test.assistant).toLowerCase().trim();
    
    // Check for standalone acknowledgments
    const isStandaloneAck = /^(ok|okay|thanks|thank you|sure|yes|no|yep|nope)[\.\!\?]*$/i.test(test.user.trim());
    
    // Check for pleasantries in short messages
    const pleasantries = ['thanks', 'thank you', 'ok', 'okay', 'got it', 'sure'];
    const hasPleasantry = pleasantries.some(p => combined.includes(p));
    const isShort = combined.length < 50;
    
    const isTrivial = isStandaloneAck || (isShort && hasPleasantry);
    const shouldSkip = !test.shouldCapture;
    
    if (isTrivial === shouldSkip) {
      console.log(`   ✅ "${test.user.substring(0, 30)}..." - correctly ${shouldSkip ? 'filtered' : 'captured'}`);
      passed++;
    } else {
      console.log(`   ❌ "${test.user.substring(0, 30)}..." - unexpected (trivial=${isTrivial}, shouldSkip=${shouldSkip})`);
    }
  }
  
  console.log(`   Result: ${passed}/${tests.length} tests passed`);
  return passed === tests.length;
}

async function runTests() {
  console.log('═══════════════════════════════════════════');
  console.log('MEMOS Plugin Standalone Tests');
  console.log('═══════════════════════════════════════════');
  console.log(`Graphiti URL: ${GRAPHITI_URL}`);
  console.log(`Test Group: ${TEST_GROUP}\n`);

  const results = {
    health: false,
    addMessages: false,
    search: false,
    getMemory: false,
    filtering: false
  };

  // Test 1: Health check
  results.health = await testHealth();
  if (!results.health) {
    console.log('\n❌ Cannot continue without Graphiti. Is it running?');
    console.log('   Try: docker-compose up -d neo4j graphiti');
    process.exit(1);
  }

  // Test 2: Add messages
  results.addMessages = await testAddMessages();

  // Wait for Graphiti to process
  console.log('\n   Waiting 5s for Graphiti async processing...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test 3: Search (may return 0 results - extraction is async)
  if (results.addMessages) {
    const searchResults = await testSearch('payment service deployment');
    results.search = searchResults !== null; // Pass if API works, even if 0 results
    
    // Test 4: Get memory
    const memoryResults = await testGetMemory();
    results.getMemory = memoryResults !== null;
  }

  // Test 5: Filtering logic
  results.filtering = await testTrivialFiltering();

  // Summary
  console.log('\n═══════════════════════════════════════════');
  console.log('Test Summary');
  console.log('═══════════════════════════════════════════');
  console.log(`Health Check:     ${results.health ? '✅' : '❌'}`);
  console.log(`Add Messages:     ${results.addMessages ? '✅' : '❌'}`);
  console.log(`Search API:       ${results.search ? '✅' : '❌'}`);
  console.log(`Get Memory API:   ${results.getMemory ? '✅' : '❌'}`);
  console.log(`Message Filter:   ${results.filtering ? '✅' : '❌'}`);
  
  const criticalPassed = results.health && results.addMessages && results.search && results.getMemory;
  console.log(`\nNote: Search may return 0 results - Graphiti extracts entities asynchronously`);
  console.log(`Critical tests: ${criticalPassed ? '✅ PASSED' : '❌ FAILED'}`);
  
  process.exit(criticalPassed ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
