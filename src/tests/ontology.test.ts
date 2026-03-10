import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  CONTENT_TYPES,
  ENTITY_TYPES,
  ACCESS_LEVELS,
  ACCESS_LEVEL_HIERARCHY,
  getAccessFilter,
  validateContentType,
  validateEntityType,
  validateAccessLevel,
  validateImportance,
  createNodeProperties
} from '../ontology';
import { ClassificationResult } from '../types';

describe('Ontology', () => {
  describe('Constants', () => {
    it('should have 8 content types', () => {
      expect(CONTENT_TYPES).toHaveLength(8);
      expect(CONTENT_TYPES).toContain('fact');
      expect(CONTENT_TYPES).toContain('decision');
      expect(CONTENT_TYPES).toContain('preference');
      expect(CONTENT_TYPES).toContain('learning');
      expect(CONTENT_TYPES).toContain('summary');
      expect(CONTENT_TYPES).toContain('sop');
      expect(CONTENT_TYPES).toContain('warning');
      expect(CONTENT_TYPES).toContain('contact');
    });

    it('should have 6 entity types', () => {
      expect(ENTITY_TYPES).toHaveLength(6);
      expect(ENTITY_TYPES).toContain('Person');
      expect(ENTITY_TYPES).toContain('System');
      expect(ENTITY_TYPES).toContain('Project');
      expect(ENTITY_TYPES).toContain('Error');
      expect(ENTITY_TYPES).toContain('Document');
      expect(ENTITY_TYPES).toContain('Organization');
    });

    it('should have 3 access levels', () => {
      expect(ACCESS_LEVELS).toHaveLength(3);
      expect(ACCESS_LEVELS).toContain('public');
      expect(ACCESS_LEVELS).toContain('restricted');
      expect(ACCESS_LEVELS).toContain('confidential');
    });
  });

  describe('ACCESS_LEVEL_HIERARCHY', () => {
    it('should allow confidential access to all levels', () => {
      expect(ACCESS_LEVEL_HIERARCHY['confidential']).toEqual(['confidential', 'restricted', 'public']);
    });

    it('should allow restricted access to restricted and public', () => {
      expect(ACCESS_LEVEL_HIERARCHY['restricted']).toEqual(['restricted', 'public']);
    });

    it('should allow public access to public only', () => {
      expect(ACCESS_LEVEL_HIERARCHY['public']).toEqual(['public']);
    });
  });

  describe('getAccessFilter', () => {
    it('should return all levels for confidential', () => {
      expect(getAccessFilter('confidential')).toEqual(['confidential', 'restricted', 'public']);
    });

    it('should return restricted and public for restricted', () => {
      expect(getAccessFilter('restricted')).toEqual(['restricted', 'public']);
    });

    it('should return public only for public', () => {
      expect(getAccessFilter('public')).toEqual(['public']);
    });

    it('should default to public for unknown level', () => {
      expect(getAccessFilter('unknown')).toEqual(['public']);
    });
  });

  describe('validateContentType', () => {
    it('should validate valid content types', () => {
      expect(validateContentType('fact')).toBe(true);
      expect(validateContentType('decision')).toBe(true);
      expect(validateContentType('contact')).toBe(true);
    });

    it('should reject invalid content types', () => {
      expect(validateContentType('invalid')).toBe(false);
      expect(validateContentType('')).toBe(false);
      expect(validateContentType('FACT')).toBe(false); // Case sensitive
    });
  });

  describe('validateEntityType', () => {
    it('should validate valid entity types', () => {
      expect(validateEntityType('Person')).toBe(true);
      expect(validateEntityType('System')).toBe(true);
      expect(validateEntityType('Organization')).toBe(true);
    });

    it('should reject invalid entity types', () => {
      expect(validateEntityType('person')).toBe(false); // Case sensitive
      expect(validateEntityType('Invalid')).toBe(false);
      expect(validateEntityType('')).toBe(false);
    });
  });

  describe('validateAccessLevel', () => {
    it('should validate valid access levels', () => {
      expect(validateAccessLevel('public')).toBe(true);
      expect(validateAccessLevel('restricted')).toBe(true);
      expect(validateAccessLevel('confidential')).toBe(true);
    });

    it('should reject invalid access levels', () => {
      expect(validateAccessLevel('Public')).toBe(false);
      expect(validateAccessLevel('private')).toBe(false);
      expect(validateAccessLevel('')).toBe(false);
    });
  });

  describe('validateImportance', () => {
    it('should validate importance 1-5', () => {
      expect(validateImportance(1)).toBe(true);
      expect(validateImportance(3)).toBe(true);
      expect(validateImportance(5)).toBe(true);
    });

    it('should reject invalid importance', () => {
      expect(validateImportance(0)).toBe(false);
      expect(validateImportance(6)).toBe(false);
      expect(validateImportance(-1)).toBe(false);
    });
  });

  describe('createNodeProperties', () => {
    const classification: ClassificationResult = {
      content_type: 'fact',
      importance: 4,
      entity_type: 'System'
    };

    const agentConfig = {
      agentId: 'test-agent',
      accessLevel: 'restricted',
      department: 'test-devtest-ops'
    };

    const episodeId = 'episode-123';

    it('should create valid node properties', () => {
      const prtest-ops = createNodeProperties(classification, agentConfig, episodeId);

      expect(prtest-ops.content_type).toBe('fact');
      expect(prtest-ops.entity_type).toBe('System');
      expect(prtest-ops.access_level).toBe('restricted');
      expect(prtest-ops.importance).toBe(4);
      expect(prtest-ops.source_agent).toBe('test-agent');
      expect(prtest-ops.source_episode).toBe('episode-123');
      expect(prtest-ops.group_id).toBe('test-devtest-ops');
      expect(prtest-ops.created_at).toBeInstanceOf(Date);
      expect(prtest-ops.updated_at).toBeInstanceOf(Date);
    });

    it('should handle missing entity_type', () => {
      const noEntity = { ...classification, entity_type: undefined };
      const prtest-ops = createNodeProperties(noEntity, agentConfig, episodeId);

      expect(prtest-ops.entity_type).toBeUndefined();
      expect(prtest-ops.content_type).toBe('fact');
    });
  });
});
