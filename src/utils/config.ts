import { MemosConfig } from '../types';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'memos.config.yaml');
const TEST_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'memos.test.yaml');

const yaml = require('js-yaml') as { load: (input: string) => unknown };

let configCache: MemosConfig | null = null;

export function loadConfig(): MemosConfig {
  if (configCache) {
    return configCache;
  }

  // Use test config in test environment
  const configPath = resolveConfigPath();
  
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = parseYaml(content);
    configCache = config;
    
    // In test mode, ensure all departments and agents are prefixed
    if (process.env.NODE_ENV === 'test' && process.env.MEMOS_TEST_GROUP) {
      config.name = `${config.name}-test-${process.env.MEMOS_TEST_GROUP}`;
    }
    
    return config;
  } catch (error) {
    console.warn(`Failed to load config from ${configPath}, using defaults:`, error);
    return getDefaultConfig();
  }
}

function resolveConfigPath(): string {
  if (process.env.MEMOS_CONFIG_PATH) {
    return path.resolve(process.env.MEMOS_CONFIG_PATH);
  }
  return process.env.NODE_ENV === 'test' ? TEST_CONFIG_PATH : CONFIG_PATH;
}

function parseYaml(content: string): MemosConfig {
  const parsed = yaml.load(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid config: expected top-level object');
  }
  return parsed as MemosConfig;
}

function getDefaultConfig(): MemosConfig {
  return {
    name: 'memos',
    version: '1.0.0',
    ontology: {
      entity_types: ['Person', 'System', 'Project', 'Error', 'Document', 'Organization'],
      content_types: ['fact', 'decision', 'preference', 'learning', 'summary', 'sop', 'warning', 'contact'],
      access_levels: ['public', 'restricted', 'confidential']
    },
    departments: {
      ops: { agents: ['main'], access_level: 'restricted' },
      devops: { agents: ['kernel'], access_level: 'restricted' }
    },
    agents: {
      main: {
        department: 'ops',
        access_level: 'restricted',
        recall: {
          content_types: ['fact', 'preference'],
          max_results: 10,
          reranker: 'rrf',
          min_importance: 2
        }
      },
      kernel: {
        department: 'devops',
        access_level: 'restricted',
        recall: {
          content_types: ['fact', 'learning', 'warning', 'sop'],
          max_results: 10,
          reranker: 'rrf',
          min_importance: 2
        }
      }
    },
    summarization: {
      enabled: true,
      cache_ttl_hours: 4,
      levels: [
        { level: 0, target: 'workers', max_entities: 20 },
        { level: 1, target: 'team_leads', max_entities: 50 },
        { level: 2, target: 'management', max_entities: 100 }
      ]
    },
    llm: {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 500
    }
  };
}

export function clearConfigCache(): void {
  configCache = null;
}

export function getAgentConfig(agentId: string): ReturnType<typeof loadConfig>['agents'][string] | null {
  const config = loadConfig();
  return config.agents[agentId] || null;
}

export function getDepartmentConfig(departmentId: string): ReturnType<typeof loadConfig>['departments'][string] | null {
  const config = loadConfig();
  return config.departments[departmentId] || null;
}
