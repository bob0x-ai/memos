import { isWorthRemembering, getLastExchange, buildEpisodeContent } from '../src/utils/filter';

describe('isWorthRemembering', () => {
  test('returns false for empty messages', () => {
    expect(isWorthRemembering('', 'response')).toBe(false);
    expect(isWorthRemembering('hello', '')).toBe(false);
  });

  test('returns false for very short messages', () => {
    expect(isWorthRemembering('hi', 'hello')).toBe(false);
    expect(isWorthRemembering('ok', 'sure')).toBe(false);
  });

  test('returns false for pleasantries', () => {
    expect(isWorthRemembering('thanks', 'you\'re welcome')).toBe(false);
    expect(isWorthRemembering('thank you', 'no problem')).toBe(false);
    expect(isWorthRemembering('ok', 'sounds good')).toBe(false);
  });

  test('returns false for standalone acknowledgments', () => {
    expect(isWorthRemembering('ok.', '')).toBe(false);
    expect(isWorthRemembering('thanks!', '')).toBe(false);
    expect(isWorthRemembering('got it', '')).toBe(false);
  });

  test('returns true for meaningful conversations', () => {
    expect(isWorthRemembering(
      'I need to deploy the payment service',
      'What stack are you using?'
    )).toBe(true);

    expect(isWorthRemembering(
      'The API is returning 500 errors',
      'Let me check the logs'
    )).toBe(true);
  });

  test('returns true for longer messages even with pleasantries', () => {
    expect(isWorthRemembering(
      'thanks for the help with the deployment yesterday',
      'you\'re welcome, let me know if you need anything else'
    )).toBe(true);
  });
});

describe('getLastExchange', () => {
  test('extracts last user and assistant messages', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'how are you?' },
      { role: 'assistant', content: 'I am fine' },
    ];

    const result = getLastExchange(messages);
    expect(result.lastUser).toBe('how are you?');
    expect(result.lastAssistant).toBe('I am fine');
  });

  test('handles missing assistant message', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'user', content: 'anyone there?' },
    ];

    const result = getLastExchange(messages);
    expect(result.lastUser).toBe('anyone there?');
    expect(result.lastAssistant).toBe('');
  });

  test('returns empty for empty array', () => {
    const result = getLastExchange([]);
    expect(result.lastUser).toBe('');
    expect(result.lastAssistant).toBe('');
  });
});

describe('buildEpisodeContent', () => {
  test('formats user and assistant messages', () => {
    const content = buildEpisodeContent('hello', 'hi there');
    expect(content).toBe('USER: hello\nASSISTANT: hi there');
  });

  test('trims whitespace', () => {
    const content = buildEpisodeContent('  hello  ', '  hi  ');
    expect(content).toBe('USER: hello\nASSISTANT: hi');
  });
});
