import { MemosConfig } from '../config';
/**
 * Resolve which department an agent belongs to
 * @param agentId The agent ID
 * @param config MEMOS configuration
 * @returns Department name or null if not found
 */
export declare function resolveDepartment(agentId: string, config: MemosConfig): string | null;
/**
 * Get all agents in a department
 * @param department Department name
 * @param config MEMOS configuration
 * @returns Array of agent IDs or empty array
 */
export declare function getDepartmentAgents(department: string, config: MemosConfig): string[];
/**
 * Check if an agent exists in any department
 * @param agentId The agent ID
 * @param config MEMOS configuration
 * @returns True if agent is found
 */
export declare function hasAgent(agentId: string, config: MemosConfig): boolean;
//# sourceMappingURL=department.d.ts.map