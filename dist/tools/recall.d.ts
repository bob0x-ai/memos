import { GraphitiClient } from '../graphiti-client';
import { MemosConfig } from '../config';
/**
 * Tool: memos_recall
 * Explicitly search for facts in the current agent's department memory
 *
 * @param params Tool parameters
 * @param params.query Search query
 * @param params.limit Maximum number of results (optional, default 10)
 * @param ctx Plugin context
 * @param config MEMOS configuration
 * @param client Graphiti client
 * @returns Search results
 */
export declare function memosRecallTool(params: {
    query: string;
    limit?: number;
}, ctx: {
    agentId: string;
}, config: MemosConfig, client: GraphitiClient): Promise<{
    success: boolean;
    facts: Array<{
        uuid: string;
        fact: string;
        valid_at?: string;
        invalid_at?: string;
    }>;
    error?: string;
}>;
/**
 * Tool: memos_cross_dept
 * Query another department's memory
 *
 * @param params Tool parameters
 * @param params.department Target department name
 * @param params.query Search query
 * @param params.limit Maximum number of results (optional, default 10)
 * @param ctx Plugin context
 * @param config MEMOS configuration
 * @param client Graphiti client
 * @returns Search results
 */
export declare function memosCrossDeptTool(params: {
    department: string;
    query: string;
    limit?: number;
}, ctx: {
    agentId: string;
}, config: MemosConfig, client: GraphitiClient): Promise<{
    success: boolean;
    facts: Array<{
        uuid: string;
        fact: string;
        valid_at?: string;
        invalid_at?: string;
    }>;
    error?: string;
}>;
/**
 * Tool definitions for OpenClaw
 */
export declare const toolDefinitions: ({
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                description: string;
                minimum: number;
                maximum: number;
            };
            department?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            department: {
                type: string;
                description: string;
            };
            query: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                description: string;
                minimum: number;
                maximum: number;
            };
        };
        required: string[];
    };
})[];
//# sourceMappingURL=recall.d.ts.map