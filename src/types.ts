export interface Ontology {
  entity_types: string[];
  content_types: string[];
  access_levels: string[];
}

export type AccessLevel = 'public' | 'restricted' | 'confidential';
export type RerankerType = 'rrf' | 'cross_encoder';
export type DepartmentScope = 'own' | 'all';

export interface DepartmentConfig {
  description?: string;
}

export interface AgentRecallConfig {
  content_types: string[];
  max_results: number;
  reranker: RerankerType;
  min_importance: number;
  department_scope: DepartmentScope;
}

export interface CaptureConfig {
  enabled: boolean;
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

export interface LLMConfig {
  model: string;
  temperature: number;
  max_tokens: number;
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
  entity_type?: 'Person' | 'System' | 'Project' | 'Error' | 'Document' | 'Organization';
  content_type: 'fact' | 'decision' | 'preference' | 'learning' | 'summary' | 'sop' | 'warning' | 'contact';
  access_level: 'public' | 'restricted' | 'confidential';
  importance: 1 | 2 | 3 | 4 | 5;
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

export interface ClassificationResult {
  content_type: string;
  importance: number;
  entity_type?: string;
}

export interface AccessFilter {
  access_levels: string[];
  content_types: string[];
  min_importance: number;
}
