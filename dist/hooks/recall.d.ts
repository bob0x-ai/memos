import { GraphitiClient } from '../graphiti-client';
import { MemosConfig } from '../config';
/**
 * Format search results into context for the agent
 * @param facts Array of fact results
 * @param nodes Array of node results
 * @returns Formatted context string
 */
export declare function formatFactsAsContext(facts: Array<{
    uuid: string;
    fact: string;
    valid_at?: string;
    invalid_at?: string;
}>, nodes: Array<{
    uuid: string;
    name: string;
    summary: string;
    labels: string[];
}>): string;
/**
 * Build a search query from recent messages
 * @param messages Array of messages
 * @returns Query string
 */
export declare function buildQueryFromMessages(messages: Array<{
    role: string;
    content: string;
}>): string;
/**
 * Hook called at before_prompt_build to recall relevant facts
 * @param event The hook event
 * @param ctx The plugin context
 * @param config MEMOS configuration
 * @param client Graphiti client
 * @returns Object with context to inject
 */
export declare function recallHook(event: unknown, ctx: {
    agentId: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
}, config: MemosConfig, client: GraphitiClient): Promise<{
    prependSystemContext?: string;
}>;
//# sourceMappingURL=recall.d.ts.map