/**
 * Gemini CLI quota types – isolated from community @/types.
 * These types were removed from the upstream project and are maintained
 * here so that src/external/ can continue to function independently.
 */

// ─── Raw API payload types ───────────────────────────────────────────

export interface GeminiCliQuotaBucket {
  modelId: string;
  model_id?: string;
  tokenType: string | null;
  token_type?: string | null;
  remainingFraction: number | null;
  remaining_fraction?: number | null;
  remainingAmount: number | null;
  remaining_amount?: number | null;
  resetTime: string | undefined;
  reset_time?: string | undefined;
}

export interface GeminiCliQuotaPayload {
  buckets: GeminiCliQuotaBucket[];
}

// ─── Code-assist / tier types ────────────────────────────────────────

export interface GeminiCliCredits {
  label?: string;
  amount?: string;
  creditType?: string;
  credit_type?: string;
  creditAmount?: number;
  credit_amount?: number;
}

export interface GeminiCliUserTier {
  tier?: string;
  id?: string;
  availableCredits?: GeminiCliCredits[];
  available_credits?: GeminiCliCredits[];
}

export interface GeminiCliCodeAssistPayload {
  metadata?: { tier?: string };
  usage?: { buckets?: GeminiCliQuotaBucket[] };
  currentTier?: GeminiCliUserTier | null;
  current_tier?: GeminiCliUserTier | null;
  paidTier?: GeminiCliUserTier | null;
  paid_tier?: GeminiCliUserTier | null;
}

// ─── Quota-group definition (config/label mapping) ──────────────────

export interface GeminiCliQuotaGroupDefinition {
  id: string;
  label: string;
  preferredModelId?: string;
  modelIds: string[];
}

// ─── Parsed / state types ────────────────────────────────────────────

export interface GeminiCliParsedBucket {
  modelId: string;
  tokenType: string | null;
  remainingFraction: number | null;
  remainingAmount: number | null;
  resetTime: string | undefined;
}

export interface GeminiCliQuotaBucketState {
  id: string;
  label: string;
  remainingFraction: number | null;
  remainingAmount: number | null;
  resetTime: string | undefined;
}

export interface GeminiCliQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  buckets: GeminiCliQuotaBucketState[];
  credits?: GeminiCliCredits;
  userTier?: GeminiCliUserTier;
  error?: string;
  errorStatus?: number;
}
