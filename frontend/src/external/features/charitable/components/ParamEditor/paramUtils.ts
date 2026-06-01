export type ParamObject = Record<string, unknown>;
export type ParamValueType = 'string' | 'number' | 'boolean' | 'array' | 'map' | 'null';

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseParamObject(raw: string): ParamObject {
  const parsed: unknown = JSON.parse(raw || '{}');
  if (!isParamObject(parsed)) throw new Error('param_must_be_object');
  return parsed;
}

export function tryParseParamObject(raw: string): ParamObject | null {
  try {
    return parseParamObject(raw);
  } catch {
    return null;
  }
}

export function formatParamObject(value: ParamObject): string {
  return JSON.stringify(value, null, 2);
}

export function inferParamValueType(value: unknown): ParamValueType {
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  return 'map';
}

export function formatParamValue(value: unknown, type = inferParamValueType(value)): string {
  if (type === 'null') return '';
  if (type === 'array' || type === 'map') return JSON.stringify(value, null, 2);
  return String(value ?? '');
}

export function parseParamValue(raw: string, type: ParamValueType): unknown {
  if (type === 'string') return raw;
  if (type === 'null') return null;
  if (type === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error('invalid_boolean');
  }
  if (type === 'number') {
    if (!raw.trim()) throw new Error('invalid_number');
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error('invalid_number');
    return value;
  }
  if (type === 'array' || type === 'map') return JSON.parse(raw);
  return raw;
}

export function isSafeParamKey(key: string): boolean {
  return Boolean(key.trim()) && !BLOCKED_KEYS.has(key.trim());
}

export function mergeParamObjects(...values: Array<ParamObject | undefined>): ParamObject {
  return Object.assign({}, ...values.filter(Boolean));
}

function isParamObject(value: unknown): value is ParamObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
