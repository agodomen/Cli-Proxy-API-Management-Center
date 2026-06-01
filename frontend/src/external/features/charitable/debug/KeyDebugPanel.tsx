import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { useModelsStore } from '@/stores/useModelsStore';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { normalizeApiBase } from '@/utils/connection';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api/apiCall';
import { PROTOCOL_PRIMES, type ProtocolKey } from '../types';
import { computeApiType } from '../utils';
import { IconLoader2 } from '../../serviceProviders/ui/icons';
import {
  usageServiceApi,
  USAGE_SERVICE_LAST_CPA_BASE_KEY,
  LEGACY_USAGE_SERVICE_LAST_CPA_BASE_KEY,
} from '@/external/services/api/usageService';
import {
  getKeyDebugSettings,
  listKeyProviderModels,
  probeKeyProtocols,
  saveKeyCredential,
  saveKeyDebugSettings,
  type ExtractedCredential,
  type ProbeResult,
} from './keyDebugApi';
import styles from './DebugPage.module.scss';

const PROTOCOL_OPTIONS: ProtocolKey[] = ['openai', 'anthropic', 'gemini', 'openai_responses'];
const EXTRACT_MODEL_AUTO = 'auto';

const FALLBACK_SYSTEM_PROMPT = `You are a credential extractor for messy / anti-scrape text.

Input format:
<prompt>...</prompt> is this instruction
<text>...</text> is the source text to analyze

Return ONLY one JSON object (no markdown, no explanation):
{"baseUrl":"...","apiKey":"...","model":"..."}

Field rules:
1) baseUrl
- Prefer scheme + host (optionally port), e.g. "https://api.example.com"
- Remove trailing chat paths like /v1/chat/completions, /chat/completions, /responses, /messages
- Text may be obfuscated. Reconstruct valid URL when possible:
  - "https: 😴://ooi.li00.xyz/" => "https://ooi.li00.xyz"
  - "https: :sleeping_face://ooi.li00.xyz/" => "https://ooi.li00.xyz"
  - "https : //api.example.com" => "https://api.example.com"
  - emoji / Chinese noise between scheme and host should be ignored
- If only a bare host appears (e.g. api.example.com), prefix https://

2) apiKey
- Extract the secret token (often starts with sk-, sk-ant-, AIza...)
- Keep original characters; do not invent keys
- If text says it is base64 and you can decode confidently, put decoded value; otherwise keep original

3) model
- Only if explicitly present; otherwise ""

Hard constraints:
- Missing field => ""
- Never invent credentials not supported by the text
- No markdown fences, no comments, no extra keys`;

function randomMathPrompt(): string {
  const a = 10 + Math.floor(Math.random() * 40);
  const b = 10 + Math.floor(Math.random() * 40);
  return `Compute ${a}+${b} and reply with only the number.`;
}

function preferredListProtocol(protocols: ProtocolKey[]): string {
  if (protocols.includes('openai') || protocols.includes('openai_responses')) return 'openai';
  if (protocols.includes('anthropic')) return 'anthropic';
  if (protocols.includes('gemini')) return 'gemini';
  return 'openai';
}

function buildChatEndpointCandidates(apiBase: string): string[] {
  const normalized = normalizeApiBase(apiBase).replace(/\/+$/g, '');
  if (!normalized) return [];

  // CPA OpenAI-compatible chat endpoint is /v1/chat/completions.
  // Do NOT use bare /chat/completions — many CPA builds return 404 there and hide the real error.
  return [`${normalized}/v1/chat/completions`];
}

function readCachedCpaBase(): string {
  try {
    const raw =
      localStorage.getItem(USAGE_SERVICE_LAST_CPA_BASE_KEY) ||
      localStorage.getItem(LEGACY_USAGE_SERVICE_LAST_CPA_BASE_KEY) ||
      '';
    return normalizeApiBase(raw);
  } catch {
    return '';
  }
}

