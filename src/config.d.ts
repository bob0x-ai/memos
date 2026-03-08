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
export declare const defaultConfig: Partial<MemosConfig>;
/**
 * Validate the configuration
 * @param config Configuration object
 * @throws Error if configuration is invalid
 */
export declare function validateConfig(config: unknown): asserts config is MemosConfig;
//# sourceMappingURL=config.d.ts.map