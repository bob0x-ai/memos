"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDepartment = resolveDepartment;
exports.getDepartmentAgents = getDepartmentAgents;
exports.hasAgent = hasAgent;
/**
 * Resolve which department an agent belongs to
 * @param agentId The agent ID
 * @param config MEMOS configuration
 * @returns Department name or null if not found
 */
function resolveDepartment(agentId, config) {
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
function getDepartmentAgents(department, config) {
    return config.departments[department] || [];
}
/**
 * Check if an agent exists in any department
 * @param agentId The agent ID
 * @param config MEMOS configuration
 * @returns True if agent is found
 */
function hasAgent(agentId, config) {
    for (const agents of Object.values(config.departments)) {
        if (agents.includes(agentId)) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=department.js.map