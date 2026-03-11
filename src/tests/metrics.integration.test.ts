import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { getMetrics, resetMetrics } from '../metrics/prometheus';
import { memosDrillDownTool } from '../tools/recall';

jest.mock('../utils/config', () => ({
  getAgentConfig: jest.fn(),
  getDepartmentConfig: jest.fn(),
  getAllDepartments: jest.fn().mockReturnValue(['ops']),
}));

jest.mock('../utils/summarization', () => ({
  getSummaryDrillDown: jest.fn(),
}));

describe('Metrics Integration', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should emit drill-down metrics after successful drill-down call', async () => {
    const { getAgentConfig } = require('../utils/config');
    const { getSummaryDrillDown } = require('../utils/summarization');

    getAgentConfig.mockReturnValue({
      department: 'ops',
      access_level: 'confidential',
      capture: { enabled: true },
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
        summaryId: 'sum_metric1',
        summary: 'Summary text',
        facts: [{ uuid: 'f1', fact: 'Detail A', content_type: 'fact', importance: 3 }],
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 3600000,
      }
    });

    const result = await memosDrillDownTool(
      { summary_id: 'sum_metric1', limit: 1 },
      { agentId: 'main' },
      { rate_limit_retries: 1 } as any,
      {} as any
    );

    expect(result.success).toBe(true);

    const metrics = await getMetrics();
    expect(metrics).toContain('memos_drill_down_calls_total');
    expect(metrics).toContain('outcome="success"');
    expect(metrics).toContain('memos_drill_down_duration_seconds');
    expect(metrics).toContain('memos_tool_calls_total');
    expect(metrics).toContain('tool="memos_drill_down"');
  });
});
