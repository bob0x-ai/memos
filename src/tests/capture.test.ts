import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { captureHook } from '../src/hooks/capture';
import { GraphitiClient } from '../src/graphiti-client';
import { MemosConfig } from '../src/config';

// Mock the classification module
jest.mock('../src/utils/classification', () => ({
  classifyContent: jest.fn().mockResolvedValue({
    content_type: 'fact',
    importance: 4
  })
}));

jest.mock('../src/utils/config', () => ({
  getAgentConfig: jest.fn().mockReturnValue({
    access_level: 'restricted',
    department: 'test-devtest-ops'
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
  let mockClient: jest.Mocked<GraphitiClient>;
  let mockConfig: MemosConfig;
  let mockCtx: any;

  beforeEach(() => {
    mockClient = {
      addMessages: jest.fn().mockResolvedValue({ episode_uuid: 'test-uuid', entity_count: 2 })
    } as any;

    mockConfig = {
      auto_capture: true,
      rate_limit_retries: 3,
      departments: {
        test-devtest-ops: { agents: ['test-kernel', 'nyx'] }
      }
    } as any;

    mockCtx = {
      agentId: 'test-kernel',
      messages: [
        { role: 'user', content: 'How do I deploy the app?' },
        { role: 'assistant', content: 'Run docker-compose up -d' }
      ],
      userId: 'user-123',
      sessionId: 'session-456'
    };
  });

  it('should capture valid exchanges', async () => {
    await captureHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.addMessages).toHaveBeenCalled();
    const call = (mockClient.addMessages as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('test-devtest-ops');
    expect(call[1]).toHaveLength(2);
    expect(call[2]).toMatchObject({
      agent_id: 'test-kernel',
      content_type: 'fact',
      importance: 4,
      access_level: 'restricted'
    });
  });

  it('should skip when auto_capture is disabled', async () => {
    mockConfig.auto_capture = false;
    await captureHook({}, mockCtx, mockConfig, mockClient);

    expect(mockClient.addMessages).not.toHaveBeenCalled();
  });

  it('should skip unknown agents', async () => {
    mockCtx.agentId = 'unknown-agent';
    const { getAgentConfig } = require('../src/utils/config');
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
});
