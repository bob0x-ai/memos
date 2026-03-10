import { ClassificationResult, MemosNode } from '../types';

export const CONTENT_TYPES = [
  'fact',
  'decision',
  'preference',
  'learning',
  'summary',
  'sop',
  'warning',
  'contact'
] as const;

export const ENTITY_TYPES = [
  'Person',
  'System',
  'Project',
  'Error',
  'Document',
  'Organization'
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

export function validateContentType(contentType: string): boolean {
  return CONTENT_TYPES.includes(contentType as any);
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
  classification: ClassificationResult,
  agentConfig: { agentId: string; accessLevel: string; department: string },
  episodeId: string
): Partial<MemosNode> {
  return {
    content_type: classification.content_type as any,
    entity_type: classification.entity_type as any,
    access_level: agentConfig.accessLevel as any,
    importance: classification.importance as any,
    source_agent: agentConfig.agentId,
    source_episode: episodeId,
    group_id: agentConfig.department,
    created_at: new Date(),
    updated_at: new Date()
  };
}
