export interface Ontology {
  entity_types: string[];
  content_types: string[];
  access_levels: string[];
}

export interface DepartmentConfig {
  agents: string[];
  access_level: string;
}

export interface AgentRecallConfig {
  content_types: string[];
  max_results: number;
  reranker: 'rrf' | 'cross_encoder';
  min_importance: number;
}

export interface AgentConfig {
  department: string;
  access_level: string;
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
  agents: Record<string, AgentConfig>;
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
