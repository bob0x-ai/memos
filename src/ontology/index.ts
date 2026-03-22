import { MemosNode } from '../types';

export const ENTITY_TYPES = [
  'Person',
  'Preference',
  'Requirement',
  'Procedure',
  'Location',
  'Event',
  'Organization',
  'Service',
  'Project',
  'Issue',
  'Decision',
  'Document',
  'Topic',
  'Object'
] as const;

export const ACCESS_LEVELS = ['public', 'restricted', 'confidential'] as const;

export const ACCESS_LEVEL_HIERARCHY: Record<string, string[]> = {
  'confidential': ['confidential', 'restricted', 'public'],
  'restricted': ['restricted', 'public'],
  'public': ['public']
};

export const CONTENT_TYPE_DESCRIPTIONS: Record<string, string> = {
  'fact': 'Objective statement about the world',
  'decision': 'A choice or decision that was made',
  'preference': 'What someone likes, wants, or prefers',
  'learning': 'Lesson learned from success or failure',
  'summary': 'Aggregated summary of other content',
  'sop': 'Standard operating procedure or process',
  'warning': 'Risk, issue, or cautionary information',
  'contact': 'Information about a person or entity'
};

export function getAccessFilter(agentAccessLevel: string): string[] {
  return ACCESS_LEVEL_HIERARCHY[agentAccessLevel] || ['public'];
}

export function validateEntityType(entityType: string): boolean {
  return ENTITY_TYPES.includes(entityType as any);
}

export function validateAccessLevel(accessLevel: string): boolean {
  return ACCESS_LEVELS.includes(accessLevel as any);
}

export function validateImportance(importance: number): boolean {
  return importance >= 1 && importance <= 5;
}

export function createNodeProperties(
  agentConfig: { agentId: string; groupId: string },
  episodeId: string
): Partial<MemosNode> {
  return {
    source_agent: agentConfig.agentId,
    source_episode: episodeId,
    group_id: agentConfig.groupId,
    created_at: new Date(),
    updated_at: new Date()
  };
}
