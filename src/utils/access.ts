import { getAccessFilter, ACCESS_LEVELS } from '../ontology';

export { getAccessFilter, ACCESS_LEVELS };

export function canAccess(
  userAccessLevel: string,
  nodeAccessLevel: string
): boolean {
  const allowedLevels = getAccessFilter(userAccessLevel);
  return allowedLevels.includes(nodeAccessLevel);
}

export function getDepartmentForAgent(
  agentId: string,
  departments: Record<string, { agents: string[] }>
): string | null {
  for (const [dept, config] of Object.entries(departments)) {
    if (config.agents.includes(agentId)) {
      return dept;
    }
  }
  return null;
}
