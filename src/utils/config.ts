import {
  AccessLevel,
  AgentRecallConfig,
  AgentResolvedConfig,
  CaptureConfig,
  CaptureScope,
  MemosConfig,
  RecallScope,
  RoleConfig,
} from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

function resolveProjectRoot(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..'),
    path.resolve(__dirname, '..', '..'),
  ];

  for (const candidate of candidates) {
    const configPath = path.join(candidate, 'config', 'memos.config.yaml');
    if (fs.existsSync(configPath)) {
      return candidate;
    }
  }

  return candidates[0];
}

const PROJECT_ROOT = resolveProjectRoot();
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'memos.config.yaml');
const TEST_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'memos.test.yaml');

const yaml = require('js-yaml') as { load: (input: string) => unknown };

let configCache: MemosConfig | null = null;

const DEFAULT_CONTRACTOR_ROLE = 'contractor';
export const COMPANY_DEPARTMENT_ID = 'company';
export const DEFAULT_LLM_PROMPTS = {
  summarization_system:
    'You summarize memory facts for executives. Return concise markdown/plain text only, ready to inject directly into chat context. Structure the output with short topic sections using headings like "Topic: <name>" followed by 1-3 concise bullet points. Do not return JSON. Do not include startup/session/bootstrap chatter, self-referential memory-system meta commentary, duplicate points, or source fact IDs. Prefer concrete project/workstream facts over generic statements. If nothing relevant remains, say "No relevant memory signals were found for this query."',
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeCaptureConfig(base: CaptureConfig, override?: Partial<CaptureConfig>): CaptureConfig {
  return {
    enabled: override?.enabled ?? base.enabled,
    scope: override?.scope ?? base.scope,
  };
}

function mergeRecallConfig(base: AgentRecallConfig, override?: Partial<AgentRecallConfig>): AgentRecallConfig {
  return {
    mode: override?.mode ?? base.mode,
    scopes: override?.scopes ?? base.scopes,
    max_results: override?.max_results ?? base.max_results,
    min_importance: override?.min_importance ?? base.min_importance,
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
    configCache = getDefaultConfig();
    return configCache;
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
  normalized.llm = normalized.llm || {
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 500,
    prompts: { ...DEFAULT_LLM_PROMPTS },
  };
  normalized.llm.prompts = {
    ...DEFAULT_LLM_PROMPTS,
    ...(normalized.llm.prompts || {}),
  };
  normalizeRolePolicies(normalized);

  return normalized;
}

function normalizeRolePolicies(config: MemosConfig): void {
  for (const roleConfig of Object.values(config.roles)) {
    const capture = roleConfig.capture as CaptureConfig & { [key: string]: unknown };
    if (!capture.scope) {
      capture.scope = 'department';
    }

    const recall = roleConfig.recall as AgentRecallConfig & {
      [key: string]: unknown;
      content_types?: string[];
      department_scope?: string;
    };

    if (!recall.mode) {
      const legacyContentTypes = Array.isArray(recall.content_types) ? recall.content_types : [];
      recall.mode =
        legacyContentTypes.length === 1 && legacyContentTypes[0] === 'summary'
          ? 'summary'
          : 'facts';
    }

    if (!Array.isArray(recall.scopes) || recall.scopes.length === 0) {
      const legacyDepartmentScope = recall.department_scope === 'all' ? 'all' : 'own';
      const scopes: RecallScope[] = [];
      if (recall.mode === 'summary') {
        scopes.push('self');
      }
      if (legacyDepartmentScope === 'all') {
        scopes.push('all_departments');
      } else {
        scopes.push('department');
      }
      if (!scopes.includes('company')) {
        scopes.push('company');
      }
      recall.scopes = scopes;
    }
  }
}

function getDefaultConfig(): MemosConfig {
  return {
    name: 'memos',
    version: '1.0.0',
    ontology: {
      entity_types: [
        'Person',
        'Preference',
        'Requirement',
        'Procedure',
        'Location',
        'Event',
        'Organization',
        'Service',
        'Project',
        'Issue',
        'Decision',
        'Document',
        'Topic',
        'Object',
      ],
    },
    departments: {
      ops: {},
      devops: {},
      company: {}
    },
    roles: {
      worker: {
        access_level: 'restricted',
        capture: {
          enabled: true,
          scope: 'department',
        },
        recall: {
          mode: 'facts',
          scopes: ['department', 'company'],
          max_results: 10,
          min_importance: 2,
        },
      },
      management: {
        access_level: 'confidential',
        capture: {
          enabled: true,
          scope: 'private',
        },
        recall: {
          mode: 'summary',
          scopes: ['self', 'department', 'company'],
          max_results: 5,
          min_importance: 3,
        },
      },
      contractor: {
        access_level: 'public',
        capture: {
          enabled: false,
          scope: 'company',
        },
        recall: {
          mode: 'facts',
          scopes: ['company'],
          max_results: 3,
          min_importance: 3,
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
      max_tokens: 500,
      prompts: {
        ...DEFAULT_LLM_PROMPTS,
      },
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

export function getCompanyDepartmentId(): string | null {
  const departments = loadConfig().departments;
  return departments[COMPANY_DEPARTMENT_ID] ? COMPANY_DEPARTMENT_ID : null;
}

export function getCaptureGroupId(agentId: string, agentConfig: AgentResolvedConfig): string | null {
  switch (agentConfig.capture.scope as CaptureScope) {
    case 'private':
      return agentId;
    case 'department':
      return agentConfig.department;
    case 'company':
      return getCompanyDepartmentId();
    default:
      return agentConfig.department;
  }
}

export function getGroupsForRecall(agentId: string, agentConfig: AgentResolvedConfig): string[] {
  const groups: string[] = [];
  const allDepartments = getAllDepartments().filter((department) => department !== COMPANY_DEPARTMENT_ID);

  for (const scope of agentConfig.recall.scopes) {
    switch (scope) {
      case 'self':
        groups.push(agentId);
        break;
      case 'department':
        if (agentConfig.department) {
          groups.push(agentConfig.department);
        }
        break;
      case 'company': {
        const companyDepartment = getCompanyDepartmentId();
        if (companyDepartment) {
          groups.push(companyDepartment);
        }
        break;
      }
      case 'all_departments':
        groups.push(...allDepartments);
        break;
      default:
        break;
    }
  }

  return [...new Set(groups.filter(Boolean))];
}
