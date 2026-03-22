export interface Ontology {
  entity_types: string[];
}

export type AccessLevel = 'public' | 'restricted' | 'confidential';
export type CaptureScope = 'private' | 'department' | 'company';
export type RecallMode = 'facts' | 'summary';
export type RecallScope = 'self' | 'department' | 'company' | 'all_departments';

export interface DepartmentConfig {
  description?: string;
}

export interface AgentRecallConfig {
  mode: RecallMode;
  scopes: RecallScope[];
  max_results: number;
  min_importance: number;
}

export interface CaptureConfig {
  enabled: boolean;
  scope: CaptureScope;
}

export interface RoleConfig {
  access_level: AccessLevel;
  capture: CaptureConfig;
  recall: AgentRecallConfig;
}

export interface AgentOverrides {
  access_level?: AccessLevel;
  department?: string | null;
  capture?: Partial<CaptureConfig>;
  recall?: Partial<AgentRecallConfig>;
}

export interface AgentConfig {
  role: string;
  department: string;
}

export interface UnknownAgentPolicy {
  role: string;
  department: string | null;
}

export interface AgentResolvedConfig {
  role: string;
  department: string | null;
  access_level: AccessLevel;
  capture: CaptureConfig;
  recall: AgentRecallConfig;
}

export interface SummarizationLevel {
  level: number;
  target: string;
  max_entities: number;
}

export interface SummarizationConfig {
  enabled: boolean;
  cache_ttl_hours: number;
  levels: SummarizationLevel[];
}

export interface LLMPromptConfig {
  summarization_system: string;
}

export interface LLMConfig {
  model: string;
  temperature: number;
  max_tokens: number;
  prompts: LLMPromptConfig;
}

export interface MemosConfig {
  name: string;
  version: string;
  ontology: Ontology;
  departments: Record<string, DepartmentConfig>;
  roles: Record<string, RoleConfig>;
  agents: Record<string, AgentConfig>;
  unknown_agent_policy: UnknownAgentPolicy;
  overrides?: {
    agents?: Record<string, AgentOverrides>;
  };
  summarization: SummarizationConfig;
  llm: LLMConfig;
}

export interface MemosNode {
  uuid: string;
  name: string;
  group_id: string;
  entity_type?:
    | 'Person'
    | 'Preference'
    | 'Requirement'
    | 'Procedure'
    | 'Location'
    | 'Event'
    | 'Organization'
    | 'Service'
    | 'Project'
    | 'Issue'
    | 'Decision'
    | 'Document'
    | 'Topic'
    | 'Object';
  source_agent: string;
  source_episode: string;
  created_at: Date;
  updated_at: Date;
  expires_at?: Date;
  summary_level?: 0 | 1 | 2;
  summary_cache?: string;
  summary_cache_timestamp?: number;
  summary_content_hash?: string;
}
