import {
  AccessLevel,
  AgentRecallConfig,
  AgentResolvedConfig,
  CaptureConfig,
  MemosConfig,
  RoleConfig,
} from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'memos.config.yaml');
const TEST_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'memos.test.yaml');

const yaml = require('js-yaml') as { load: (input: string) => unknown };

let configCache: MemosConfig | null = null;

const DEFAULT_CONTRACTOR_ROLE = 'contractor';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeCaptureConfig(base: CaptureConfig, override?: Partial<CaptureConfig>): CaptureConfig {
  return {
    enabled: override?.enabled ?? base.enabled,
  };
}

function mergeRecallConfig(base: AgentRecallConfig, override?: Partial<AgentRecallConfig>): AgentRecallConfig {
  return {
    content_types: override?.content_types ?? base.content_types,
    max_results: override?.max_results ?? base.max_results,
    reranker: override?.reranker ?? base.reranker,
    min_importance: override?.min_importance ?? base.min_importance,
    department_scope: override?.department_scope ?? base.department_scope,
  };
}

function resolveRoleConfig(config: MemosConfig, roleName: string): RoleConfig | null {
  return config.roles[roleName] || null;
}

function resolveUnknownRole(config: MemosConfig): RoleConfig | null {
  const unknownRoleName = config.unknown_agent_policy?.role || DEFAULT_CONTRACTOR_ROLE;
  return resolveRoleConfig(config, unknownRoleName) || resolveRoleConfig(config, DEFAULT_CONTRACTOR_ROLE);
}

function validateDepartment(config: MemosConfig, department: string | null): string | null {
  if (!department) {
    return null;
  }
  if (!config.departments[department]) {
    logger.warn(`Configured department '${department}' not found; treating as unassigned`);
    return null;
  }
  return department;
}

export function loadConfig(): MemosConfig {
  if (configCache) {
    return configCache;
  }

  // Use test config in test environment
  const configPath = resolveConfigPath();
  
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = normalizeConfig(parseYaml(content));
    configCache = config;
    
    // In test mode, ensure all departments and agents are prefixed
    if (process.env.NODE_ENV === 'test' && process.env.MEMOS_TEST_GROUP) {
      config.name = `${config.name}-test-${process.env.MEMOS_TEST_GROUP}`;
    }
    
    return config;
  } catch (error) {
    logger.warn(`Failed to load config from ${configPath}, using defaults`, error);
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

function normalizeConfig(config: MemosConfig): MemosConfig {
  const normalized = clone(config);
  normalized.departments = normalized.departments || {};
  normalized.roles = normalized.roles || {};
  normalized.agents = normalized.agents || {};
  normalized.unknown_agent_policy = normalized.unknown_agent_policy || {
    role: DEFAULT_CONTRACTOR_ROLE,
    department: null,
  };
  normalized.overrides = normalized.overrides || {};
  normalized.overrides.agents = normalized.overrides.agents || {};

  return normalized;
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
      ops: {},
      devops: {}
    },
    roles: {
      worker: {
        access_level: 'restricted',
        capture: {
          enabled: true,
        },
        recall: {
          content_types: ['fact', 'learning', 'warning', 'sop'],
          max_results: 10,
          reranker: 'rrf',
          min_importance: 2,
          department_scope: 'own',
        },
      },
      management: {
        access_level: 'confidential',
        capture: {
          enabled: true,
        },
        recall: {
          content_types: ['summary'],
          max_results: 5,
          reranker: 'cross_encoder',
          min_importance: 3,
          department_scope: 'all',
        },
      },
      contractor: {
        access_level: 'public',
        capture: {
          enabled: false,
        },
        recall: {
          content_types: ['summary', 'fact'],
          max_results: 3,
          reranker: 'rrf',
          min_importance: 3,
          department_scope: 'all',
        },
      },
    },
    agents: {
      main: {
        role: 'management',
        department: 'ops',
      },
      kernel: {
        role: 'worker',
        department: 'devops',
      }
    },
    unknown_agent_policy: {
      role: 'contractor',
      department: null,
    },
    overrides: {
      agents: {},
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

export function getAgentConfig(agentId: string): AgentResolvedConfig | null {
  const config = loadConfig();
  const unknownRole = resolveUnknownRole(config);
  if (!unknownRole) {
    logger.error('No contractor/unknown role configured; cannot resolve agent policy');
    return null;
  }

  const assignment = config.agents[agentId];
  const requestedRole = assignment?.role || config.unknown_agent_policy.role;
  const resolvedRoleConfig = resolveRoleConfig(config, requestedRole);
  if (!resolvedRoleConfig) {
    logger.warn(`Role '${requestedRole}' not found for agent '${agentId}', using unknown-agent role`);
  }
  const roleName = resolvedRoleConfig ? requestedRole : config.unknown_agent_policy.role;
  const roleConfig = resolvedRoleConfig || unknownRole;

  const overrides = config.overrides?.agents?.[agentId];
  const departmentFromPolicy = assignment?.department ?? config.unknown_agent_policy.department;
  const department = validateDepartment(config, overrides?.department ?? departmentFromPolicy ?? null);

  const accessLevel = (overrides?.access_level ?? roleConfig.access_level) as AccessLevel;

  return {
    role: roleName,
    department,
    access_level: accessLevel,
    capture: mergeCaptureConfig(roleConfig.capture, overrides?.capture),
    recall: mergeRecallConfig(roleConfig.recall, overrides?.recall),
  };
}

export function getDepartmentConfig(departmentId: string): ReturnType<typeof loadConfig>['departments'][string] | null {
  const config = loadConfig();
  return config.departments[departmentId] || null;
}

export function getAllDepartments(): string[] {
  return Object.keys(loadConfig().departments);
}