function unwrapLLMJSON(content: string): ExtractedCredential | null {
  const raw = String(content ?? '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    const baseUrl = String(parsed.baseUrl ?? parsed.base_url ?? '').trim();
    const apiKey = String(parsed.apiKey ?? parsed.api_key ?? '').trim();
    const model = String(parsed.model ?? '').trim();
    if (!baseUrl && !apiKey && !model) return null;
    return {
      baseUrl: baseUrl || undefined,
      apiKey: apiKey || undefined,
      model: model || undefined,
      source: 'llm',
    };
  } catch {
    return null;
  }
}

function extractLLMContent(payload: unknown): string {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;

  const data = payload as Record<string, unknown>;
  const choices = data.choices;
  if (Array.isArray(choices) && choices[0]) {
    const first = choices[0] as Record<string, unknown>;
    const message = first.message as Record<string, unknown> | undefined;
    if (typeof message?.content === 'string') return message.content;
    if (Array.isArray(message?.content)) {
      return message.content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && 'text' in part) {
            return String((part as { text?: unknown }).text ?? '');
          }
          return '';
        })
        .join('');
    }
    if (typeof first.text === 'string') return first.text;
  }

  if (typeof data.output_text === 'string') return data.output_text;
  if (typeof data.content === 'string') return data.content;
  return '';
}

type LLMCallSuccess = {
  ok: true;
  content: string;
  endpoint: string;
  via: 'api-call' | 'direct';
};

type LLMCallFailure = {
  ok: false;
  status?: number;
  endpoint?: string;
  via?: 'api-call' | 'direct';
  detail?: string;
};

