import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  memosAnnounceTool,
  memosBroadcastTool,
  memosCrossDeptTool,
  memosDrillDownTool,
  memosRecallTool,
  memorySearchTool,
  memoryStoreTool,
} from '../tools/recall';

const mockGetAgentConfig = jest.fn();
const mockGetGroupsForRecall = jest.fn();
const mockGetCompanyDepartmentId = jest.fn(() => 'company');
const mockGetDepartmentConfig = jest.fn();
const mockGetCaptureGroupId = jest.fn();
const mockGetSummaryDrillDown = jest.fn();

jest.mock('../utils/config', () => ({
  COMPANY_DEPARTMENT_ID: 'company',
  getAgentConfig: (...args: any[]) => mockGetAgentConfig(...args),
  getGroupsForRecall: (...args: any[]) => mockGetGroupsForRecall(...args),
  getCompanyDepartmentId: () => mockGetCompanyDepartmentId(),
  getDepartmentConfig: (...args: any[]) => mockGetDepartmentConfig(...args),
  getCaptureGroupId: (...args: any[]) => mockGetCaptureGroupId(...args),
}));

jest.mock('../utils/summarization', () => ({
  getSummaryDrillDown: (...args: any[]) => mockGetSummaryDrillDown(...args),
}));

describe('Recall Tools', () => {
  let mockClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetGroupsForRecall.mockReturnValue(['devops', 'company']);
    mockGetCaptureGroupId.mockImplementation((agentId: any) => agentId);
    mockClient = {
      searchFacts: jest.fn(async () => [{ uuid: 'f1', fact: 'test fact' }]),
      addMessages: jest.fn(async () => true),
    };
  });

  it('memosRecallTool searches all configured recall groups', async () => {
    mockGetAgentConfig.mockReturnValue({
      department: 'devops',
      access_level: 'restricted',
      recall: { mode: 'facts', scopes: ['department', 'company'], max_results: 10, min_importance: 1 },
    });

    const result = await memosRecallTool(
      { query: 'deployment' },
      { agentId: 'kernel' },
      {} as any,
      mockClient,
    );

    expect(result.success).toBe(true);
    expect(mockClient.searchFacts).toHaveBeenCalledWith('devops', 'deployment', 10);
    expect(mockClient.searchFacts).toHaveBeenCalledWith('company', 'deployment', 10);
  });

  it('memorySearchTool aliases memosRecallTool', async () => {
    mockGetAgentConfig.mockReturnValue({
      department: 'devops',
      access_level: 'restricted',
      recall: { mode: 'facts', scopes: ['department'], max_results: 10, min_importance: 1 },
    });
    mockGetGroupsForRecall.mockReturnValue(['devops']);

    const result = await memorySearchTool(
      { query: 'incident' },
      { agentId: 'kernel' },
      {} as any,
      mockClient,
    );

    expect(result.success).toBe(true);
    expect(mockClient.searchFacts).toHaveBeenCalledWith('devops', 'incident', 10);
  });

  it('memoryStoreTool stores into the current agent private group', async () => {
    mockGetAgentConfig.mockReturnValue({
      role: 'worker',
      department: 'ops',
      access_level: 'restricted',
      capture: { enabled: true, scope: 'department' },
      recall: { mode: 'facts', scopes: ['department'], max_results: 10, min_importance: 1 },
    });
    mockGetCaptureGroupId.mockReturnValue('kernel');

    const result = await memoryStoreTool(
      { text: 'The production deploy runbook now requires canary checks first.' },
      { agentId: 'kernel', userId: 'user-1', sessionId: 'session-1' },
      { rate_limit_retries: 1 } as any,
      mockClient,
    );

    expect(result.success).toBe(true);
    expect(result.stored?.group_id).toBe('kernel');
    expect(mockClient.addMessages).toHaveBeenCalledWith(
      'kernel',
      expect.any(Array),
      expect.objectContaining({ source_description: 'openclaw:manual_store' }),
    );
  });

  it('memosAnnounceTool stores into the caller department', async () => {
    mockGetAgentConfig.mockReturnValue({
      role: 'management',
      department: 'ops',
      access_level: 'confidential',
      capture: { enabled: true, scope: 'private' },
      recall: { mode: 'summary', scopes: ['self', 'department', 'company'], max_results: 5, min_importance: 3 },
    });

    const result = await memosAnnounceTool(
      { text: 'Rotate the incident pager at 18:00 UTC.' },
      { agentId: 'main', userId: 'u1', sessionId: 's1' },
      { rate_limit_retries: 1 } as any,
      mockClient,
    );

    expect(result.success).toBe(true);
    expect(result.stored?.group_id).toBe('ops');
    expect(mockClient.addMessages).toHaveBeenCalledWith(
      'ops',
      expect.any(Array),
      expect.objectContaining({ source_description: 'openclaw:department_announcement' }),
    );
  });

  it('memosBroadcastTool stores into the shared company group', async () => {
    mockGetAgentConfig.mockReturnValue({
      role: 'management',
      department: 'ops',
      access_level: 'confidential',
      capture: { enabled: true, scope: 'private' },
      recall: { mode: 'summary', scopes: ['self', 'department', 'company'], max_results: 5, min_importance: 3 },
    });
    mockGetCompanyDepartmentId.mockReturnValue('company');

    const result = await memosBroadcastTool(
      { text: 'Company-wide maintenance window starts at 22:00 UTC.' },
      { agentId: 'main' },
      { rate_limit_retries: 1 } as any,
      mockClient,
    );

    expect(result.success).toBe(true);
    expect(result.stored?.group_id).toBe('company');
    expect(mockClient.addMessages).toHaveBeenCalledWith(
      'company',
      expect.any(Array),
      expect.objectContaining({ source_description: 'openclaw:company_broadcast' }),
    );
  });

  it('memosCrossDeptTool denies inaccessible departments', async () => {
    mockGetAgentConfig.mockReturnValue({
      department: 'ops',
      access_level: 'restricted',
      recall: { mode: 'facts', scopes: ['department'], max_results: 10, min_importance: 1 },
    });
    mockGetDepartmentConfig.mockReturnValue({});

    const result = await memosCrossDeptTool(
      { department: 'devops', query: 'budget' },
      { agentId: 'main' },
      {} as any,
      mockClient,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('memosDrillDownTool returns underlying summary facts for confidential agents', async () => {
    mockGetAgentConfig.mockReturnValue({
      department: 'ops',
      access_level: 'confidential',
      recall: { mode: 'summary', scopes: ['self', 'department', 'company'], max_results: 5, min_importance: 1 },
    });
    mockGetSummaryDrillDown.mockReturnValue({
      status: 'ok',
      data: {
        summaryId: 'sum_abc123',
        summary: 'Executive summary text',
        facts: [
          { uuid: 'f1', fact: 'Detail A', importance: 4, _department: 'ops' },
          { uuid: 'f2', fact: 'Detail B', importance: 5, _department: 'devops' },
        ],
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 3600000,
      },
    });

    const result = await memosDrillDownTool(
      { summary_id: 'sum_abc123', limit: 2 },
      { agentId: 'main' },
      {} as any,
      mockClient,
    );

    expect(result.success).toBe(true);
    expect(result.facts).toHaveLength(2);
    expect(result.facts[0].fact).toBe('Detail A');
  });
});
