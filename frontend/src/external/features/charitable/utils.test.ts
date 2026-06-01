import { describe, expect, it } from 'vitest';
import { computeApiType, parseApiType, isValidApiType, mergeParams, maskKey, parseProviderParam } from './utils';

const sorted = (values: string[]) => [...values].sort();

describe('charitable utils', () => {
  it('computes api_type from protocol primes', () => {
    expect(computeApiType([])).toBe(1);
    expect(computeApiType(['openai'])).toBe(2);
    expect(computeApiType(['openai', 'anthropic'])).toBe(6);
    expect(computeApiType(['openai', 'anthropic', 'gemini', 'openai_responses'])).toBe(210);
  });

  it('parses protocol primes from api_type', () => {
    expect(parseApiType(1)).toEqual([]);
    expect(parseApiType(2)).toEqual(['openai']);
    expect(sorted(parseApiType(30))).toEqual(sorted(['openai', 'anthropic', 'gemini']));
  });

  it('validates api_type with at least one protocol', () => {
    expect(isValidApiType(1)).toBe(false);
    expect(isValidApiType(2)).toBe(true);
  });

  it('merges params with child levels overriding parent levels', () => {
    expect(
      mergeParams('{"a":1,"shared":"channel"}', '{"b":2,"shared":"provider"}', '{"c":3,"shared":"key"}')
    ).toEqual({ a: 1, b: 2, c: 3, shared: 'key' });
  });

  it('ignores invalid JSON during param merge', () => {
    expect(mergeParams('invalid', '{}', '{"ok":true}')).toEqual({ ok: true });
  });

  it('masks keys for list display', () => {
    expect(maskKey('')).toBe('—');
    expect(maskKey('12345678')).toBe('••••••5678');
    expect(maskKey('sk-1234567890')).toBe('sk-1••••7890');
  });

  it('parses provider param shape safely', () => {
    expect(parseProviderParam('{"path":{"openai":"/v1/chat"},"models":[{"name":"gpt","alias":"GPT"}]}')).toEqual({
      path: { openai: '/v1/chat' },
      models: [{ name: 'gpt', alias: 'GPT' }],
    });
    expect(parseProviderParam('bad-json')).toEqual({ path: {}, models: [] });
  });
});
