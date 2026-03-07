/**
 * MEMOS plugin configuration
 */
export interface MemosConfig {
  /** URL of the Graphiti server */
  graphiti_url: string;
  
  /** Department to agent mappings */
  departments: Record<string, string[]>;
  
  /** Enable SOP document search */
  sop_search_enabled: boolean;
  
  /** Path to SOP documents */
  sop_path: string;
  
  /** Automatically capture episodes after agent responses */
  auto_capture: boolean;
  
  /** Automatically recall relevant facts before agent prompts */
  auto_recall: boolean;
  
  /** Maximum number of facts to recall */
  recall_limit: number;
  
  /** Number of retries when OpenAI rate limits */
  rate_limit_retries: number;
}

/**
 * Default configuration
 */
export const defaultConfig: Partial<MemosConfig> = {
  graphiti_url: 'http://localhost:8000',
  sop_search_enabled: false,
  sop_path: '~/.openclaw/workspace/sop',
  auto_capture: true,
  auto_recall: true,
  recall_limit: 10,
  rate_limit_retries: 3,
};

/**
 * Validate the configuration
 * @param config Configuration object
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: unknown): asserts config is MemosConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('MEMOS configuration must be an object');
  }

  const c = config as Record<string, unknown>;

  // Check departments
  if (!c.departments || typeof c.departments !== 'object') {
    throw new Error('MEMOS configuration requires "departments" object');
  }

  // Validate each department has an array of agent IDs
  for (const [dept, agents] of Object.entries(c.departments)) {
    if (!Array.isArray(agents)) {
      throw new Error(`Department "${dept}" must be an array of agent IDs`);
    }
  }

  // Check graphiti_url
  if (c.graphiti_url !== undefined && typeof c.graphiti_url !== 'string') {
    throw new Error('graphiti_url must be a string');
  }

  // Check other numeric/boolean fields
  const booleanFields = ['sop_search_enabled', 'auto_capture', 'auto_recall'];
  for (const field of booleanFields) {
    if (c[field] !== undefined && typeof c[field] !== 'boolean') {
      throw new Error(`${field} must be a boolean`);
    }
  }

  const numericFields = ['recall_limit', 'rate_limit_retries'];
  for (const field of numericFields) {
    if (c[field] !== undefined && typeof c[field] !== 'number') {
      throw new Error(`${field} must be a number`);
    }
  }
}
