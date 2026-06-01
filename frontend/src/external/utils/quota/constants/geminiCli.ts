/**
 * Gemini CLI quota constants – isolated from community @/utils/quota/constants.
 */

import type { GeminiCliQuotaGroupDefinition } from '@/external/types/geminiCli';

// ─── API endpoints ───────────────────────────────────────────────────

export const GEMINI_CLI_QUOTA_URL =
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveCodeAssistApiaryQuota';

export const GEMINI_CLI_CODE_ASSIST_URL =
  'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';

export const GEMINI_CLI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'gemini-cli/0.1.0',
};

// ─── Quota group definitions (label mapping) ────────────────────────

export const GEMINI_CLI_QUOTA_GROUPS: GeminiCliQuotaGroupDefinition[] = [
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    modelIds: ['gemini-2.5-pro', 'gemini-2.5-pro-preview-05-06'],
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    modelIds: ['gemini-2.5-flash', 'gemini-2.5-flash-preview-05-20'],
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    modelIds: ['gemini-2.0-flash'],
  },
  {
    id: 'gemini-2.0-flash-lite',
    label: 'Gemini 2.0 Flash Lite',
    modelIds: ['gemini-2.0-flash-lite'],
  },
];
