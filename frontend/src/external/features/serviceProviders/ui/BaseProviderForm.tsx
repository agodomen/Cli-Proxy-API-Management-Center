/**
 * Self-contained BaseProviderForm for openaiCompatibility (external / CPA Manager).
 * Rewritten to match community provider form patterns (Collapsible sections,
 * Select test-model dropdown, reversed API key entries) while preserving
 * external-specific features:
 *   - renderEntryCardExtra, onFetchModels / fetchedModels, onTestApiKey, onTestAllApiKeys, …
 *   - Eye-icon password toggle that actually reveals the real key (including existingApiKey)
 *   - Left-aligned save / cancel buttons (form buttons are outside this component via formId)
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import { Select } from '@/components/ui/Select';
import { ProxyCombobox } from '@/external/features/charitable/components/ProxyCombobox';
import { HeadersEditor } from '@/external/components/ui/HeadersEditor';
import { useHeaderPresets } from '@/external/hooks/useHeaderPresets';
import type { HeaderEntry } from '@/utils/headers';
import { ModelDiscoveryPanel } from './ModelDiscoveryPanel';
import {
  IconCheckCircle2,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconPlus,
  IconTrash2,
  IconX,
} from './icons';
import type {
  ApiKeyEntryInput,
  ModelEntryInput,
  ProviderEntryFormInput,
  ProviderResource,
} from '../types';
import type { ModelInfo } from '@/utils/models';
import styles from '../styles/baseForm.module.scss';

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export interface BaseProviderFormHandle {
  submit: () => Promise<void>;
}

interface BaseProviderFormProps {
  brand: 'openaiCompatibility';
  resource: ProviderResource | null;
  mode: 'create' | 'edit';
  mutating: boolean;
  formId: string;
  onSubmit: (input: ProviderEntryFormInput) => Promise<void>;
  /** Usage service base URL used to load charitable proxies. */
  proxyServiceBaseUrl?: string;
  /** Management key used for charitable proxy list requests. */
  proxyManagementKey?: string;
  renderEntryCardExtra?: (realIdx: number, entry: ApiKeyEntryInput) => React.ReactNode;
  onFetchModels?: (params: {
    baseUrl: string;
    apiKey: string;
    headers: Record<string, string>;
    authIndex?: string;
  }) => void;
  fetchingModels?: boolean;
  fetchedModels?: Array<{ name: string; alias?: string }>;
  onTestApiKey?: (
    realIdx: number,
    params: { baseUrl: string; apiKey: string; headers: Record<string, string>; authIndex?: string },
  ) => void;
  testingApiKeyIdx?: number | null;
  apiKeyTestStatus?: Record<
    number,
    { state: 'idle' | 'loading' | 'success' | 'error'; message?: string; statusCode?: number }
  >;
  onTestAllApiKeys?: (params: {
    baseUrl: string;
    apiKeyEntries: ApiKeyEntryInput[];
    headers: Record<string, string>;
  }) => void;
  testingAnyApiKey?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const emptyHeader = () => ({ key: '', value: '' });
const emptyModel = (): ModelEntryInput => ({ name: '', alias: '' });
const emptyApiKeyEntry = (): ApiKeyEntryInput => ({ apiKey: '', proxyUrl: '' });

const formatJsonObject = (value?: Record<string, unknown>): string => {
  if (!value || Object.keys(value).length === 0) return '';
  return JSON.stringify(value, null, 2);
};

