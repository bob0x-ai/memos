import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  getAccessFilter,
  canAccess,
  getDepartmentForAgent
} from '../src/utils/access';

describe('Access Utils', () => {
  describe('getAccessFilter', () => {
    it('should return correct levels for confidential', () => {
      expect(getAccessFilter('confidential')).toEqual(['confidential', 'restricted', 'public']);
    });

    it('should return correct levels for restricted', () => {
      expect(getAccessFilter('restricted')).toEqual(['restricted', 'public']);
    });

    it('should return correct levels for public', () => {
      expect(getAccessFilter('public')).toEqual(['public']);
    });

    it('should default to public for unknown', () => {
      expect(getAccessFilter('unknown')).toEqual(['public']);
    });
  });

  describe('canAccess', () => {
    it('should allow confidential user to access confidential', () => {
      expect(canAccess('confidential', 'confidential')).toBe(true);
    });

    it('should allow confidential user to access restricted', () => {
      expect(canAccess('confidential', 'restricted')).toBe(true);
    });

    it('should allow confidential user to access public', () => {
      expect(canAccess('confidential', 'public')).toBe(true);
    });

    it('should allow restricted user to access restricted', () => {
      expect(canAccess('restricted', 'restricted')).toBe(true);
    });

    it('should allow restricted user to access public', () => {
      expect(canAccess('restricted', 'public')).toBe(true);
    });

    it('should NOT allow restricted user to access confidential', () => {
      expect(canAccess('restricted', 'confidential')).toBe(false);
    });

    it('should allow public user to access public', () => {
      expect(canAccess('public', 'public')).toBe(true);
    });

    it('should NOT allow public user to access restricted', () => {
      expect(canAccess('public', 'restricted')).toBe(false);
    });

    it('should NOT allow public user to access confidential', () => {
      expect(canAccess('public', 'confidential')).toBe(false);
    });
  });

  describe('getDepartmentForAgent', () => {
    const departments = {
      ops: { agents: ['main', 'mother'] },
      devops: { agents: ['kernel', 'nyx'] },
      management: { agents: ['coo', 'ceo'] }
    };

    it('should find department for existing agent', () => {
      expect(getDepartmentForAgent('main', departments)).toBe('ops');
      expect(getDepartmentForAgent('kernel', departments)).toBe('devops');
      expect(getDepartmentForAgent('coo', departments)).toBe('management');
    });

    it('should return null for unknown agent', () => {
      expect(getDepartmentForAgent('unknown', departments)).toBeNull();
    });

    it('should return null for empty departments', () => {
      expect(getDepartmentForAgent('main', {})).toBeNull();
    });
  });
});
