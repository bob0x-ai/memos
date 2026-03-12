import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  memosRecallTool,
  memosCrossDeptTool,
  memosDrillDownTool,
  memosAnnounceTool,
  memosBroadcastTool,
  memorySearchTool,
  memoryStoreTool,
} from '../tools/recall';

jest.mock('../utils/config', () => ({
  COMPANY_DEPARTMENT_ID: 'company',
  getAgentConfig: jest.fn(),
  getDepartmentsForRecall: jest.fn(),
  getCompanyDepartmentId: jest.fn(() => 'company'),
  getDepartmentConfig: jest.fn(),
}));

jest.mock('../utils/summarization', () => ({
  getSummaryDrillDown: jest.fn(),
}));

jest.mock('../utils/classification', () => ({
  classifyContent: jest.fn(async () => ({
    content_type: 'fact',
    importance: 3,
  })),
}));

describe('Recall Tools', () => {
  let mockClient: any;
  const mockConfig: any = {
    departments: {
      ops: ['main'],
      devops: ['kernel']
    }
  };

  beforeEach(() => {
    const { getDepartmentsForRecall } = require('../utils/config');
    getDepartmentsForRecall.mockReturnValue(['devops']);
    mockClient = {
      searchFacts: jest.fn(async () => [{ uuid: 'f1', fact: 'test fact' }]),
      addMessages: jest.fn(async () => true),
    };
  });

  it('memosRecallTool should prefer policy config department', async () => {
    const { getAgentConfig, getDepartmentsForRecall } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      department: 'devops',
      access_level: 'restricted',
      recall: {
        content_types: ['fact'],
        max_results: 10,
        reranker: 'rrf',
        min_importance: 1,
        department_scope: 'own'
      }
    });
    getDepartmentsForRecall.mockReturnValue(['devops']);

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
        min_importance: 1,
        department_scope: 'own'
      }
    });
    getDepartmentConfig.mockReturnValue({});

    const result = await memosCrossDeptTool(
      { department: 'devops', query: 'budget' },
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
      department: 'ops',
      access_level: 'confidential',
      recall: {
        content_types: ['fact'],
        max_results: 10,
        reranker: 'rrf',
        min_importance: 1,
        department_scope: 'all'
      }
    });
    getDepartmentConfig.mockReturnValue({});

    const result = await memosCrossDeptTool(
      { department: 'devops', query: 'deploy' },
      { agentId: 'coo' },
      mockConfig,
      mockClient
    );

    expect(result.success).toBe(true);
    expect(mockClient.searchFacts).toHaveBeenCalledWith('devops', 'deploy', 10);
  });

  it('memorySearchTool should behave like explicit recall search', async () => {
    const { getAgentConfig, getDepartmentsForRecall } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      department: 'devops',
      access_level: 'restricted',
      recall: {
        content_types: ['fact'],
        max_results: 10,
        reranker: 'rrf',
        min_importance: 1,
        department_scope: 'own'
      }
    });
    getDepartmentsForRecall.mockReturnValue(['devops']);

    const result = await memorySearchTool(
      { query: 'incident' },
      { agentId: 'kernel' },
      mockConfig,
      mockClient
    );

    expect(result.success).toBe(true);
    expect(mockClient.searchFacts).toHaveBeenCalledWith('devops', 'incident', 10);
  });

  it('memoryStoreTool should store explicit memory with metadata', async () => {
    const { getAgentConfig } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      role: 'worker',
      department: 'ops',
      access_level: 'restricted',
      capture: { enabled: true },
      recall: {
        content_types: ['fact'],
        max_results: 10,
        reranker: 'rrf',
        min_importance: 1,
        department_scope: 'own'
      }
    });

    const result = await memoryStoreTool(
      {
        text: 'The production deploy runbook now requires canary checks first.',
        content_type: 'sop',
        importance: 4,
      },
      { agentId: 'kernel', userId: 'user-1', sessionId: 'session-1' },
      { ...mockConfig, rate_limit_retries: 1 },
      mockClient
    );

    expect(result.success).toBe(true);
    expect(mockClient.addMessages).toHaveBeenCalled();
  });

  it('memoryStoreTool should deny disabled capture policy', async () => {
    const { getAgentConfig } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      role: 'contractor',
      department: null,
      access_level: 'public',
      capture: { enabled: false },
      recall: {
        content_types: ['summary'],
        max_results: 3,
        reranker: 'rrf',
        min_importance: 1,
        department_scope: 'all'
      }
    });

    const result = await memoryStoreTool(
      { text: 'Attempted note' },
      { agentId: 'contractor-1' },
      { ...mockConfig, rate_limit_retries: 1 },
      mockClient
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Capture is disabled');
  });

  it('memosDrillDownTool should deny non-confidential agents', async () => {
    const { getAgentConfig } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      department: 'devops',
      access_level: 'restricted',
      recall: {
        content_types: ['fact'],
        max_results: 10,
        reranker: 'rrf',
        min_importance: 1,
        department_scope: 'own'
      }
    });

    const result = await memosDrillDownTool(
      { summary_id: 'sum_abc123' },
      { agentId: 'kernel' },
      mockConfig,
      mockClient
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('memosDrillDownTool should return underlying facts for confidential agents', async () => {
    const { getAgentConfig } = require('../utils/config');
    const { getSummaryDrillDown } = require('../utils/summarization');
    getAgentConfig.mockReturnValue({
      department: 'ops',
      access_level: 'confidential',
      recall: {
        content_types: ['summary'],
        max_results: 5,
        reranker: 'cross_encoder',
        min_importance: 1,
        department_scope: 'all'
      }
    });
    getSummaryDrillDown.mockReturnValue({
      status: 'ok',
      data: {
        summaryId: 'sum_abc123',
        summary: 'Executive summary text',
        facts: [
          { uuid: 'f1', fact: 'Detail A', content_type: 'fact', importance: 4, _department: 'ops' },
          { uuid: 'f2', fact: 'Detail B', content_type: 'decision', importance: 5, _department: 'devops' },
        ],
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 3600000,
      }
    });

    const result = await memosDrillDownTool(
      { summary_id: 'sum_abc123', limit: 2 },
      { agentId: 'main' },
      mockConfig,
      mockClient
    );

    expect(result.success).toBe(true);
    expect(result.facts).toHaveLength(2);
    expect(result.facts[0].fact).toBe('Detail A');
  });

  it('memosDrillDownTool should handle unknown summary IDs', async () => {
    const { getAgentConfig } = require('../utils/config');
    const { getSummaryDrillDown } = require('../utils/summarization');
    getAgentConfig.mockReturnValue({
      department: 'ops',
      access_level: 'confidential',
      recall: {
        content_types: ['summary'],
        max_results: 5,
        reranker: 'cross_encoder',
        min_importance: 1,
        department_scope: 'all'
      }
    });
    getSummaryDrillDown.mockReturnValue({ status: 'not_found' });

    const result = await memosDrillDownTool(
      { summary_id: 'sum_missing' },
      { agentId: 'main' },
      mockConfig,
      mockClient
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('memosDrillDownTool should distinguish expired summaries', async () => {
    const { getAgentConfig } = require('../utils/config');
    const { getSummaryDrillDown } = require('../utils/summarization');
    getAgentConfig.mockReturnValue({
      department: 'ops',
      access_level: 'confidential',
      recall: {
        content_types: ['summary'],
        max_results: 5,
        reranker: 'cross_encoder',
        min_importance: 1,
        department_scope: 'all'
      }
    });
    getSummaryDrillDown.mockReturnValue({
      status: 'expired',
      data: {
        summaryId: 'sum_old',
        summary: 'Old summary',
        facts: [],
        createdAtMs: Date.now() - 7200000,
        expiresAtMs: Date.now() - 1000,
      }
    });

    const result = await memosDrillDownTool(
      { summary_id: 'sum_old' },
      { agentId: 'main' },
      mockConfig,
      mockClient
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('memosAnnounceTool should allow management to publish team-scoped memory', async () => {
    const { getAgentConfig, getCompanyDepartmentId } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      role: 'management',
      department: 'ops',
      access_level: 'confidential',
      capture: { enabled: true },
      recall: {
        content_types: ['summary'],
        max_results: 5,
        reranker: 'cross_encoder',
        min_importance: 3,
        department_scope: 'all'
      }
    });
    getCompanyDepartmentId.mockReturnValue('company');

    const result = await memosAnnounceTool(
      { text: 'Company decision: switch incident pager to on-call rota B.' },
      { agentId: 'main', userId: 'u1', sessionId: 's1' },
      { ...mockConfig, rate_limit_retries: 1 },
      mockClient
    );

    expect(result.success).toBe(true);
    expect(result.stored?.department).toBe('ops');
    expect(result.stored?.access_level).toBe('restricted');
    expect(mockClient.addMessages).toHaveBeenCalledWith(
      'ops',
      expect.any(Array),
      expect.objectContaining({
        department: 'ops',
        source_department: 'ops',
        announcement: true,
      })
    );
  });

  it('memosAnnounceTool should deny non-management agents', async () => {
    const { getAgentConfig } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      role: 'worker',
      department: 'devops',
      access_level: 'restricted',
      capture: { enabled: true },
      recall: {
        content_types: ['fact'],
        max_results: 10,
        reranker: 'rrf',
        min_importance: 1,
        department_scope: 'own'
      }
    });

    const result = await memosAnnounceTool(
      { text: 'Broadcast attempt' },
      { agentId: 'kernel' },
      { ...mockConfig, rate_limit_retries: 1 },
      mockClient
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('memosBroadcastTool should publish to company with public access', async () => {
    const { getAgentConfig, getCompanyDepartmentId } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      role: 'management',
      department: 'ops',
      access_level: 'confidential',
      capture: { enabled: true },
      recall: {
        content_types: ['summary'],
        max_results: 5,
        reranker: 'cross_encoder',
        min_importance: 3,
        department_scope: 'all'
      }
    });
    getCompanyDepartmentId.mockReturnValue('company');

    const result = await memosBroadcastTool(
      { text: 'Broadcast alias test' },
      { agentId: 'main' },
      { ...mockConfig, rate_limit_retries: 1 },
      mockClient
    );

    expect(result.success).toBe(true);
    expect(result.stored?.department).toBe('company');
    expect(result.stored?.access_level).toBe('public');
    expect(mockClient.addMessages).toHaveBeenCalledWith(
      'company',
      expect.any(Array),
      expect.objectContaining({
        department: 'company',
        source_department: 'ops',
        broadcast: true,
      })
    );
  });
});
