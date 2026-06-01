import type { AccountImportItem, AccountImportTargetType } from '@/external/features/requestMonitor/accountImport/accountImportConverter';
import type { Provider } from './types';

interface ProviderProfile {
  type: Exclude<AccountImportTargetType, 'auto'>;
  name: string;
  baseUrl?: string;
  aliases: string[];
}

export interface ImportedProviderDescriptor {
  type: string;
  name: string;
  /** Resolved base_url used for create: credential explicit URL or profile default. */
  baseUrl?: string;
  /** Profile catalog default URL (never the credential custom endpoint). */
  profileBaseUrl?: string;
  hasExplicitBaseUrl: boolean;
  aliases: string[];
  description: string;
}

const PROVIDER_PROFILES: ProviderProfile[] = [
  { type: 'codex', name: 'Codex', baseUrl: 'https://chatgpt.com/backend-api/codex', aliases: ['codex', 'openai codex'] },
  { type: 'xai', name: 'Grok', baseUrl: 'https://api.x.ai/v1', aliases: ['xai', 'x.ai', 'grok'] },
  { type: 'claude', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', aliases: ['claude', 'anthropic'] },
  { type: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com', aliases: ['gemini', 'google gemini'] },
  { type: 'antigravity', name: 'Gemini CLI', baseUrl: 'https://cloudcode-pa.googleapis.com', aliases: ['antigravity', 'gemini cli', 'google cloud code'] },
  { type: 'kimi', name: 'Kimi', baseUrl: 'https://api.kimi.com/coding', aliases: ['kimi', 'moonshot'] },
  { type: 'vertex', name: 'Vertex AI', baseUrl: 'https://aiplatform.googleapis.com', aliases: ['vertex', 'vertex ai'] },
  { type: 'aistudio', name: 'Gemini AI Studio', baseUrl: 'https://generativelanguage.googleapis.com', aliases: ['aistudio', 'ai studio', 'gemini ai studio'] },
  { type: 'qwen', name: 'Qwen', aliases: ['qwen', 'dashscope'] },
  { type: 'iflow', name: 'iFlow', aliases: ['iflow'] },
];

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const normalizeType = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'anthropic') return 'claude';
  if (normalized === 'grok' || normalized === 'x.ai') return 'xai';
  if (normalized === 'ai-studio') return 'aistudio';
  return normalized;
};

export const normalizeProviderBaseUrl = (value?: string) =>
  (value || '').trim().replace(/\/+$/, '').toLowerCase();

const normalizeProviderName = (value?: string) => (value || '').trim().toLowerCase();

export function resolveImportedProvider(
  item: AccountImportItem,
  fallbackType?: AccountImportTargetType
): ImportedProviderDescriptor {
  const authJson = item.authJson;
  const rawType = firstString(authJson.type, authJson.provider, fallbackType === 'auto' ? '' : fallbackType);
  const type = normalizeType(rawType || 'codex');
  const profile = PROVIDER_PROFILES.find((candidate) => candidate.type === type);
  const importedBaseUrl = firstString(authJson.base_url, authJson.baseUrl, authJson.api_base, authJson.apiBase);
  const name = profile?.name ?? (rawType || 'Imported Provider');
  return {
    type,
    name,
    baseUrl: importedBaseUrl || profile?.baseUrl,
    profileBaseUrl: profile?.baseUrl,
    hasExplicitBaseUrl: Boolean(importedBaseUrl),
    aliases: Array.from(new Set([type, name, ...(profile?.aliases ?? [])].map(normalizeProviderName))),
    description: `Automatically matched from imported ${type} credentials.`,
  };
}

export function findImportedProviderMatch(
  providers: Provider[],
  descriptor: ImportedProviderDescriptor,
  preferredBaseUrl?: string
) {
  return matchProviderForCredential(providers, descriptor, preferredBaseUrl);
}

/**
 * Match provider for an auth credential.
 * - Explicit/preferred base_url: ONLY match by normalized URL (latest among equals).
 *   No name fallback — a custom endpoint like cli-chat-proxy.grok.com must not bind to api.x.ai.
 * - No explicit base_url: match name aliases so default profile types reuse the operator's provider.
 * Auto-created providers store the real base_url; later same-URL items reuse them via URL match.
 */
export function matchProviderForCredential(
  providers: Provider[],
  descriptor: ImportedProviderDescriptor,
  preferredBaseUrl?: string
) {
  const preferred = normalizeProviderBaseUrl(preferredBaseUrl);
  const hasExplicitUrl = Boolean(preferred) || descriptor.hasExplicitBaseUrl;

  if (hasExplicitUrl) {
    return (
      findLatestProviderByBaseUrl(providers, preferredBaseUrl) ||
      findLatestProviderByBaseUrl(providers, descriptor.baseUrl)
    );
  }

  return providers.find((provider) =>
    descriptor.aliases.includes(normalizeProviderName(provider.provider_name))
  );
}

