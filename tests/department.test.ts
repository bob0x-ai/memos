import { resolveDepartment, getDepartmentAgents, hasAgent } from '../src/utils/department';
import { MemosConfig } from '../src/config';

describe('resolveDepartment', () => {
  const config: MemosConfig = {
    graphiti_url: 'http://localhost:8000',
    graphiti_backend: 'mcp',
    graphiti_mcp_url: 'http://localhost:8001/mcp/',
    graphiti_enable_rest_fallback: true,
    departments: {
      ops: ['main', 'mother', 'masa', 'scout'],
      devops: ['kernel', 'nyx', 'warden'],
    },
    sop_search_enabled: false,
    sop_path: '',
    auto_capture: true,
    auto_recall: true,
    recall_limit: 10,
    rate_limit_retries: 3,
  };

  test('finds agent in ops department', () => {
    expect(resolveDepartment('main', config)).toBe('ops');
    expect(resolveDepartment('mother', config)).toBe('ops');
  });

  test('finds agent in devops department', () => {
    expect(resolveDepartment('kernel', config)).toBe('devops');
    expect(resolveDepartment('nyx', config)).toBe('devops');
  });

  test('returns null for unknown agent', () => {
    expect(resolveDepartment('unknown', config)).toBeNull();
    expect(resolveDepartment('', config)).toBeNull();
  });

  test('handles empty departments', () => {
    const emptyConfig: MemosConfig = {
      ...config,
      departments: {},
    };
    expect(resolveDepartment('main', emptyConfig)).toBeNull();
  });
});

describe('getDepartmentAgents', () => {
  const config: MemosConfig = {
    graphiti_url: 'http://localhost:8000',
    graphiti_backend: 'mcp',
    graphiti_mcp_url: 'http://localhost:8001/mcp/',
    graphiti_enable_rest_fallback: true,
    departments: {
      ops: ['main', 'mother'],
      devops: ['kernel'],
    },
    sop_search_enabled: false,
    sop_path: '',
    auto_capture: true,
    auto_recall: true,
    recall_limit: 10,
    rate_limit_retries: 3,
  };

  test('returns agents for existing department', () => {
    expect(getDepartmentAgents('ops', config)).toEqual(['main', 'mother']);
    expect(getDepartmentAgents('devops', config)).toEqual(['kernel']);
  });

  test('returns empty array for unknown department', () => {
    expect(getDepartmentAgents('unknown', config)).toEqual([]);
  });
});

describe('hasAgent', () => {
  const config: MemosConfig = {
    graphiti_url: 'http://localhost:8000',
    graphiti_backend: 'mcp',
    graphiti_mcp_url: 'http://localhost:8001/mcp/',
    graphiti_enable_rest_fallback: true,
    departments: {
      ops: ['main'],
      devops: ['kernel'],
    },
    sop_search_enabled: false,
    sop_path: '',
    auto_capture: true,
    auto_recall: true,
    recall_limit: 10,
    rate_limit_retries: 3,
  };

  test('returns true for existing agents', () => {
    expect(hasAgent('main', config)).toBe(true);
    expect(hasAgent('kernel', config)).toBe(true);
  });

  test('returns false for unknown agents', () => {
    expect(hasAgent('unknown', config)).toBe(false);
    expect(hasAgent('', config)).toBe(false);
  });
});
