import { describe, expect, it } from 'vitest';
import { ensureProviderForCredential, findImportedProviderMatch, findLatestProviderByBaseUrl, matchProviderForCredential, resolveImportedProvider } from './providerCatalog';
import type { Provider } from './types';

const provider = (providerId: number, providerName: string, baseUrl: string): Provider => ({
  provider_id: providerId,
  provider_name: providerName,
  description: '',
  status: 1,
  base_url: baseUrl,
  probe_policy: '{}',
  param: '{}',
  create_at: '',
  update_at: '',
});

describe('imported provider catalog', () => {
  it('resolves CPA credential types to canonical providers', () => {
    const descriptor = resolveImportedProvider({
      fileName: 'claude.json',
      authJson: { type: 'claude', access_token: 'secret' },
      source: 'cpa',
      label: 'Claude account',
      credentialHash: 'hash',
    });

    expect(descriptor.name).toBe('Anthropic');
    expect(descriptor.baseUrl).toBe('https://api.anthropic.com');
  });

  it('prefers an imported custom base URL over the canonical endpoint', () => {
    const descriptor = resolveImportedProvider({
      fileName: 'codex.json',
      authJson: { type: 'codex', base_url: 'https://custom.example.com/v1/' },
      source: 'cpa',
      label: 'Custom Codex',
      credentialHash: 'hash',
    });
    const providers = [
      provider(1, 'Codex', 'https://chatgpt.com/backend-api/codex'),
      provider(2, 'Custom Codex', 'https://custom.example.com/v1'),
    ];

    expect(findImportedProviderMatch(providers, descriptor)?.provider_id).toBe(2);
  });

  it('matches normalized canonical URLs without creating duplicates', () => {
    const descriptor = resolveImportedProvider({
      fileName: 'grok.json',
      authJson: { type: 'xai' },
      source: 'session',
      label: 'Grok',
      credentialHash: 'hash',
    });

    expect(findImportedProviderMatch([
      provider(3, 'Grok', 'HTTPS://API.X.AI/V1/'),
    ], descriptor)?.provider_id).toBe(3);
  });

  it('keeps different credential types separated when they share a canonical URL', () => {
    const descriptor = resolveImportedProvider({
      fileName: 'aistudio.json',
      authJson: { type: 'aistudio' },
      source: 'cpa',
      label: 'AI Studio',
      credentialHash: 'hash',
    });

    expect(findImportedProviderMatch([
      provider(4, 'Gemini', 'https://generativelanguage.googleapis.com'),
    ], descriptor)).toBeUndefined();
  });

  it('picks the latest provider when multiple share a base URL', () => {
    const providers = [
      { ...provider(1, 'Codex Old', 'https://chatgpt.com/backend-api/codex'), update_at: '2026-01-01T00:00:00Z' },
      { ...provider(2, 'Codex New', 'https://chatgpt.com/backend-api/codex'), update_at: '2026-02-01T00:00:00Z' },
      { ...provider(3, 'Codex Newer ID', 'https://chatgpt.com/backend-api/codex'), update_at: '2026-02-01T00:00:00Z' },
    ];
    expect(findLatestProviderByBaseUrl(providers, 'https://chatgpt.com/backend-api/codex/')?.provider_id).toBe(3);
  });
});

  it('creates a provider once for unmatched base_url and reuses it under concurrency', async () => {
    const providers: Provider[] = [];
    const descriptor = resolveImportedProvider({
      fileName: 'codex.json',
      authJson: { type: 'codex' },
      source: 'cpa',
      label: 'Codex',
      credentialHash: 'hash',
    });
    let createCount = 0;
    const locks = new Map<string, Promise<Provider | undefined>>();
    const createProvider = async () => {
      createCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return provider(100 + createCount, 'Codex', 'https://chatgpt.com/backend-api/codex');
    };

    const [first, second] = await Promise.all([
      ensureProviderForCredential(providers, descriptor, { createLocks: locks, createProvider }),
      ensureProviderForCredential(providers, descriptor, { createLocks: locks, createProvider }),
    ]);

    expect(createCount).toBe(1);
    expect(first.created || second.created).toBe(true);
    expect(first.provider?.provider_id).toBe(second.provider?.provider_id);
    expect(providers).toHaveLength(1);

    const again = await ensureProviderForCredential(providers, descriptor, {
      createLocks: locks,
      createProvider,
    });
    expect(again.created).toBe(false);
    expect(createCount).toBe(1);
  });

  it('does not create when base_url is unknown', async () => {
    const providers: Provider[] = [];
    const descriptor = resolveImportedProvider({
      fileName: 'qwen.json',
      authJson: { type: 'qwen' },
      source: 'cpa',
      label: 'Qwen',
      credentialHash: 'hash',
    });
    const result = await ensureProviderForCredential(providers, descriptor, {
      createProvider: async () => {
        throw new Error('should_not_create');
      },
    });
    expect(result.provider).toBeUndefined();
    expect(result.created).toBe(false);
  });

  it('creates separate providers for different types that share a host', async () => {
    const providers: Provider[] = [];
    const locks = new Map<string, Promise<Provider | undefined>>();
    let seq = 0;
    const createProvider = async (input: Partial<Provider>) => {
      seq += 1;
      return provider(200 + seq, input.provider_name || `p-${seq}`, input.base_url || '');
    };

    const gemini = resolveImportedProvider({
      fileName: 'gemini.json',
      authJson: { type: 'gemini' },
      source: 'cpa',
      label: 'Gemini',
      credentialHash: 'g',
    });
    const studio = resolveImportedProvider({
      fileName: 'aistudio.json',
      authJson: { type: 'aistudio' },
      source: 'cpa',
      label: 'Studio',
      credentialHash: 's',
    });

    const [left, right] = await Promise.all([
      ensureProviderForCredential(providers, gemini, { createLocks: locks, createProvider }),
      ensureProviderForCredential(providers, studio, { createLocks: locks, createProvider }),
    ]);

    expect(left.provider?.provider_name).toBe('Gemini');
    expect(right.provider?.provider_name).toBe('Gemini AI Studio');
    expect(left.provider?.provider_id).not.toBe(right.provider?.provider_id);
    expect(providers).toHaveLength(2);
  });

  it('does not bind a custom grok endpoint to the default api.x.ai provider', async () => {
    const providers: Provider[] = [
      provider(1, 'Grok', 'https://api.x.ai/v1'),
    ];
    const descriptor = resolveImportedProvider({
      fileName: 'cli-proxy.grok.json',
      authJson: {
        type: 'xai',
        base_url: 'https://cli-chat-proxy.grok.com/v1',
        access_token: 'tok',
      },
      source: 'cpa',
      label: 'CLI proxy',
      credentialHash: 'hash',
    });

    // Match must miss the default api.x.ai row.
    expect(matchProviderForCredential(providers, descriptor, descriptor.baseUrl)).toBeUndefined();
    expect(findImportedProviderMatch(providers, descriptor, descriptor.baseUrl)).toBeUndefined();

    const ensured = await ensureProviderForCredential(providers, descriptor, {
      preferredBaseUrl: descriptor.baseUrl,
      createProvider: async (input) =>
        provider(9, input.provider_name || 'Grok custom', input.base_url || ''),
    });

    expect(ensured.created).toBe(true);
    expect(ensured.provider?.base_url).toBe('https://cli-chat-proxy.grok.com/v1');
    expect(ensured.provider?.provider_name).toContain('cli-chat-proxy.grok.com');
    expect(providers).toHaveLength(2);
  });

  it('reuses an existing custom endpoint provider by exact base_url', async () => {
    const providers: Provider[] = [
      provider(1, 'Grok', 'https://api.x.ai/v1'),
      provider(2, 'Grok (cli-chat-proxy.grok.com)', 'https://cli-chat-proxy.grok.com/v1'),
    ];
    const descriptor = resolveImportedProvider({
      fileName: 'cli-proxy.grok.json',
      authJson: {
        type: 'xai',
        base_url: 'https://cli-chat-proxy.grok.com/v1/',
      },
      source: 'cpa',
      label: 'CLI proxy',
      credentialHash: 'hash',
    });

    const ensured = await ensureProviderForCredential(providers, descriptor, {
      preferredBaseUrl: descriptor.baseUrl,
      createProvider: async () => {
        throw new Error('should_not_create');
      },
    });
    expect(ensured.created).toBe(false);
    expect(ensured.provider?.provider_id).toBe(2);
  });

