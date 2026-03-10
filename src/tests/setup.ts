// Test setup file
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-api-key';
process.env.GRAPHITI_URL = process.env.GRAPHITI_URL || 'http://localhost:8000';
process.env.NEO4J_URL = process.env.NEO4J_URL || 'bolt://localhost:7687';
process.env.NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
process.env.NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';

// Force test environment to use isolated test groups
process.env.NODE_ENV = 'test';
process.env.MEMOS_TEST_GROUP = `test-${Date.now()}`;

// Prevent test data from polluting production
if (process.env.NODE_ENV === 'test') {
  console.log(`[TEST SETUP] Using isolated test group: ${process.env.MEMOS_TEST_GROUP}`);
}
