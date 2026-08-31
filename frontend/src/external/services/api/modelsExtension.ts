/**
 * Secondary-development extension of community modelsApi.
 * Adds build*Endpoint methods used by external AI provider edit pages.
 * These replicate the private helpers from community models.ts since they're not exported.
 */

import { modelsApi } from '@/services/api/models';
import { normalizeApiBase } from '@/utils/connection';

const DEFAULT_CLAUDE_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

export const buildV1ModelsEndpoint = (baseUrl: string): string => {
  const normalized = normalizeApiBase(baseUrl);
  if (!normalized) return '';
  const trimmed = normalized.replace(/\/+$/g, '');
  if (/\/v1\/models$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
};

export const buildClaudeModelsEndpoint = (baseUrl: string): string => {
  const normalized = normalizeApiBase(baseUrl);
  const fallback = normalized || DEFAULT_CLAUDE_BASE_URL;
  let trimmed = fallback.replace(/\/+$/g, '');
  trimmed = trimmed.replace(/\/v1\/models$/i, '');
  trimmed = trimmed.replace(/\/v1(?:\/.*)?$/i, '');
  return `${trimmed}/v1/models`;
};

export const buildGeminiModelsEndpoint = (baseUrl: string): string => {
  const normalized = normalizeApiBase(baseUrl);
  const fallback = normalized || DEFAULT_GEMINI_BASE_URL;
  let trimmed = fallback.replace(/\/+$/g, '');
  trimmed = trimmed.replace(/\/v1beta\/models$/i, '');
  trimmed = trimmed.replace(/\/v1beta(?:\/.*)?$/i, '');
  return `${trimmed}/v1beta/models`;
};

export const modelsApiExt = {
  ...modelsApi,
  buildV1ModelsEndpoint,
  buildClaudeModelsEndpoint,
  buildGeminiModelsEndpoint,
};
