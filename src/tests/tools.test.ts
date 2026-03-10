import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { memosRecallTool, memosCrossDeptTool } from '../tools/recall';

jest.mock('../utils/config', () => ({
  getAgentConfig: jest.fn(),
  getDepartmentConfig: jest.fn()
}));

describe('Recall Tools', () => {
  let mockClient: any;
  const mockConfig: any = {
    departments: {
      ops: ['main'],
      devops: ['kernel'],
      management: ['coo']
    }
  };

  beforeEach(() => {
    mockClient = {
      searchFacts: jest.fn(async () => [{ uuid: 'f1', fact: 'test fact' }])
    };
  });

  it('memosRecallTool should prefer policy config department', async () => {
    const { getAgentConfig } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      department: 'devops',
      access_level: 'restricted',
      recall: {
        content_types: ['fact'],
        max_results: 10,
        reranker: 'rrf',
        min_importance: 1
      }
    });

    const result = await memosRecallTool(
      { query: 'deployment' },
      { agentId: 'kernel' },
      mockConfig,
      mockClient
    );

    expect(result.success).toBe(true);
    expect(mockClient.searchFacts).toHaveBeenCalledWith('devops', 'deployment', 10);
  });

  it('memosCrossDeptTool should deny inaccessible departments', async () => {
    const { getAgentConfig, getDepartmentConfig } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      department: 'ops',
      access_level: 'restricted',
      recall: {
        content_types: ['fact'],
        max_results: 10,
        reranker: 'rrf',
        min_importance: 1
      }
    });
    getDepartmentConfig.mockReturnValue({
      agents: ['coo'],
      access_level: 'confidential'
    });

    const result = await memosCrossDeptTool(
      { department: 'management', query: 'budget' },
      { agentId: 'main' },
      mockConfig,
      mockClient
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed');
    expect(mockClient.searchFacts).not.toHaveBeenCalled();
  });

  it('memosCrossDeptTool should allow accessible departments', async () => {
    const { getAgentConfig, getDepartmentConfig } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      department: 'management',
      access_level: 'confidential',
      recall: {
        content_types: ['fact'],
        max_results: 10,
        reranker: 'rrf',
        min_importance: 1
      }
    });
    getDepartmentConfig.mockReturnValue({
      agents: ['kernel'],
      access_level: 'restricted'
    });

    const result = await memosCrossDeptTool(
      { department: 'devops', query: 'deploy' },
      { agentId: 'coo' },
      mockConfig,
      mockClient
    );

    expect(result.success).toBe(true);
    expect(mockClient.searchFacts).toHaveBeenCalledWith('devops', 'deploy', 10);
  });
});
