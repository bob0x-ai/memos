import { validateConfig, defaultConfig } from '../src/config';

describe('validateConfig', () => {
  test('accepts valid configuration', () => {
    const config = {
      departments: {
        ops: ['main', 'mother'],
        devops: ['kernel'],
      },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  test('rejects non-object config', () => {
    expect(() => validateConfig(null)).toThrow('MEMOS configuration must be an object');
    expect(() => validateConfig('string')).toThrow('MEMOS configuration must be an object');
    expect(() => validateConfig(123)).toThrow('MEMOS configuration must be an object');
  });

  test('rejects missing departments', () => {
    expect(() => validateConfig({})).toThrow('MEMOS configuration requires "departments" object');
    expect(() => validateConfig({ graphiti_url: 'http://localhost' })).toThrow(
      'MEMOS configuration requires "departments" object'
    );
  });

  test('rejects non-array department values', () => {
    const config = {
      departments: {
        ops: 'main', // should be array
      },
    };
    expect(() => validateConfig(config)).toThrow('Department "ops" must be an array of agent IDs');
  });

  test('rejects invalid graphiti_url type', () => {
    const config = {
      departments: { ops: ['main'] },
      graphiti_url: 123,
    };
    expect(() => validateConfig(config)).toThrow('graphiti_url must be a string');
  });

  test('rejects invalid boolean fields', () => {
    const config = {
      departments: { ops: ['main'] },
      auto_capture: 'yes',
    };
    expect(() => validateConfig(config)).toThrow('auto_capture must be a boolean');
  });

  test('rejects invalid numeric fields', () => {
    const config = {
      departments: { ops: ['main'] },
      recall_limit: '10',
    };
    expect(() => validateConfig(config)).toThrow('recall_limit must be a number');
  });
});

describe('defaultConfig', () => {
  test('has expected defaults', () => {
    expect(defaultConfig.graphiti_url).toBe('http://localhost:8000');
    expect(defaultConfig.sop_search_enabled).toBe(false);
    expect(defaultConfig.sop_path).toBe('~/.openclaw/workspace/sop');
    expect(defaultConfig.auto_capture).toBe(true);
    expect(defaultConfig.auto_recall).toBe(true);
    expect(defaultConfig.recall_limit).toBe(10);
    expect(defaultConfig.rate_limit_retries).toBe(3);
  });
});
