import { MemosConfig } from './types';
import * as fs from 'fs';
import * as path from 'path';

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'memos.config.yaml');
const TEST_CONFIG_PATH = path.join(__dirname, '..', 'config', 'memos.test.yaml');

let configCache: MemosConfig | null = null;

export function loadConfig(): MemosConfig {
  if (configCache) {
    return configCache;
  }

  // Use test config in test environment
  const configPath = process.env.NODE_ENV === 'test' ? TEST_CONFIG_PATH : CONFIG_PATH;
  
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    // Simple YAML parsing - in production use a proper YAML parser
    const config = parseSimpleYaml(content) as MemosConfig;
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

function parseSimpleYaml(yaml: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = yaml.split('\n');
  let currentSection: string | null = null;
  let currentSubsection: string | null = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const indent = line.length - line.trimStart().length;
    
    if (indent === 0 && trimmed.includes(':')) {
      const [key, value] = trimmed.split(':').map(s => s.trim());
      if (value) {
        result[key] = value;
      } else {
        currentSection = key;
        result[currentSection] = {};
      }
    } else if (indent === 2 && currentSection) {
      if (trimmed.startsWith('-')) {
        // Array item
        const item = trimmed.substring(1).trim();
        if (!Array.isArray(result[currentSection])) {
          result[currentSection] = [];
        }
        result[currentSection].push(item);
      } else if (trimmed.includes(':')) {
        const [key, value] = trimmed.split(':').map(s => s.trim());
        if (value) {
          result[currentSection][key] = value;
        } else {
          currentSubsection = key;
          result[currentSection][currentSubsection] = {};
        }
      }
    } else if (indent === 4 && currentSection && currentSubsection) {
      if (trimmed.startsWith('-')) {
        const item = trimmed.substring(1).trim();
        if (!Array.isArray(result[currentSection][currentSubsection])) {
          result[currentSection][currentSubsection] = [];
        }
        result[currentSection][currentSubsection].push(item);
      } else if (trimmed.includes(':')) {
        const [key, value] = trimmed.split(':').map(s => s.trim());
        if (value) {
          result[currentSection][currentSubsection][key] = value;
        } else {
          result[currentSection][currentSubsection][key] = {};
        }
      }
    } else if (indent === 6) {
      // Deep nesting for agent recall config
      if (trimmed.includes(':')) {
        const [key, value] = trimmed.split(':').map(s => s.trim());
        if (currentSection && currentSubsection) {
          const parent = result[currentSection][currentSubsection];
          if (typeof parent === 'object') {
            parent[key] = value || {};
          }
        }
      }
    }
  }
  
  return result;
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
