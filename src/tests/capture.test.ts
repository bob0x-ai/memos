import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { captureHook } from '../hooks/capture';
import { GraphitiClient } from '../graphiti-client';
import { MemosConfig } from '../config';

// Mock the classification module
jest.mock('../utils/classification', () => ({
  classifyContent: jest.fn(async () => ({
    content_type: 'fact',
    importance: 4
  }))
}));

jest.mock('../utils/config', () => ({
  getAgentConfig: jest.fn().mockReturnValue({
    role: 'worker',
    access_level: 'restricted',
    department: 'test-devops',
    capture: {
      enabled: true
    },
    recall: {
      content_types: ['fact'],
      max_results: 10,
      reranker: 'rrf',
      min_importance: 1,
      department_scope: 'own'
    }
  }),
  getDepartmentConfig: jest.fn(),
  loadConfig: jest.fn().mockReturnValue({
    ontology: {
      entity_types: ['Person', 'System'],
      content_types: ['fact', 'decision'],
      access_levels: ['public', 'restricted', 'confidential']
    }
  })
}));

describe('Capture Hook', () => {
  let mockClient: any;
  let mockConfig: MemosConfig;
  let mockCtx: any;

  beforeEach(() => {
    const { getAgentConfig } = require('../utils/config');
    getAgentConfig.mockReturnValue({
      role: 'worker',
      access_level: 'restricted',
      department: 'test-devops',
      capture: {
        enabled: true
      },
      recall: {
        content_types: ['fact'],
        max_results: 10,
        reranker: 'rrf',
        min_importance: 1,
        department_scope: 'own'
      }
    });

    mockClient = {
      addMessages: jest.fn(async () => true)
    };

    mockConfig = {
      auto_capture: true,
      rate_limit_retries: 3,
      departments: {
        'test-devops': ['test-kernel', 'test-nyx']
      }
    } as any;

    mockCtx = {
      agentId: 'test-kernel',
      messages: [
        { role: 'user', content: 'How do I deploy the app to production safely with docker compose?' },
        { role: 'assistant', content: 'Use docker-compose up -d, then run health checks and verify logs.' }
      ],
      userId: 'user-123',
      sessionId: 'session-456'
    };
  });

  it('should capture valid exchanges', async () => {
    await captureHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.addMessages).toHaveBeenCalled();
    const call = mockClient.addMessages.mock.calls[0];
    expect(call[0]).toBe('test-devops');
    expect(call[1]).toHaveLength(2);
  });

  it('should skip when auto_capture is disabled', async () => {
    mockConfig.auto_capture = false;
    await captureHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.addMessages).not.toHaveBeenCalled();
  });

  it('should skip unknown agents', async () => {
    mockCtx.agentId = 'unknown-agent';
    const { getAgentConfig } = require('../utils/config');
    getAgentConfig.mockReturnValue(null);

    await captureHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.addMessages).not.toHaveBeenCalled();
  });

  it('should skip trivial content', async () => {
    mockCtx.messages = [
      { role: 'user', content: 'thanks' },
      { role: 'assistant', content: 'you\'re welcome' }
    ];

    await captureHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.addMessages).not.toHaveBeenCalled();
  });

  it('should handle Graphiti errors gracefully', async () => {
    mockClient.addMessages.mockRejectedValue(new Error('Graphiti error'));

    // Should not throw
    await expect(captureHook({}, mockCtx, mockConfig, mockClient)).resolves.not.toThrow();
  });

  it('should skip executive summary injections', async () => {
    mockCtx.messages = [
      {
        role: 'user',
        content: '## Executive Memory Summary\n\nSummary ID: sum_deadbeef\n\nDeployment is blocked.\n',
      },
      {
        role: 'assistant',
        content: 'I will keep this in mind.',
      },
    ];

    await captureHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.addMessages).not.toHaveBeenCalled();
  });

  it('should skip tool dump style exchanges', async () => {
    mockCtx.messages = [
      {
        role: 'user',
        content: 'Conversation info (untrusted metadata):\n```json\n{\"message_id\":\"1\"}\n```',
      },
      {
        role: 'assistant',
        content: 'Found the root cause.\n```text\nPOST /messages HTTP/1.1 202 Accepted\n```',
      },
    ];

    await captureHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.addMessages).not.toHaveBeenCalled();
  });

  it('should truncate oversized messages before storing', async () => {
    const longLine = 'alpha '.repeat(200);
    mockCtx.messages = [
      { role: 'user', content: `Please remember this detail: ${longLine}` },
      { role: 'assistant', content: `Captured: ${longLine}` },
    ];

    await captureHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.addMessages).toHaveBeenCalled();
    const call = mockClient.addMessages.mock.calls[0];
    expect(call[1][0].content.length).toBeLessThanOrEqual(600);
    expect(call[1][1].content.length).toBeLessThanOrEqual(600);
  });
});
