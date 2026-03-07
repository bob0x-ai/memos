import { GraphitiClient } from '../graphiti-client';
import { MemosConfig } from '../config';
/**
 * Hook called at agent_end to capture episodes
 * @param event The hook event
 * @param ctx The plugin context
 * @param config MEMOS configuration
 * @param client Graphiti client
 */
export declare function captureHook(event: unknown, ctx: {
    agentId: string;
    messages: Array<{
        role: string;
        content: string;
    }>;
    userId?: string;
    sessionId?: string;
    channel?: string;
}, config: MemosConfig, client: GraphitiClient): Promise<void>;
//# sourceMappingURL=capture.d.ts.map