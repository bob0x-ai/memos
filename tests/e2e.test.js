#!/usr/bin/env node
/**
 * End-to-end integration test for MEMOS plugin
 * Verifies the full pipeline: add messages → entity extraction → search results
 */

const axios = require('axios');

const GRAPHITI_URL = process.env.GRAPHITI_URL || 'http://localhost:8000';
const TEST_GROUP = 'e2e-test-' + Date.now();
const MAX_WAIT_SECONDS = 60;
const POLL_INTERVAL_MS = 3000;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function addTestConversation() {
  console.log('Step 1: Adding test conversation...');
  
  const conversation = [
    {
      content: 'We need to migrate the database from PostgreSQL 13 to PostgreSQL 15',
      role_type: 'user',
      role: 'developer',
      timestamp: new Date().toISOString(),
      source_description: 'planning-meeting'
    },
    {
      content: 'That will require downtime. How long do you estimate?',
      role_type: 'assistant',
      role: 'kernel',
      timestamp: new Date(Date.now() + 1000).toISOString(),
      source_description: 'planning-meeting'
    },
    {
      content: 'About 2 hours. We should do it during the maintenance window on Sunday',
      role_type: 'user',
      role: 'developer',
      timestamp: new Date(Date.now() + 2000).toISOString(),
      source_description: 'planning-meeting'
    },
    {
      content: 'Agreed. I will prepare the migration scripts and backups',
      role_type: 'assistant',
      role: 'kernel',
      timestamp: new Date(Date.now() + 3000).toISOString(),
      source_description: 'planning-meeting'
    }
  ];
  
  try {
    const response = await axios.post(`${GRAPHITI_URL}/messages`, {
      group_id: TEST_GROUP,
      messages: conversation
    });
    
    if (response.status === 202) {
      console.log('   ✅ Conversation added successfully');
      console.log(`   Group ID: ${TEST_GROUP}`);
      console.log(`   Messages: ${conversation.length}`);
      return true;
    }
    return false;
  } catch (error) {
    console.log('   ❌ Failed to add conversation:', error.message);
    return false;
  }
}

async function pollForExtraction() {
  console.log(`\nStep 2: Waiting for entity extraction (up to ${MAX_WAIT_SECONDS}s)...`);
  
  const startTime = Date.now();
  let attempts = 0;
  
  while ((Date.now() - startTime) < MAX_WAIT_SECONDS * 1000) {
    attempts++;
    
    try {
      // Try searching for extracted entities
      const response = await axios.post(`${GRAPHITI_URL}/search`, {
        query: 'database migration PostgreSQL',
        group_ids: [TEST_GROUP],
        max_facts: 10
      });
      
      const results = response.data.results || [];
      
      if (results.length > 0) {
        console.log(`   ✅ Entities extracted after ${attempts} attempts (${Math.round((Date.now() - startTime)/1000)}s)`);
        console.log(`   Found ${results.length} facts`);
        return results;
      }
      
      process.stdout.write(`   Attempt ${attempts}... no results yet\r`);
      await sleep(POLL_INTERVAL_MS);
      
    } catch (error) {
      console.log(`   ⚠️  Poll error: ${error.message}`);
      await sleep(POLL_INTERVAL_MS);
    }
  }
  
  console.log(`   ❌ Timeout: No entities extracted after ${MAX_WAIT_SECONDS}s`);
  return null;
}

async function verifyFactContent(facts) {
  console.log('\nStep 3: Verifying extracted facts...');
  
  const expectedTopics = ['database', 'postgresql', 'migration'];
  let foundTopics = new Set();
  
  for (const fact of facts.slice(0, 3)) {
    console.log(`   Fact: ${fact.fact}`);
    
    const factLower = fact.fact.toLowerCase();
    for (const topic of expectedTopics) {
      if (factLower.includes(topic)) {
        foundTopics.add(topic);
      }
    }
  }
  
  console.log(`   Found topics: ${Array.from(foundTopics).join(', ')}`);
  
  if (foundTopics.size >= 2) {
    console.log('   ✅ Facts contain expected content');
    return true;
  } else {
    console.log('   ⚠️  Facts may not contain all expected topics');
    return false;
  }
}

