import { describe, expect, it } from 'vitest';
import {
  inferParamValueType,
  isSafeParamKey,
  mergeParamObjects,
  parseParamObject,
  parseParamValue,
} from './paramUtils';

describe('charitable param utilities', () => {
  it('accepts only JSON objects', () => {
    expect(parseParamObject('{"model":"gpt-4o"}')).toEqual({ model: 'gpt-4o' });
    expect(() => parseParamObject('[]')).toThrow('param_must_be_object');
  });

  it('converts Postman-style typed values', () => {
    expect(parseParamValue('30', 'number')).toBe(30);
    expect(parseParamValue('true', 'boolean')).toBe(true);
    expect(parseParamValue('{"x":1}', 'map')).toEqual({ x: 1 });
    expect(parseParamValue('[1,2]', 'array')).toEqual([1, 2]);
    expect(inferParamValueType({ nested: true })).toBe('map');
    expect(inferParamValueType([])).toBe('array');
    expect(inferParamValueType(null)).toBe('null');
  });

  it('merges inherited values before local overrides', () => {
    expect(mergeParamObjects({ model: 'base', timeout: 10 }, { model: 'key' })).toEqual({
      model: 'key',
      timeout: 10,
    });
  });

  it('blocks prototype mutation keys', () => {
    expect(isSafeParamKey('model')).toBe(true);
    expect(isSafeParamKey('__proto__')).toBe(false);
  });
});
