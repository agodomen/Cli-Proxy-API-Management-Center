/**
 * Gemini CLI quota adapters – isolated from community @/utils/quota.
 *
 * Re-implements the Gemini CLI–specific parsing, building, and resolving
 * helpers that were removed from the upstream project.
 */

import type { AuthFileItem } from '@/types';
import type {
  GeminiCliCodeAssistPayload,
  GeminiCliParsedBucket,
  GeminiCliQuotaBucketState,
  GeminiCliQuotaGroupDefinition,
  GeminiCliQuotaPayload,
} from '@/external/types/geminiCli';
import { normalizeStringValue } from '@/utils/quota/parsers';
import { GEMINI_CLI_QUOTA_GROUPS } from '@/external/utils/quota/constants/geminiCli';

// ─── Type guard ──────────────────────────────────────────────────────

/**
 * Returns `true` when the auth file represents a Gemini CLI account.
 */
export function isGeminiCliFile(file: AuthFileItem): boolean {
  const raw = file.provider ?? file.type ?? '';
  const key = String(raw).trim().toLowerCase().replace(/_/g, '-');
  return key === 'gemini-cli';
}

// ─── Model-ID normalisation ──────────────────────────────────────────

/**
 * Normalises a raw model-ID string. Returns `null` for non-string or
 * empty values.
 */
export function normalizeGeminiCliModelId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
}

// ─── Payload parsers ─────────────────────────────────────────────────

function parseJsonPayload<T>(payload: unknown): T | null {
  if (payload === undefined || payload === null) return null;
  let parsed: unknown;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  } else {
    parsed = payload;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as T;
}

/**
 * Parses the raw quota API response into a typed payload.
 */
export function parseGeminiCliQuotaPayload(payload: unknown): GeminiCliQuotaPayload | null {
  const parsed = parseJsonPayload<Record<string, unknown>>(payload);
  if (!parsed) return null;
  if (Array.isArray(parsed.buckets)) {
    return { buckets: parsed.buckets as GeminiCliQuotaPayload['buckets'] };
  }
  return null;
}

/**
 * Parses the raw code-assist API response into a typed payload.
 */
export function parseGeminiCliCodeAssistPayload(payload: unknown): GeminiCliCodeAssistPayload | null {
  return parseJsonPayload<GeminiCliCodeAssistPayload>(payload);
}

// ─── Bucket builder ──────────────────────────────────────────────────

/**
 * Builds a flat list of quota bucket states from parsed buckets by
 * resolving each model ID against the configured quota groups.
 */
export function buildGeminiCliQuotaBuckets(
  parsedBuckets: GeminiCliParsedBucket[],
): GeminiCliQuotaBucketState[] {
  const groupMap = new Map<string, GeminiCliQuotaGroupDefinition>();
  for (const group of GEMINI_CLI_QUOTA_GROUPS) {
    for (const modelId of group.modelIds) {
      groupMap.set(modelId, group);
    }
  }

  const seen = new Map<string, GeminiCliQuotaBucketState>();

  for (const bucket of parsedBuckets) {
    const group = groupMap.get(bucket.modelId);
    const id = group?.id ?? bucket.modelId;
    const label = group?.label ?? bucket.modelId;

    const existing = seen.get(id);
    if (existing) {
      // Keep the most constrained entry (lowest remaining fraction).
      if (
        bucket.remainingFraction !== null &&
        existing.remainingFraction !== null &&
        bucket.remainingFraction < existing.remainingFraction
      ) {
        seen.set(id, {
          id,
          label,
          remainingFraction: bucket.remainingFraction,
          remainingAmount: bucket.remainingAmount,
          resetTime: bucket.resetTime,
        });
      }
    } else {
      seen.set(id, {
        id,
        label,
        remainingFraction: bucket.remainingFraction,
        remainingAmount: bucket.remainingAmount,
        resetTime: bucket.resetTime,
      });
    }
  }

  return Array.from(seen.values());
}

// ─── Project-ID resolver ─────────────────────────────────────────────

/**
 * Resolves the Google Cloud project ID associated with a Gemini CLI
 * auth file. Checks well-known property names on the file object and
 * its `metadata` / `attributes` sub-objects.
 */
export function resolveGeminiCliProjectId(file: AuthFileItem): string | null {
  const toRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  };

  const metadata = toRecord(file.metadata);
  const attributes = toRecord(file.attributes);

  const candidates = [
    file.project_id,
    file.projectId,
    file.gemini_virtual_project,
    file.geminiVirtualProject,
    metadata?.project_id,
    metadata?.projectId,
    metadata?.gemini_virtual_project,
    metadata?.geminiVirtualProject,
    attributes?.project_id,
    attributes?.projectId,
    attributes?.gemini_virtual_project,
    attributes?.geminiVirtualProject,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeStringValue(candidate);
    if (normalized) return normalized;
  }

  // Fallback: inspect id_token for project_id
  const idToken = toRecord(file.id_token) ?? toRecord(metadata?.id_token) ?? toRecord(attributes?.id_token);
  if (idToken) {
    const fromToken = normalizeStringValue(idToken.project_id ?? idToken.projectId);
    if (fromToken) return fromToken;
  }

  return null;
}