async function callSystemLLM(options: {
  apiBase: string;
  proxyKey: string;
  model: string;
  /** Full system prompt from settings DB / page — no extra hardcoded instruction. */
  systemPrompt: string;
  /** Raw credential text only. */
  userText: string;
}): Promise<LLMCallSuccess | LLMCallFailure> {
  const endpoints = buildChatEndpointCandidates(options.apiBase);
  if (!endpoints.length) {
    return { ok: false, detail: 'empty chat endpoint' };
  }

  const systemPrompt = options.systemPrompt.trim();
  if (!systemPrompt) {
    return { ok: false, detail: 'empty system prompt' };
  }

  // Use ONLY the page/DB prompt as system message. No extra code-side instruction.
  const body = {
    model: options.model,
    temperature: 0,
    stream: false,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: options.userText },
    ],
  };

  const attempts: LLMCallFailure[] = [];

  // 1) Direct call to CPA Upstream first.
  // This matches how system /v1/models is fetched, and avoids routing api-call
  // through a non-CPA host when the panel is hosted by usage-service.
  for (const endpoint of endpoints) {
    try {
      const response = await axios.post(endpoint, body, {
        headers: {
          Authorization: `Bearer ${options.proxyKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 45000,
        validateStatus: () => true,
      });
      if (response.status >= 200 && response.status < 300) {
        return {
          ok: true,
          content: extractLLMContent(response.data),
          endpoint,
          via: 'direct',
        };
      }
      attempts.push({
        ok: false,
        status: response.status,
        endpoint,
        via: 'direct',
        detail:
          typeof response.data === 'string'
            ? response.data
            : JSON.stringify(response.data ?? {}).slice(0, 400),
      });
    } catch (error) {
      attempts.push({
        ok: false,
        endpoint,
        via: 'direct',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 2) Fallback: management api-call proxy (useful when browser CORS blocks direct chat).
  for (const endpoint of endpoints) {
    try {
      const result = await apiCallApi.request(
        {
          method: 'POST',
          url: endpoint,
          header: {
            Authorization: `Bearer ${options.proxyKey}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify(body),
        },
        { timeout: 45000 }
      );
      if (result.statusCode >= 200 && result.statusCode < 300) {
        return {
          ok: true,
          content: extractLLMContent(result.body) || result.bodyText,
          endpoint,
          via: 'api-call',
        };
      }
      attempts.push({
        ok: false,
        status: result.statusCode,
        endpoint,
        via: 'api-call',
        detail: getApiCallErrorMessage(result),
      });
    } catch (error) {
      attempts.push({
        ok: false,
        endpoint,
        via: 'api-call',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Prefer the most informative failure (non-404 over 404, with detail).
  const ranked = [...attempts].sort((a, b) => {
    const score = (x: LLMCallFailure) => {
      let s = 0;
      if (x.status && x.status !== 404 && x.status !== 405) s += 3;
      if (x.detail) s += 1;
      if (x.via === 'direct') s += 1;
      return s;
    };
    return score(b) - score(a);
  });
  return ranked[0] ?? { ok: false, detail: 'all chat attempts failed' };
}

export function KeyDebugPanel() {
  const { t } = useTranslation();
  const usageBase = useUsageServiceStore((s) => s.serviceBase);
  const managementKey = useAuthStore((s) => s.managementKey) ?? '';
  const authApiBase = useAuthStore((s) => s.apiBase);
  const showNotification = useNotificationStore((s) => s.showNotification);
  const systemModels = useModelsStore((s) => s.models);
  const systemModelsLoading = useModelsStore((s) => s.loading);
  const fetchSystemModels = useModelsStore((s) => s.fetchModels);
  const resolveApiKeysForModels = useApiKeysForModels();

  const [rawText, setRawText] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(FALLBACK_SYSTEM_PROMPT);
  const [probePrompt, setProbePrompt] = useState(randomMathPrompt());
  const [selectedProtocols, setSelectedProtocols] = useState<ProtocolKey[]>(['openai']);
  const DEFAULT_PROTOCOL_PATHS: Record<ProtocolKey, string> = {
    openai: '/v1/chat/completions',
    anthropic: '/v1/messages',
    gemini: '/v1beta/models/{model}:generateContent',
    openai_responses: '/v1/responses',
  };
  const [protocolPaths, setProtocolPaths] = useState<Record<string, string>>(
    () => ({ ...DEFAULT_PROTOCOL_PATHS })
  );
  // Default extract model is auto; user can pick a concrete system model.
  const [extractModel, setExtractModel] = useState(EXTRACT_MODEL_AUTO);
  const [cpaUpstream, setCpaUpstream] = useState('');

  const [baseURLValue, setBaseURLValue] = useState('');
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [modelValue, setModelValue] = useState(''); // empty => probe all models
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<ExtractedCredential[]>([]);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<ProbeResult[]>([]);
  const [busy, setBusy] = useState<'idle' | 'settings' | 'extract' | 'models' | 'probe' | 'save'>('idle');

  const apiType = useMemo(() => computeApiType(selectedProtocols), [selectedProtocols]);
  const systemModelNames = useMemo(
    () =>
      Array.from(
        new Set(
          systemModels
            .map((m) => String(m.name || '').trim())
            .filter(Boolean)
        )
      ),
    [systemModels]
  );

  const resolveCpaUpstream = useCallback(async (): Promise<string> => {
    // 1) Usage-service manager config: cpaConnection.cpaBaseUrl is the CPA Upstream.
    if (usageBase) {
      try {
        const response = await usageServiceApi.getManagerConfig(
          usageBase,
          managementKey || undefined
        );
        const upstream = normalizeApiBase(response.config?.cpaConnection?.cpaBaseUrl || '');
        if (upstream) {
          setCpaUpstream(upstream);
          return upstream;
        }
      } catch {
        // fall through
      }
    }

    // 2) Cached last CPA base from usage-service login/setup.
    const cached = readCachedCpaBase();
    if (cached) {
      setCpaUpstream(cached);
      return cached;
    }

    // 3) Last resort: auth apiBase (may already be CPA in some deployments).
    const fallback = normalizeApiBase(authApiBase || '');
    setCpaUpstream(fallback);
    return fallback;
  }, [usageBase, managementKey, authApiBase]);

  const loadSettings = useCallback(async () => {
    if (!usageBase) return;
    setBusy('settings');
    try {
      const settings = await getKeyDebugSettings(usageBase, managementKey || undefined);
      setSystemPrompt(settings.systemPrompt?.trim() || FALLBACK_SYSTEM_PROMPT);
      if (settings.probePrompt) setProbePrompt(settings.probePrompt);
    } catch {
      setSystemPrompt(FALLBACK_SYSTEM_PROMPT);
    } finally {
      setBusy('idle');
    }
  }, [usageBase, managementKey]);

  const loadSystemModels = useCallback(async () => {
    const upstream = cpaUpstream || (await resolveCpaUpstream());
    if (!upstream) return;
    try {
      const keys = await resolveApiKeysForModels();
      const primaryKey = keys[0];
      if (!primaryKey) return;
      // Models must also come from CPA Upstream, not usage-service host.
      await fetchSystemModels(upstream, primaryKey, false);
      // Keep extractModel as auto by default; do not auto-overwrite user choice.
    } catch {
      // optional: system models may be unavailable
    }
  }, [cpaUpstream, resolveCpaUpstream, resolveApiKeysForModels, fetchSystemModels]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void (async () => {
      await resolveCpaUpstream();
    })();
  }, [resolveCpaUpstream]);

  useEffect(() => {
    void loadSystemModels();
  }, [loadSystemModels]);

  const handleSaveSettings = async () => {
    if (!usageBase) {
      showNotification(t('charitable.debug.baseMissing'), 'error');
      return;
    }
    setBusy('settings');
    try {
      const saved = await saveKeyDebugSettings(
        usageBase,
        { systemPrompt, probePrompt },
        managementKey || undefined
      );
      setSystemPrompt(saved.systemPrompt);
      setProbePrompt(saved.probePrompt);
      showNotification(t('charitable.debug.key.settingsSaved'), 'success');
    } catch {
      showNotification(t('charitable.debug.key.settingsSaveFailed'), 'error');
    } finally {
      setBusy('idle');
    }
  };

  const applyCandidate = (item: ExtractedCredential) => {
    if (item.baseUrl) setBaseURLValue(item.baseUrl);
    if (item.apiKey) setApiKeyValue(item.apiKey);
    if (item.model) setModelValue(item.model);
  };

  const handleExtract = async () => {
    if (!rawText.trim()) {
      showNotification(t('charitable.debug.key.textRequired'), 'error');
      return;
    }

    setBusy('extract');
    setExtractNote(null);
    setCandidates([]);
    try {
      const upstream = cpaUpstream || (await resolveCpaUpstream());
      if (!upstream) {
        setExtractNote(t('charitable.debug.key.manualFallbackHint'));
        showNotification(t('charitable.debug.key.cpaUpstreamMissing'), 'error');
        return;
      }

      const keys = await resolveApiKeysForModels();
      const proxyKey = keys[0];
      if (!proxyKey) {
        setExtractNote(t('charitable.debug.key.manualFallbackHint'));
        showNotification(t('charitable.debug.key.llmExtractUnavailable'), 'warning');
        return;
      }

      // auto => keep "auto" for CPA routing; otherwise use explicit system model.
      const selected = extractModel.trim() || EXTRACT_MODEL_AUTO;
      const modelForLLM =
        selected === EXTRACT_MODEL_AUTO
          ? EXTRACT_MODEL_AUTO
          : selected;

      // Strict: only the prompt saved on page / settings DB (chariable.debug.api_key).
      // Do not inject any extra code-side system instruction.
      const promptText = systemPrompt.trim();
      if (!promptText) {
        setExtractNote(t('charitable.debug.key.systemPromptRequired'));
        showNotification(t('charitable.debug.key.systemPromptRequired'), 'error');
        return;
      }

      const result = await callSystemLLM({
        apiBase: upstream,
        proxyKey,
        model: modelForLLM,
        systemPrompt: promptText,
        userText: rawText.trim(),
      });

      if (!result.ok) {
        const statusText = result.status ? `HTTP ${result.status}` : 'failed';
        const endpointText = result.endpoint ? ` @ ${result.endpoint}` : '';
        const viaText = result.via ? ` via ${result.via}` : '';
        const detail = result.detail ? ` — ${result.detail}` : '';
        setExtractNote(
          `${t('charitable.debug.key.manualFallbackHint')}\nCPA Upstream: ${upstream}\nmodel: ${modelForLLM}\n${statusText}${viaText}${endpointText}${detail}`
        );
        showNotification(
          t('charitable.debug.key.llmExtractFailedStatus', {
            status: result.status ?? 'ERR',
          }),
          'warning'
        );
        return;
      }

      const llmItem = unwrapLLMJSON(result.content);
      if (!llmItem) {
        setExtractNote(
          `${t('charitable.debug.key.manualFallbackHint')}\n${t(
            'charitable.debug.key.llmExtractParseFailed'
          )}\nCPA Upstream: ${upstream}\n@ ${result.endpoint}`
        );
        showNotification(t('charitable.debug.key.llmExtractParseFailed'), 'warning');
        return;
      }

      setCandidates([llmItem]);
      applyCandidate(llmItem);
      showNotification(t('charitable.debug.key.extractDone', { count: 1 }), 'success');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setExtractNote(`${t('charitable.debug.key.manualFallbackHint')}\n${detail}`);
      showNotification(t('charitable.debug.key.llmExtractFailed'), 'warning');
    } finally {
      setBusy('idle');
    }
  };

  const toggleProtocol = (key: ProtocolKey) => {
    setSelectedProtocols((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  };

  const fetchProviderModels = useCallback(async (): Promise<string[]> => {
    if (!usageBase) {
      throw new Error('usage base missing');
    }
    if (!baseURLValue.trim() || !apiKeyValue.trim()) {
      throw new Error('credential required');
    }
    setBusy('models');
    try {
      const res = await listKeyProviderModels(
        usageBase,
        {
          baseUrl: baseURLValue.trim(),
          apiKey: apiKeyValue.trim(),
          protocol: preferredListProtocol(selectedProtocols),
          maxModels: 50,
        },
        managementKey || undefined
      );
      const models = res.models ?? [];
      setProviderModels(models);
      return models;
    } finally {
      setBusy('idle');
    }
  }, [usageBase, baseURLValue, apiKeyValue, selectedProtocols, managementKey]);

  const handleFetchModels = async () => {
    try {
      const models = await fetchProviderModels();
      showNotification(
        t('charitable.debug.key.modelsFetched', { count: models.length }),
        models.length ? 'success' : 'warning'
      );
    } catch {
      showNotification(t('charitable.debug.key.modelsFetchFailed'), 'error');
    }
  };

  const handleProbe = async () => {
    if (!usageBase) {
      showNotification(t('charitable.debug.baseMissing'), 'error');
      return;
    }
    if (!baseURLValue.trim() || !apiKeyValue.trim()) {
      showNotification(t('charitable.debug.key.credentialRequired'), 'error');
      return;
    }
    if (selectedProtocols.length === 0) {
      showNotification(t('charitable.debug.key.protocolRequired'), 'error');
      return;
    }

    const selectedModel = modelValue.trim();
    let modelsToProbe: string[] | undefined;
    if (!selectedModel) {
      // Empty model => fetch all provider models first, then probe each.
      try {
        const models =
          providerModels.length > 0 ? providerModels : await fetchProviderModels();
        if (!models.length) {
          showNotification(t('charitable.debug.key.noProviderModels'), 'error');
          return;
        }
        modelsToProbe = models;
        showNotification(
          t('charitable.debug.key.probeAllModels', { count: models.length }),
          'info'
        );
      } catch {
        showNotification(t('charitable.debug.key.modelsFetchFailed'), 'error');
        return;
      }
    }

    setBusy('probe');
    setProbeResults([]);
    try {
      const res = await probeKeyProtocols(
        usageBase,
        {
          baseUrl: baseURLValue.trim(),
          apiKey: apiKeyValue.trim(),
          model: selectedModel || undefined,
          models: modelsToProbe,
          protocols: selectedProtocols,
          protocolPaths: selectedProtocols.reduce<Record<string, string>>((acc, p) => {
            const v = protocolPaths[p]?.trim();
            if (v) acc[p] = v;
            return acc;
          }, {}),
          probePrompt: probePrompt.trim() || randomMathPrompt(),
          maxModels: 20,
        },
        managementKey || undefined
      );
      if (res.models?.length) {
        setProviderModels(res.models);
      }
      setProbeResults(res.results ?? []);
      const okCount = (res.results ?? []).filter((r) => r.ok).length;
      showNotification(
        t('charitable.debug.key.probeDone', {
          ok: okCount,
          total: res.results?.length ?? 0,
        }),
        okCount ? 'success' : 'warning'
      );
    } catch {
      showNotification(t('charitable.debug.key.probeFailed'), 'error');
    } finally {
      setBusy('idle');
    }
  };

  const handleSave = async () => {
    if (!usageBase) {
      showNotification(t('charitable.debug.baseMissing'), 'error');
      return;
    }
    if (!baseURLValue.trim() || !apiKeyValue.trim()) {
      showNotification(t('charitable.debug.key.credentialRequired'), 'error');
      return;
    }
    setBusy('save');
    try {
      const result = await saveKeyCredential(
        usageBase,
        {
          baseUrl: baseURLValue.trim(),
          apiKey: apiKeyValue.trim(),
          model: modelValue.trim() || undefined,
          apiType: apiType > 1 ? apiType : PROTOCOL_PRIMES.openai,
          channelName: 'localhost',
          remark: 'key-debug import',
          content: rawText.slice(0, 500),
        },
        managementKey || undefined
      );
      showNotification(
        t('charitable.debug.key.saveDone', {
          channel: result.created.channel ? 'new' : 'reuse',
          provider: result.created.provider ? 'new' : 'reuse',
        }),
        'success'
      );
    } catch {
      showNotification(t('charitable.debug.key.saveFailed'), 'error');
    } finally {
      setBusy('idle');
    }
  };

  const probeModelOptions = useMemo(() => {
    const set = new Set<string>();
    providerModels.forEach((m) => m && set.add(m));
    if (modelValue.trim()) set.add(modelValue.trim());
    return Array.from(set);
  }, [providerModels, modelValue]);

  return (
    <div className={styles.keyDebugLayout}>
      <aside className={styles.keyDebugSide}>
        <div className={styles.keyDebugSideTitle}>{t('charitable.debug.key.config')}</div>

        <div className={styles.keyHint}>{t('charitable.debug.key.llmOnlyHint')}</div>

        <div className={styles.keyField}>
          <span>{t('charitable.debug.key.extractModel')}</span>
          <select
            className={styles.keyInput}
            value={
              extractModel === EXTRACT_MODEL_AUTO || systemModelNames.includes(extractModel)
                ? extractModel || EXTRACT_MODEL_AUTO
                : EXTRACT_MODEL_AUTO
            }
            onChange={(e) => setExtractModel(e.target.value || EXTRACT_MODEL_AUTO)}
            disabled={systemModelsLoading && systemModelNames.length === 0}
          >
            <option value={EXTRACT_MODEL_AUTO}>
              {t('charitable.debug.key.extractModelAuto')}
            </option>
            {systemModelNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <div className={styles.keyHint}>
            {cpaUpstream
              ? t('charitable.debug.key.cpaUpstreamHint', { url: cpaUpstream })
              : t('charitable.debug.key.cpaUpstreamMissing')}
          </div>
          <div className={styles.keyHint}>
            {systemModelsLoading
              ? t('charitable.debug.key.systemModelsLoading')
              : systemModelNames.length
                ? t('charitable.debug.key.systemModelsHint', { count: systemModelNames.length })
                : t('charitable.debug.key.systemModelsEmpty')}
          </div>
          <button
            type="button"
            className={styles.keyGhostBtn}
            onClick={() => void loadSystemModels()}
            disabled={busy !== 'idle' || !(cpaUpstream || authApiBase)}
          >
            {t('charitable.debug.key.refreshSystemModels')}
          </button>
        </div>

        <div className={styles.keyField}>
          <span>{t('charitable.debug.key.systemPrompt')}</span>
          <textarea
            className={styles.keyTextarea}
            rows={10}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
          <button
            type="button"
            className={styles.keyGhostBtn}
            onClick={() => setSystemPrompt(FALLBACK_SYSTEM_PROMPT)}
          >
            {t('charitable.debug.key.resetSystemPrompt')}
          </button>
        </div>

        <div className={styles.keyField}>
          <span>{t('charitable.debug.key.probePrompt')}</span>
          <textarea
            className={styles.keyTextarea}
            rows={3}
            value={probePrompt}
            onChange={(e) => setProbePrompt(e.target.value)}
          />
          <button
            type="button"
            className={styles.keyGhostBtn}
            onClick={() => setProbePrompt(randomMathPrompt())}
          >
            {t('charitable.debug.key.randomProbe')}
          </button>
        </div>

        <div className={styles.keyField}>
          <span>{t('charitable.debug.key.protocols')}</span>
          <div className={styles.keyProtocolList}>
            {PROTOCOL_OPTIONS.map((key) => {
              const pathValue = protocolPaths[key] || '';
              const showPathInput = selectedProtocols.includes(key);
              return (
                <div key={key} className={styles.keyProtocolRow}>
                  <label className={styles.keyCheck}>
                    <input
                      type="checkbox"
                      checked={selectedProtocols.includes(key)}
                      onChange={() => toggleProtocol(key)}
                    />
                    {t(`charitable.key.protocols.${key}`)}
                  </label>
                  {showPathInput ? (
                    <input
                      className={styles.keyPathInput}
                      value={pathValue}
                      onChange={(e) =>
                        setProtocolPaths((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      placeholder={DEFAULT_PROTOCOL_PATHS[key]}
                      disabled={busy !== 'idle'}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className={styles.keyHint}>api_type = {apiType}</div>
        </div>

        <button
          type="button"
          className={styles.keyPrimaryBtn}
          onClick={() => void handleSaveSettings()}
          disabled={busy !== 'idle'}
        >
          {t('charitable.debug.key.saveSettings')}
        </button>
      </aside>

      <section className={styles.keyDebugMain}>
        <div className={styles.keyPanel}>
          <div className={styles.keyPanelHeader}>
            <strong>{t('charitable.debug.key.rawText')}</strong>
            <button
              type="button"
              className={styles.keyPrimaryBtn}
              onClick={() => void handleExtract()}
              disabled={busy !== 'idle'}
            >
              {busy === 'extract' ? (
                <span className={styles.spinner}>
                  <IconLoader2 size={14} />
                  {t('charitable.debug.key.extracting')}
                </span>
              ) : (
                t('charitable.debug.key.extract')
              )}
            </button>
          </div>
          <textarea
            className={styles.keyRaw}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={t('charitable.debug.key.rawPlaceholder')}
          />
          {extractNote ? <div className={styles.keyErrorLine}>{extractNote}</div> : null}
        </div>

        {candidates.length > 0 ? (
          <div className={styles.keyPanel}>
            <div className={styles.keyPanelHeader}>
              <strong>{t('charitable.debug.key.candidates')}</strong>
            </div>
            <div className={styles.keyCandidateList}>
              {candidates.map((item, index) => (
                <button
                  key={`${item.source}-${index}`}
                  type="button"
                  className={styles.keyCandidate}
                  onClick={() => applyCandidate(item)}
                >
                  <span>{item.baseUrl || '—'}</span>
                  <span className={styles.keyMono}>
                    {item.apiKey ? `${item.apiKey.slice(0, 8)}…` : '—'}
                  </span>
                  <span>{item.model || '—'}</span>
                  <span className={styles.keyHint}>{item.source}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className={styles.keyPanel}>
          <div className={styles.keyPanelHeader}>
            <strong>{t('charitable.debug.key.credential')}</strong>
            <button
              type="button"
              className={styles.keyGhostBtn}
              onClick={() => void handleFetchModels()}
              disabled={busy !== 'idle' || !baseURLValue.trim() || !apiKeyValue.trim()}
            >
              {t('charitable.debug.key.fetchProviderModels')}
            </button>
          </div>
          <div className={styles.keyFormGrid}>
            <label className={styles.keyField}>
              <span>base_url</span>
              <input
                className={styles.keyInput}
                value={baseURLValue}
                onChange={(e) => setBaseURLValue(e.target.value)}
              />
            </label>
            <label className={styles.keyField}>
              <span>api_key</span>
              <input
                className={styles.keyInput}
                value={apiKeyValue}
                onChange={(e) => setApiKeyValue(e.target.value)}
              />
            </label>
            <label className={styles.keyField}>
              <span>model</span>
              <input
                className={styles.keyInput}
                list="key-debug-provider-models"
                value={modelValue}
                onChange={(e) => setModelValue(e.target.value)}
                placeholder={t('charitable.debug.key.probeAllModelsOption')}
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id="key-debug-provider-models">
                {probeModelOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <div className={styles.keyHint}>
                {modelValue.trim()
                  ? t('charitable.debug.key.probeOneModelHint')
                  : t('charitable.debug.key.probeAllModelsHint')}
              </div>
            </label>
          </div>
          <div className={styles.keyActions}>
            <button
              type="button"
              className={styles.keyPrimaryBtn}
              onClick={() => void handleProbe()}
              disabled={busy !== 'idle'}
            >
              {busy === 'models'
                ? t('charitable.debug.key.fetchingModels')
                : busy === 'probe'
                  ? t('charitable.debug.key.probing')
                  : t('charitable.debug.key.probe')}
            </button>
            <button
              type="button"
              className={styles.keySuccessBtn}
              onClick={() => void handleSave()}
              disabled={busy !== 'idle'}
            >
              {t('charitable.debug.key.saveToKeys')}
            </button>
          </div>
        </div>

        {probeResults.length > 0 ? (
          <div className={styles.keyPanel}>
            <div className={styles.keyPanelHeader}>
              <strong>{t('charitable.debug.key.probeResults')}</strong>
              <span className={styles.keyHint}>
                {t('charitable.debug.key.probeSummary', {
                  ok: probeResults.filter((r) => r.ok).length,
                  fail: probeResults.filter((r) => !r.ok).length,
                  total: probeResults.length,
                })}
              </span>
            </div>
            <div className={styles.keyProbeList}>
              {probeResults.map((item, index) => (
                <div
                  key={`${item.protocol}-${item.model || ''}-${index}`}
                  className={item.ok ? styles.keyProbeOk : styles.keyProbeBad}
                >
                  <div className={styles.keyProbeTop}>
                    <strong>{item.protocol}</strong>
                    <span className={styles.keyMono}>{item.model || '—'}</span>
                    <span>{item.ok ? 'OK' : 'FAIL'}</span>
                    <span>{item.statusCode ?? '—'}</span>
                    <span>{item.latencyMs}ms</span>
                  </div>
                  <div className={styles.keyMono}>{item.endpoint}</div>
                  {item.error ? <div className={styles.keyErrorLine}>{item.error}</div> : null}
                  <details className={styles.keyBodyDetails} open={!item.ok}>
                    <summary>{t('charitable.debug.key.requestBody')}</summary>
                    <pre className={styles.keySnippet}>
                      {item.requestBody?.trim() || t('charitable.debug.key.emptyBody')}
                    </pre>
                  </details>
                  <details className={styles.keyBodyDetails} open>
                    <summary>{t('charitable.debug.key.responseBody')}</summary>
                    <pre className={styles.keySnippet}>
                      {(item.responseBody || item.snippet)?.trim() ||
                        t('charitable.debug.key.emptyBody')}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
