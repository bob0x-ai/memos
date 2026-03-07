import { MemosConfig } from '../config';

/**
 * Resolve which department an agent belongs to
 * @param agentId The agent ID
 * @param config MEMOS configuration
 * @returns Department name or null if not found
 */
export function resolveDepartment(agentId: string, config: MemosConfig): string | null {
  for (const [dept, agents] of Object.entries(config.departments)) {
    if (agents.includes(agentId)) {
      return dept;
    }
  }
  return null;
}

/**
 * Get all agents in a department
 * @param department Department name
 * @param config MEMOS configuration
 * @returns Array of agent IDs or empty array
 */
export function getDepartmentAgents(department: string, config: MemosConfig): string[] {
  return config.departments[department] || [];
}

/**
 * Check if an agent exists in any department
 * @param agentId The agent ID
 * @param config MEMOS configuration
 * @returns True if agent is found
 */
export function hasAgent(agentId: string, config: MemosConfig): boolean {
  for (const agents of Object.values(config.departments)) {
    if (agents.includes(agentId)) {
      return true;
    }
  }
  return false;
}
