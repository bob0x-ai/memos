import { describe, expect, it } from '@jest/globals';
import {
  ACCESS_LEVELS,
  ACCESS_LEVEL_HIERARCHY,
  ENTITY_TYPES,
  createNodeProperties,
  getAccessFilter,
  validateAccessLevel,
  validateEntityType,
  validateImportance,
} from '../ontology';

describe('Ontology', () => {
  it('exposes the expected entity types', () => {
    expect(ENTITY_TYPES).toHaveLength(14);
    expect(ENTITY_TYPES).toContain('Person');
    expect(ENTITY_TYPES).toContain('Service');
    expect(ENTITY_TYPES).toContain('Project');
    expect(ENTITY_TYPES).toContain('Issue');
    expect(ENTITY_TYPES).toContain('Decision');
  });

  it('exposes the expected access levels', () => {
    expect(ACCESS_LEVELS).toEqual(['public', 'restricted', 'confidential']);
    expect(ACCESS_LEVEL_HIERARCHY.confidential).toEqual(['confidential', 'restricted', 'public']);
  });

  it('validates entity types and access levels', () => {
    expect(validateEntityType('Person')).toBe(true);
    expect(validateEntityType('service')).toBe(false);
    expect(validateAccessLevel('restricted')).toBe(true);
    expect(validateAccessLevel('private')).toBe(false);
  });

  it('validates importance bounds', () => {
    expect(validateImportance(1)).toBe(true);
    expect(validateImportance(5)).toBe(true);
    expect(validateImportance(0)).toBe(false);
  });

  it('returns access filters by hierarchy', () => {
    expect(getAccessFilter('confidential')).toEqual(['confidential', 'restricted', 'public']);
    expect(getAccessFilter('unknown')).toEqual(['public']);
  });

  it('creates node properties without legacy content taxonomy fields', () => {
    const props = createNodeProperties(
      { agentId: 'test-agent', groupId: 'ops' },
      'episode-123',
    );

    expect(props.source_agent).toBe('test-agent');
    expect(props.source_episode).toBe('episode-123');
    expect(props.group_id).toBe('ops');
    expect(props.created_at).toBeInstanceOf(Date);
    expect(props.updated_at).toBeInstanceOf(Date);
  });
});