function buildInitialForm(
  resource: ProviderResource | null,
  mode: 'create' | 'edit',
): ProviderEntryFormInput {
  if (mode === 'create' || !resource) {
    return {
      apiKey: '',
      name: '',
      baseUrl: '',
      proxyUrl: '',
      prefix: '',
      disabled: false,
      disableCooling: false,
      priority: undefined,
      models: [emptyModel()],
      headers: [emptyHeader()],
      excludedModelsText: '',
      testModel: '',
      apiKeyEntries: [emptyApiKeyEntry()],
    };
  }
  const cfg = resource.raw as {
    name?: string;
    baseUrl?: string;
    prefix?: string;
    disabled?: boolean;
    disableCooling?: boolean;
    priority?: number;
    models?: Array<{ name: string; alias?: string; priority?: number; testModel?: string; image?: boolean; thinking?: Record<string, unknown> }>;
    headers?: Record<string, string>;
    testModel?: string;
    apiKeyEntries?: Array<{ apiKey: string; proxyUrl?: string; authIndex?: string }>;
  };
  return {
    apiKey: '',
    name: cfg.name ?? '',
    baseUrl: cfg.baseUrl ?? '',
    proxyUrl: '',
    prefix: cfg.prefix ?? '',
    disabled: cfg.disabled === true,
    disableCooling: cfg.disableCooling === true,
    priority: cfg.priority,
    models: cfg.models?.length
      ? cfg.models.map((m) => ({
          name: m.name,
          alias: m.alias ?? '',
          priority: m.priority,
          testModel: m.testModel,
          image: m.image === true,
          thinkingJson: formatJsonObject(m.thinking),
        }))
      : [emptyModel()],
    headers: cfg.headers
      ? Object.entries(cfg.headers).map(([k, v]) => ({ key: k, value: String(v) }))
      : [emptyHeader()],
    excludedModelsText: '',
    testModel: cfg.testModel ?? '',
    apiKeyEntries: cfg.apiKeyEntries?.length
      ? cfg.apiKeyEntries.map((entry) => ({
          apiKey: '',
          existingApiKey: entry.apiKey,
          proxyUrl: entry.proxyUrl ?? '',
          authIndex: entry.authIndex,
        }))
      : [emptyApiKeyEntry()],
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function BaseProviderForm({
  brand: _brand,
  resource,
  mode,
  mutating,
  formId,
  onSubmit,
  proxyServiceBaseUrl = '',
  proxyManagementKey,
  renderEntryCardExtra,
  onFetchModels,
  fetchingModels,
  fetchedModels,
  onTestApiKey,
  testingApiKeyIdx: _testingApiKeyIdx,
  apiKeyTestStatus,
  onTestAllApiKeys,
  testingAnyApiKey,
}: BaseProviderFormProps) {
  const { t } = useTranslation();
  const fid = useId();

  /* ── state ──────────────────────────────────────────────────────── */
  const [form, setForm] = useState<ProviderEntryFormInput>(() =>
    buildInitialForm(resource, mode),
  );
  const [showPasswords, setShowPasswords] = useState<Set<number>>(new Set());
  const [selectedProxyIds, setSelectedProxyIds] = useState<Record<number, number | undefined>>({});
  const [error, setError] = useState<string | null>(null);

  /* ── test model options (Select) ────────────────────────────────── */
  const testModelOptions = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    form.models.forEach((m) => {
      const name = (m.name ?? '').trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      names.push(name);
    });
    const firstName = names[0];
    const autoLabel = firstName
      ? t('providersPage.form.testModelAutoWith', 'Auto ({{name}})', { name: firstName })
      : t('providersPage.form.testModelAutoEmpty', 'Auto (no models)');
    const opts: Array<{ value: string; label: string }> = [{ value: '', label: autoLabel }];
    names.forEach((n) => opts.push({ value: n, label: n }));
    const tm = (form.testModel ?? '').trim();
    if (tm && !seen.has(tm)) {
      opts.push({
        value: tm,
        label: t('providersPage.form.testModelCustom', 'Custom: {{name}}', { name: tm }),
      });
    }
    return opts;
  }, [form.models, form.testModel, t]);

  /* ── field helpers ──────────────────────────────────────────────── */
  const updateField = <K extends keyof ProviderEntryFormInput>(
    key: K,
    value: ProviderEntryFormInput[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  /* ── validation ─────────────────────────────────────────────────── */
  const validate = (): string | null => {
    if (!form.name.trim()) {
      return t('providersPage.form.validation.nameRequired', 'Name is required');
    }
    if (!form.baseUrl.trim()) {
      return t('providersPage.form.validation.baseUrlRequired', 'Base URL is required');
    }
    if (mode === 'create' && !form.apiKeyEntries?.some((e) => e.apiKey.trim())) {
      return t('providersPage.form.validation.apiKeyRequired', 'At least one API key is required');
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    try {
      setError(null);
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /* ── derived lists ──────────────────────────────────────────────── */
  const apiKeyEntries = useMemo(
    () =>
      form.apiKeyEntries && form.apiKeyEntries.length
        ? form.apiKeyEntries
        : [emptyApiKeyEntry()],
    [form.apiKeyEntries],
  );
  const modelsList = useMemo(
    () => (form.models.length ? form.models : [emptyModel()]),
    [form.models],
  );
  const { presets: headerPresets } = useHeaderPresets();

  const headersList = useMemo(
    () => (form.headers.length ? form.headers : [emptyHeader()]),
    [form.headers],
  );

  /* ── password visibility (preserves existingApiKey reveal) ──────── */
  const togglePassword = (idx: number) => {
    setShowPasswords((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  /* ── API key entry helpers ──────────────────────────────────────── */
  const updateEntry = (idx: number, patch: Partial<ApiKeyEntryInput>) => {
    setForm((prev) => ({
      ...prev,
      apiKeyEntries: (prev.apiKeyEntries ?? []).map((entry, i) =>
        i === idx ? { ...entry, ...patch } : entry,
      ),
    }));
  };

  const removeEntry = (idx: number) => {
    setShowPasswords((prev) => {
      if (!prev.size) return prev;
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      return next;
    });
    setSelectedProxyIds((prev) => {
      if (!Object.keys(prev).length) return prev;
      const next: Record<number, number | undefined> = {};
      Object.entries(prev).forEach(([key, value]) => {
        const i = Number(key);
        if (Number.isNaN(i) || i === idx) return;
        next[i < idx ? i : i - 1] = value;
      });
      return next;
    });
    setForm((prev) => ({
      ...prev,
      apiKeyEntries: (prev.apiKeyEntries ?? []).filter((_, i) => i !== idx),
    }));
  };

  const addEntry = () => {
    setForm((prev) => ({
      ...prev,
      apiKeyEntries: [...(prev.apiKeyEntries ?? []), emptyApiKeyEntry()],
    }));
  };

  /* ── model helpers ──────────────────────────────────────────────── */
  const updateModel = (idx: number, patch: Partial<ModelEntryInput>) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    }));
  };

  const removeModel = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.length > 1 ? prev.models.filter((_, i) => i !== idx) : prev.models,
    }));
  };

  const addModel = () => {
    setForm((prev) => ({ ...prev, models: [...prev.models, emptyModel()] }));
  };


  /* ── build headers record for callbacks ─────────────────────────── */
  const buildHeadersRecord = (): Record<string, string> => {
    const hdrs: Record<string, string> = {};
    for (const h of form.headers) {
      const k = h.key.trim();
      const v = h.value.trim();
      if (k && v) hdrs[k] = v;
    }
    return hdrs;
  };

  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [hasFetchedModels, setHasFetchedModels] = useState(false);
  const prevFetchingModelsRef = useRef(false);

  const existingModelNames = useMemo(() => {
    const set = new Set<string>();
    form.models.forEach((m) => {
      const name = (m.name ?? '').trim();
      if (name) set.add(name);
    });
    return set;
  }, [form.models]);

  const requestModelDiscovery = () => {
    const entries = form.apiKeyEntries?.length ? form.apiKeyEntries : [];
    const withKey = entries.find((e) => (e.existingApiKey ?? e.apiKey)?.trim());
    const chosen = withKey ?? entries[0] ?? null;
    setDiscoveryOpen(true);
    setHasFetchedModels(false);
    onFetchModels?.({
      baseUrl: form.baseUrl,
      apiKey: (chosen?.existingApiKey ?? chosen?.apiKey) || '',
      headers: buildHeadersRecord(),
      authIndex: chosen?.authIndex || undefined,
    });
  };

  const applyDiscoveredModels = (incoming: ModelInfo[]) => {
    if (!incoming.length) return;
    setForm((prev) => {
      const seen = new Set<string>();
      const next: ModelEntryInput[] = [];
      prev.models.forEach((entry) => {
        const trimmed = (entry.name ?? '').trim();
        if (trimmed) {
          if (seen.has(trimmed)) return;
          seen.add(trimmed);
        }
        next.push(entry);
      });
      const placeholderIdx = next.findIndex(
        (it) => !(it.name ?? '').trim() && !(it.alias ?? '').trim()
      );
      if (placeholderIdx !== -1) {
        next.splice(placeholderIdx, 1);
      }
      incoming.forEach((info) => {
        const trimmed = info.name.trim();
        if (!trimmed || seen.has(trimmed)) return;
        seen.add(trimmed);
        next.push({
          name: trimmed,
          alias: (info.alias ?? '').trim(),
        });
      });
      return { ...prev, models: next };
    });
    setDiscoveryOpen(false);
  };

  const prevModelsRef = useRef<Array<{ name: string; alias?: string }> | undefined>(undefined);
  useEffect(() => {
    if (!fetchedModels || fetchedModels === prevModelsRef.current) return;
    prevModelsRef.current = fetchedModels;
    setDiscoveryOpen(true);
  }, [fetchedModels]);

  useEffect(() => {
    if (prevFetchingModelsRef.current && !fetchingModels) {
      setHasFetchedModels(true);
    }
    prevFetchingModelsRef.current = !!fetchingModels;
  }, [fetchingModels]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <form id={formId} className={styles.form} onSubmit={handleSubmit} noValidate>
      {error ? <div className={styles.errorBox}>{error}</div> : null}

      {/* ── Basic fields ─────────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fid}-name`}>
            {t('providersPage.form.name', 'Name')}
          </label>
          <input
            id={`${fid}-name`}
            className={styles.input}
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            disabled={mutating}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fid}-baseUrl`}>
            {t('providersPage.form.baseUrl', 'Base URL')}
            <span className={styles.labelHint}>
              {' '}
              · {t('providersPage.form.baseUrlRequiredHint', 'Required for this provider')}
            </span>
          </label>
          <input
            id={`${fid}-baseUrl`}
            className={styles.input}
            value={form.baseUrl}
            onChange={(e) => updateField('baseUrl', e.target.value)}
            placeholder="https://api.example.com"
            disabled={mutating}
          />
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-prefix`}>
              {t('providersPage.form.prefix', 'Prefix')}
            </label>
            <input
              id={`${fid}-prefix`}
              className={styles.input}
              value={form.prefix}
              onChange={(e) => updateField('prefix', e.target.value)}
              disabled={mutating}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-prio`}>
              {t('providersPage.form.priority', 'Priority')}
            </label>
            <input
              id={`${fid}-prio`}
              type="number"
              className={styles.input}
              value={form.priority ?? ''}
              onChange={(e) =>
                updateField('priority', e.target.value === '' ? undefined : Number(e.target.value))
              }
              disabled={mutating}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fid}-testModel`}>
            {t('providersPage.form.testModel', 'Test model')}
          </label>
          <Select
            id={`${fid}-testModel`}
            value={form.testModel ?? ''}
            options={testModelOptions}
            onChange={(value) => updateField('testModel', value)}
            disabled={mutating}
            ariaLabel={t('providersPage.form.testModel', 'Test model')}
          />
        </div>
      </div>

      {/* ── API Key entries (Collapsible, reversed) ──────────────── */}
      <Collapsible
        label={t('providersPage.form.apiKeyEntriesSection', 'API key entries')}
        hint={`${apiKeyEntries.filter((e) => e.apiKey.trim() || e.existingApiKey?.trim()).length}`}
        defaultOpen
      >
        <div className={styles.entriesList}>
          <div className={`${styles.entriesToolbar} ${styles.entriesToolbarSplit}`}>
            <button
              type="button"
              className={styles.addBtn}
              onClick={addEntry}
              disabled={mutating}
            >
              <IconPlus size={12} />{' '}
              {t('providersPage.form.addApiKeyEntry', 'Add key entry')}
            </button>
            {onTestAllApiKeys ? (
              <button
                type="button"
                className={styles.testAllBtn}
                disabled={mutating || testingAnyApiKey}
                onClick={() => {
                  onTestAllApiKeys({
                    baseUrl: form.baseUrl,
                    apiKeyEntries:
                      form.apiKeyEntries && form.apiKeyEntries.length
                        ? form.apiKeyEntries
                        : [emptyApiKeyEntry()],
                    headers: buildHeadersRecord(),
                  });
                }}
              >
                {testingAnyApiKey ? <IconLoader2 size={12} /> : null}
                <span>{t('providersPage.form.testAllApiKeys', 'Test all')}</span>
              </button>
            ) : null}
          </div>

          {[...apiKeyEntries].reverse().map((entry, visualIdx) => {
            const realIdx = apiKeyEntries.length - 1 - visualIdx;
            const status = apiKeyTestStatus?.[realIdx] ?? { state: 'idle' as const };
            const isTesting = status.state === 'loading';
            const isSuccess = status.state === 'success';
            const isError = status.state === 'error';
            return (
              <div key={realIdx} className={styles.entryCard}>
                <div className={styles.entryCardHeader}>
                  <span>
                    {t('providersPage.form.apiKeyEntry', 'Key #{{index}}', {
                      index: realIdx + 1,
                    })}
                  </span>
                  <div
                    className={styles.entryCardHeaderRight}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {renderEntryCardExtra?.(realIdx, entry)}

                    {onTestApiKey ? (
                      <button
                        type="button"
                        className={styles.testEntryBtn}
                        disabled={mutating || isTesting}
                        onClick={() => {
                          const entryKey = (entry.existingApiKey ?? entry.apiKey) || '';
                          onTestApiKey(realIdx, {
                            baseUrl: form.baseUrl,
                            apiKey: entryKey,
                            headers: buildHeadersRecord(),
                            authIndex: entry.authIndex || undefined,
                          });
                        }}
                        title={t('providersPage.form.testApiKey', 'Test this API key')}
                      >
                        {isTesting ? <IconLoader2 size={12} /> : null}
                        <span>{t('providersPage.form.testApiKey', 'Test')}</span>
                      </button>
                    ) : null}

                    {isSuccess ? (
                      <span
                        className={styles.testStatusSuccess}
                        title={
                          status.message ??
                          t('providersPage.form.apiKeyTestSuccess', 'Test successful')
                        }
                      >
                        <IconCheckCircle2 size={12} />
                        <span>{status.statusCode ?? 'OK'}</span>
                      </span>
                    ) : null}
                    {isError ? (
                      <span
                        className={styles.testStatusError}
                        title={
                          status.message ??
                          t('providersPage.form.apiKeyTestFailed', 'Test failed')
                        }
                      >
                        <IconX size={12} />
                        <span>{status.statusCode ?? 'ERR'}</span>
                      </span>
                    ) : null}

                    <button
                      type="button"
                      className={styles.removeBtn}
                      disabled={mutating || apiKeyEntries.length <= 1}
                      onClick={() => removeEntry(realIdx)}
                      aria-label={`Remove key #${realIdx + 1}`}
                    >
                      <IconTrash2 size={12} />
                    </button>
                  </div>
                </div>

                <div className={styles.passwordField}>
                      <input
                        className={styles.passwordInput}
                        type={showPasswords.has(realIdx) ? 'text' : 'password'}
                        value={
                          showPasswords.has(realIdx) && !entry.apiKey && entry.existingApiKey
                            ? entry.existingApiKey
                            : entry.apiKey
                        }
                        onChange={(e) => updateEntry(realIdx, { apiKey: e.target.value })}
                        placeholder={
                          entry.existingApiKey
                            ? t('providersPage.form.apiKeyEditPlaceholder', 'Leave empty to keep unchanged')
                            : t('providersPage.form.apiKeyCreatePlaceholder', 'Enter API key')
                        }
                        autoComplete="new-password"
                        data-1p-ignore="true"
                        data-lpignore="true"
                        data-bwignore="true"
                        disabled={mutating}
                      />
                      <button
                        type="button"
                        className={styles.passwordToggle}
                        onClick={() => togglePassword(realIdx)}
                        disabled={mutating}
                        aria-label={
                          showPasswords.has(realIdx)
                            ? t('providersPage.form.hideApiKey', 'Hide API key')
                            : t('providersPage.form.showApiKey', 'Show API key')
                        }
                        title={
                          showPasswords.has(realIdx)
                            ? t('providersPage.form.hideApiKey', 'Hide API key')
                            : t('providersPage.form.showApiKey', 'Show API key')
                        }
                      >
                        {showPasswords.has(realIdx) ? (
                          <IconEyeOff size={16} />
                        ) : (
                          <IconEye size={16} />
                        )}
                      </button>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>
                        {t('serviceProviders.table.proxyUrl', 'Proxy URL')}
                      </label>
                      {proxyServiceBaseUrl ? (
                        <>
                          <ProxyCombobox
                            baseUrl={proxyServiceBaseUrl}
                            managementKey={proxyManagementKey}
                            value={entry.proxyUrl}
                            selectedProxyId={selectedProxyIds[realIdx]}
                            onInputChange={(value) => {
                              setSelectedProxyIds((prev) => {
                                if (prev[realIdx] === undefined) return prev;
                                const next = { ...prev };
                                delete next[realIdx];
                                return next;
                              });
                              updateEntry(realIdx, { proxyUrl: value });
                            }}
                            onSelect={(proxy) => {
                              setSelectedProxyIds((prev) => ({ ...prev, [realIdx]: proxy.id }));
                              updateEntry(realIdx, { proxyUrl: proxy.proxy_value });
                            }}
                            placeholder={t(
                              'charitable.probe.proxySearchPlaceholder',
                              'Enter a proxy URI or search saved proxies',
                            )}
                            ariaLabel={t(
                              'charitable.probe.proxySearchLabel',
                              'Proxy URI or saved proxy search',
                            )}
                            noResultsLabel={t(
                              'charitable.probe.proxyNoResults',
                              'No matching saved proxies. The entered URI will be used.',
                            )}
                            loadingLabel={t(
                              'charitable.probe.proxySearching',
                              'Searching proxies...',
                            )}
                            disabled={mutating}
                          />
                          <span className={styles.fieldHint}>
                            {selectedProxyIds[realIdx]
                              ? t('charitable.probe.proxySelected', {
                                  id: selectedProxyIds[realIdx],
                                  defaultValue:
                                    'Using saved proxy #{{id}}. Editing the URI switches to custom input.',
                                })
                              : t(
                                  'charitable.probe.proxyCustomHint',
                                  'No saved proxy selected. The entered URI will be used directly.',
                                )}
                          </span>
                        </>
                      ) : (
                        <input
                          className={styles.input}
                          value={entry.proxyUrl}
                          onChange={(e) => updateEntry(realIdx, { proxyUrl: e.target.value })}
                          placeholder="http://127.0.0.1:7890"
                          disabled={mutating}
                        />
                      )}
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>Auth Index</label>
                      <input
                        className={styles.input}
                        value={entry.authIndex ?? ''}
                        onChange={(e) =>
                          updateEntry(realIdx, { authIndex: e.target.value || undefined })
                        }
                        disabled={mutating}
                      />
                    </div>
              </div>
            );
          })}
        </div>
      </Collapsible>

      {/* ── Models (Collapsible) ─────────────────────────────────── */}
      <Collapsible
        label={t('providersPage.form.modelsSection', 'Custom models')}
        hint={`${modelsList.filter((m) => m.name.trim()).length}`}
      >
        <div className={styles.entriesList}>
          <div className={styles.entriesToolbar}>
            <button
              type="button"
              className={styles.fetchModelsBtn}
              disabled={mutating || fetchingModels}
              onClick={requestModelDiscovery}
              title={t('providersPage.form.fetchModels', 'Fetch models from provider')}
            >
              {fetchingModels ? <IconLoader2 size={12} /> : <IconDownload size={12} />}
              {t('providersPage.form.fetchModels', 'Fetch models')}
            </button>
          </div>

          {discoveryOpen ? (
            <ModelDiscoveryPanel
              loading={!!fetchingModels}
              models={fetchedModels ?? []}
              hasFetched={hasFetchedModels}
              existingNames={existingModelNames}
              mutating={mutating}
              onApply={applyDiscoveredModels}
              onReload={requestModelDiscovery}
              onClose={() => setDiscoveryOpen(false)}
            />
          ) : null}

          {modelsList.map((model, idx) => (
            <div key={idx} className={styles.entryCard}>
              <div className={styles.entryCardHeader}>
                <span>
                  {t('providersPage.form.modelEntry', 'Model #{{index}}', { index: idx + 1 })}
                </span>
                <button
                  type="button"
                  className={styles.removeBtn}
                  disabled={mutating || modelsList.length <= 1}
                  onClick={() => removeModel(idx)}
                  aria-label={`Remove model #${idx + 1}`}
                >
                  <IconX size={12} />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input
                  className={styles.input}
                  placeholder="model-name"
                  value={model.name}
                  onChange={(e) => updateModel(idx, { name: e.target.value })}
                  disabled={mutating}
                />
                <input
                  className={styles.input}
                  placeholder="alias (optional)"
                  value={model.alias ?? ''}
                  onChange={(e) => updateModel(idx, { alias: e.target.value })}
                  disabled={mutating}
                />
              </div>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  className={styles.checkboxBox}
                  checked={model.image === true}
                  disabled={mutating}
                  onChange={(e) => updateModel(idx, { image: e.target.checked })}
                />
                <span className={styles.checkboxText}>
                  <span>{t('providersPage.form.modelImage', 'Vision (image input)')}</span>
                  <small>
                    {t('providersPage.form.modelImageHint', 'This model supports image input')}
                  </small>
                </span>
              </label>
              <div className={styles.field}>
                <label className={styles.label}>
                  {t('providersPage.form.thinkingConfig', 'Thinking config')}
                  <span className={styles.labelHint}>
                    {' '}
                    · {t('providersPage.form.thinkingConfigHint', 'Optional JSON')}
                  </span>
                </label>
                <textarea
                  className={styles.textarea}
                  rows={4}
                  value={model.thinkingJson ?? ''}
                  onChange={(e) => updateModel(idx, { thinkingJson: e.target.value })}
                  disabled={mutating}
                  placeholder={'{"levels":["low","medium","high"]}'}
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            className={styles.addBtn}
            onClick={addModel}
            disabled={mutating}
          >
            <IconPlus size={12} /> {t('providersPage.form.addModel', 'Add model')}
          </button>
        </div>
      </Collapsible>

      {/* ── Headers (Collapsible) ────────────────────────────────── */}
      <Collapsible
        label={t('providersPage.form.headersSection', 'Request headers')}
        hint={`${headersList.filter((h) => h.key.trim()).length}`}
      >
        <HeadersEditor
          entries={headersList}
          onChange={(next: HeaderEntry[]) => setForm((prev) => ({ ...prev, headers: next }))}
          disabled={mutating}
          presets={headerPresets}
        />
      </Collapsible>

      {/* ── Disabled / DisableCooling checkboxes ─────────────────── */}
      <div className={styles.section}>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            className={styles.checkboxBox}
            checked={form.disabled}
            disabled={mutating}
            onChange={(e) => updateField('disabled', e.target.checked)}
          />
          <span className={styles.checkboxText}>
            <span>{t('providersPage.form.disabled', 'Disable this entry')}</span>
            <small>
              {t(
                'providersPage.form.disabledHint',
                'Disabled entries will not be used by the gateway',
              )}
            </small>
          </span>
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            className={styles.checkboxBox}
            checked={form.disableCooling ?? false}
            disabled={mutating}
            onChange={(e) => updateField('disableCooling', e.target.checked)}
          />
          <span className={styles.checkboxText}>
            <span>{t('providersPage.form.disableCooling', 'Disable cooling')}</span>
            <small>
              {t(
                'providersPage.form.disableCoolingHint',
                'Prevent this entry from entering cooldown after errors',
              )}
            </small>
          </span>
        </label>
      </div>
    </form>
  );
}