async function testGetMemory() {
  console.log('\nStep 4: Testing get_memory with context...');
  
  try {
    const response = await axios.post(`${GRAPHITI_URL}/get-memory`, {
      group_id: TEST_GROUP,
      messages: [
        {
          content: 'When should we schedule the database migration?',
          role_type: 'user',
          role: 'user',
          timestamp: new Date().toISOString()
        }
      ],
      max_facts: 5,
      center_node_uuid: null
    });
    
    const facts = response.data.facts || [];
    console.log(`   ✅ Retrieved ${facts.length} contextual facts`);
    
    if (facts.length > 0) {
      console.log('   First contextual fact:', facts[0].fact);
    }
    
    return facts.length > 0;
  } catch (error) {
    console.log('   ❌ Get memory failed:', error.message);
    return false;
  }
}

async function cleanup() {
  console.log('\nStep 5: Cleaning up test data...');
  
  try {
    await axios.delete(`${GRAPHITI_URL}/group/${TEST_GROUP}`);
    console.log('   ✅ Test group deleted');
    return true;
  } catch (error) {
    console.log('   ⚠️  Cleanup error (non-critical):', error.message);
    return false;
  }
}

async function runE2ETest() {
  console.log('═══════════════════════════════════════════');
  console.log('MEMOS End-to-End Integration Test');
  console.log('═══════════════════════════════════════════');
  console.log(`Graphiti URL: ${GRAPHITI_URL}`);
  console.log(`Test Group: ${TEST_GROUP}\n`);
  
  const results = {
    addConversation: false,
    extraction: false,
    factContent: false,
    getMemory: false,
    cleanup: false
  };
  
  try {
    // Step 1: Add conversation
    results.addConversation = await addTestConversation();
    if (!results.addConversation) {
      throw new Error('Failed to add conversation');
    }
    
    // Step 2: Wait for extraction
    const facts = await pollForExtraction();
    results.extraction = facts !== null && facts.length > 0;
    
    if (!results.extraction) {
      console.log('\n⚠️  Entity extraction timeout - this may indicate:');
      console.log('   - OpenAI API key not configured');
      console.log('   - Graphiti LLM service not running');
      console.log('   - Network connectivity issues');
    } else {
      // Step 3: Verify content
      results.factContent = await verifyFactContent(facts);
      
      // Step 4: Test get_memory
      results.getMemory = await testGetMemory();
    }
    
  } catch (error) {
    console.error('\n❌ Test error:', error.message);
  } finally {
    // Step 5: Cleanup
    results.cleanup = await cleanup();
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════');
  console.log('End-to-End Test Summary');
  console.log('═══════════════════════════════════════════');
  console.log(`Add Conversation: ${results.addConversation ? '✅' : '❌'}`);
  console.log(`Entity Extraction: ${results.extraction ? '✅' : '❌'}`);
  console.log(`Fact Content: ${results.factContent ? '✅' : '❌'}`);
  console.log(`Get Memory: ${results.getMemory ? '✅' : '❌'}`);
  console.log(`Cleanup: ${results.cleanup ? '✅' : '⚠️'}`);
  
  const criticalPassed = results.addConversation && results.extraction;
  console.log(`\n${criticalPassed ? '✅ E2E TEST PASSED' : '❌ E2E TEST FAILED'}`);
  
  if (!results.extraction) {
    console.log('\nNote: Entity extraction requires OpenAI API key and may take 10-30 seconds');
    console.log('Check Graphiti logs: docker logs nsm-graphiti --tail 50');
  }
  
  process.exit(criticalPassed ? 0 : 1);
}

runE2ETest().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
