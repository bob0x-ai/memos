import { describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';

jest.mock('axios');

function createAxiosInstance(params: {
  searchFacts?: Array<unknown>;
  healthStatus?: number;
}) {
  const instance = {
    post: jest.fn(async (path: string, body: any) => {
      if (path === '/search') {
        return {
          status: 200,
          data: {
            facts: params.searchFacts ?? [],
          },
        };
      }

      return {
        status: 200,
        data: {},
      };
    }),
    get: jest.fn(async () => ({
      status: params.healthStatus ?? 200,
      statusText: 'OK',
      data: {},
    })),
  };

  return instance as any;
}

function getMockedAxios() {
  return require('axios') as any;
}

describe('GraphitiClient', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    getMockedAxios().create.mockReset();
  });

  it('reads MCP fact results nested under structuredContent.result', async () => {
    const healthInstance = createAxiosInstance({});
    const mockedAxios = getMockedAxios();

    mockedAxios.create.mockReturnValue(healthInstance);

    const mcpSearchFacts = jest.fn(async () => ({
      isError: false,
      structuredContent: {
        result: {
          message: 'Facts retrieved successfully',
          facts: [
            {
              uuid: 'fact-1',
              fact: 'The memos plugin retrieval is working through MCP.',
              source_node_uuid: 'node-a',
              target_node_uuid: 'node-b',
            },
          ],
        },
      },
    }));

    const mcpConnect = jest.fn(async () => undefined);
    const MockClient = jest.fn().mockImplementation(() => ({
      connect: mcpConnect,
      callTool: mcpSearchFacts,
    }));
    const MockTransport = jest.fn().mockImplementation(() => ({}));

    jest.doMock('@modelcontextprotocol/sdk/client', () => ({
      Client: MockClient,
    }));
    jest.doMock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
      StreamableHTTPClientTransport: MockTransport,
    }));

    const { GraphitiClient } = require('../graphiti-client') as typeof import('../graphiti-client');
    const client = new GraphitiClient({
      mcpUrl: 'http://127.0.0.1:8001/mcp',
      backend: 'mcp',
      enableRestFallback: false,
      timeout: 1000,
    });

    const results = await client.searchFacts('main', 'memos', 5);

    expect(results).toHaveLength(1);
    expect(results[0]?.fact).toContain('working through MCP');
    expect(mcpSearchFacts).toHaveBeenCalled();
  });

  it('falls back to REST fact search when MCP fact search throws', async () => {
    const restInstance = createAxiosInstance({
      searchFacts: [
        {
          uuid: 'fact-1',
          fact: 'The memos plugin retrieval fix now retries REST search.',
          source_node_uuid: 'node-a',
          target_node_uuid: 'node-b',
          importance: 3,
        },
      ],
    });
    const healthInstance = createAxiosInstance({});
    const mockedAxios = getMockedAxios();

    mockedAxios.create
      .mockReturnValueOnce(restInstance)
      .mockReturnValueOnce(healthInstance);

    const mcpSearchFacts = jest.fn(async () => {
      throw new Error('MCP transport failed');
    });

    const mcpConnect = jest.fn(async () => undefined);
    const MockClient = jest.fn().mockImplementation(() => ({
      connect: mcpConnect,
      callTool: mcpSearchFacts,
    }));
    const MockTransport = jest.fn().mockImplementation(() => ({}));

    jest.doMock('@modelcontextprotocol/sdk/client', () => ({
      Client: MockClient,
    }));
    jest.doMock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
      StreamableHTTPClientTransport: MockTransport,
    }));

    const { GraphitiClient } = require('../graphiti-client') as typeof import('../graphiti-client');
    const client = new GraphitiClient({
      baseUrl: 'http://127.0.0.1:8000',
      mcpUrl: 'http://127.0.0.1:8001/mcp',
      backend: 'mcp',
      enableRestFallback: true,
      timeout: 1000,
    });

    const results = await client.searchFacts('main', 'memos', 5);

    expect(results).toHaveLength(1);
    expect(results[0]?.fact).toContain('retrieval fix');
    expect(restInstance.post).toHaveBeenCalledWith('/search', {
      query: 'memos',
      group_ids: ['main'],
      max_facts: 5,
      center_node_uuid: null,
    });
    expect(mcpSearchFacts).toHaveBeenCalled();
  });
});