/**
 * Ensure a center provider exists for the credential.
 * - Match by normalized base_url (latest) / name aliases
 * - Create once when unmatched and base_url is known
 * - In-flight locks keyed by base_url avoid concurrent duplicate creates
 * Mutates `providers` when a new row is created so later items reuse it.
 */
export async function ensureProviderForCredential(
  providers: Provider[],
  descriptor: ImportedProviderDescriptor,
  options: {
    preferredBaseUrl?: string;
    createLocks?: Map<string, Promise<Provider | undefined>>;
    createProvider: (input: Partial<Provider>) => Promise<Provider>;
  }
): Promise<{ provider?: Provider; created: boolean }> {
  const matched = matchProviderForCredential(providers, descriptor, options.preferredBaseUrl);
  if (matched) {
    return { provider: matched, created: false };
  }

  const rawBaseUrl = (options.preferredBaseUrl || descriptor.baseUrl || '').trim();
  if (!normalizeProviderBaseUrl(rawBaseUrl)) {
    return { provider: undefined, created: false };
  }
  // Include provider identity so shared hosts (Gemini / AI Studio) do not share one create.
  const lockKey = `${normalizeProviderName(descriptor.name) || descriptor.type}::${normalizeProviderBaseUrl(rawBaseUrl)}`;

  const locks = options.createLocks;
  const existingLock = locks?.get(lockKey);
  if (existingLock) {
    const provider = await existingLock;
    return { provider, created: false };
  }

  // Capture pool membership before the create task starts so concurrent waiters
  // that join via createLocks do not flip this call's "created" flag.
  const beforeIds = new Set(providers.map((item) => item.provider_id));
  let createdByThisTask = false;

  const task = (async (): Promise<Provider | undefined> => {
    // Re-check after acquiring the in-flight slot.
    const again = matchProviderForCredential(providers, descriptor, options.preferredBaseUrl);
    if (again) return again;

    const normalizedCreateUrl = rawBaseUrl.replace(/\/+$/, '');
    const createUrl = normalizeProviderBaseUrl(normalizedCreateUrl);
    const profileDefaultUrl = normalizeProviderBaseUrl(descriptor.profileBaseUrl);
    // Custom endpoints keep a distinguishable name so operators can tell them apart from the default.
    const isCustomEndpoint =
      Boolean(createUrl) &&
      (
        (descriptor.hasExplicitBaseUrl && Boolean(profileDefaultUrl) && createUrl !== profileDefaultUrl) ||
        (descriptor.hasExplicitBaseUrl && !profileDefaultUrl)
      );
    let hostHint = '';
    try {
      hostHint = new URL(normalizedCreateUrl).host;
    } catch {
      hostHint = createUrl;
    }
    const providerName = isCustomEndpoint && hostHint
      ? `${descriptor.name} (${hostHint})`
      : descriptor.name;

    try {
      const created = await options.createProvider({
        provider_name: providerName,
        description:
          descriptor.description ||
          (isCustomEndpoint
            ? `Auto-created for ${descriptor.type} credentials at ${normalizedCreateUrl}.`
            : `Auto-created for ${descriptor.type} credentials.`),
        channel_id: 2,
        status: 1,
        base_url: normalizedCreateUrl,
        probe_policy: '{}',
        param: '{}',
      });
      createdByThisTask = true;
      if (!providers.some((item) => item.provider_id === created.provider_id)) {
        providers.push(created);
      }
      return created;
    } catch {
      // Soft-fail: concurrent waiters get undefined instead of a rejected lock promise.
      return undefined;
    }
  })();

  locks?.set(lockKey, task);
  try {
    const provider = await task;
    const created = createdByThisTask || Boolean(provider && !beforeIds.has(provider.provider_id));
    return { provider, created };
  } finally {
    locks?.delete(lockKey);
  }
}


export function findLatestProviderByBaseUrl(providers: Provider[], baseUrl?: string) {
  const normalizedBaseUrl = normalizeProviderBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return undefined;

  const matches = providers
    .filter((provider) => normalizeProviderBaseUrl(provider.base_url) === normalizedBaseUrl)
    .sort((left, right) => {
      const leftUpdated = Date.parse(left.update_at || '') || 0;
      const rightUpdated = Date.parse(right.update_at || '') || 0;
      if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated;
      return right.provider_id - left.provider_id;
    });

  return matches[0];
}

