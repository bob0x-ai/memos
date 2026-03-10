// Test setup file
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-api-key';
process.env.GRAPHITI_URL = process.env.GRAPHITI_URL || 'http://localhost:8000';
process.env.NEO4J_URL = process.env.NEO4J_URL || 'bolt://localhost:7687';
process.env.NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
process.env.NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';
