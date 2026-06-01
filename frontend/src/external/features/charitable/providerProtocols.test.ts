import { describe, expect, it } from 'vitest';
import {
  defaultCPAConfigForProtocols,
  formatProviderProtocols,
  parseProviderProtocols,
  primaryProviderProtocol,
} from './types';

describe('provider protocol multi-select helpers', () => {
  it('parses comma-separated protocol lists', () => {
    expect(parseProviderProtocols('anthropic,openai_compatible')).toEqual([
      'openai_compatible',
      'anthropic',
    ]);
  });

  it('formats and picks primary protocol', () => {
    expect(formatProviderProtocols(['gemini', 'openai_compatible'])).toBe(
      'openai_compatible,gemini'
    );
    expect(primaryProviderProtocol('gemini,anthropic')).toBe('gemini');
    expect(defaultCPAConfigForProtocols(['anthropic', 'gemini'])).toBe('claude-api-key');
  });
});
