import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SearchableSelect } from '@/external/components/ui/SearchableSelect';
import {
  IconDollarSign,
  IconDownload,
  IconPlus,
  IconRefreshCw,
  IconSearch,
  IconTrash2,
  IconX,
} from '@/components/ui/icons';
import { useUsageData } from '@/external/features/monitoring/hooks/useUsageData';
import { usageServiceApi, type UsageEventItem } from '@/external/services/api/usageService';
import {
  calculateCost,
  formatCompactNumber,
  formatDurationMs,
  formatUsd,
  type ModelPrice,
  type ModelPriceMapping,
} from '@/external/utils/usage';
import { useAuthStore, useNotificationStore } from '@/stores';
import styles from './ModelPricePage.module.scss';

type PriceMode = 'fixed' | 'composite';

type MappingDraft = {
  model: string;
  coefficient: string;
};

type PriceDraft = {
  model: string;
  mode: PriceMode;
  prompt: string;
  completion: string;
  cache: string;
  mappings: MappingDraft[];
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const emptyDraft = (): PriceDraft => ({
  model: '',
  mode: 'fixed',
  prompt: '',
  completion: '',
  cache: '',
  mappings: [{ model: '', coefficient: '1' }],
});

const priceToDraft = (model: string, price: ModelPrice): PriceDraft => ({
  model,
  mode: price.mode === 'composite' ? 'composite' : 'fixed',
  prompt: String(price.prompt),
  completion: String(price.completion),
  cache: String(price.cache),
  mappings:
    price.mappings && price.mappings.length > 0
      ? price.mappings.map((mapping) => ({
          model: mapping.model,
          coefficient: String(mapping.coefficient),
        }))
      : [{ model: '', coefficient: '1' }],
});

const parseNonNegative = (value: string): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const formatRate = (value: number) => `$${value.toFixed(4)}`;

const readEvents = (items: unknown[] | undefined): UsageEventItem[] =>
  (items ?? []).filter(
    (item): item is UsageEventItem =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as UsageEventItem).event_hash === 'string'
  );

export function ModelPricePage() {
  const { t, i18n } = useTranslation();
  const managementKey = useAuthStore((state) => state.managementKey);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [selectedModel, setSelectedModel] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [draft, setDraft] = useState<PriceDraft>(() => emptyDraft());
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [priceSearch, setPriceSearch] = useState('');
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [pricePage, setPricePage] = useState(1);
  const [pricePageSize, setPricePageSize] = useState(20);

  const usageQuery = useMemo(
    () => (selectedModel ? { model: selectedModel } : undefined),
    [selectedModel]
  );
  const pageQueries = useMemo(() => ({ realtime: { page, pageSize } }), [page, pageSize]);
  const {
    usagePages,
    loading,
    error,
    modelPrices,
    usageServiceAvailable,
    resolvedUsageServiceBase,
    loadModelPrices,
    loadUsage,
    syncModelPrices,
  } = useUsageData(usageQuery, pageQueries, { includeSummary: false });

  const priceEntries = useMemo(
    () => Object.entries(modelPrices).sort(([left], [right]) => left.localeCompare(right)),
    [modelPrices]
  );
  const requestModelOptions = useMemo(
    () => priceEntries.map(([model]) => ({ value: model, label: model })),
    [priceEntries]
  );
  const fixedModelOptions = useMemo(
    () =>
      priceEntries
        .filter(([model, price]) => model !== editingModel && price.mode !== 'composite')
        .map(([model]) => ({ value: model, label: model })),
    [editingModel, priceEntries]
  );
  const compositeCount = useMemo(
    () => priceEntries.filter(([, price]) => price.mode === 'composite').length,
    [priceEntries]
  );

  const filteredPriceEntries = useMemo(() => {
    const trimmed = priceSearch.trim().toLowerCase();
    if (!trimmed) return priceEntries;
    return priceEntries.filter(([model]) => model.toLowerCase().includes(trimmed));
  }, [priceEntries, priceSearch]);

  const priceTotalPages = Math.max(1, Math.ceil(filteredPriceEntries.length / pricePageSize));
  const effectivePricePage = Math.min(pricePage, priceTotalPages);
  const pagedPriceEntries = useMemo(
    () =>
      filteredPriceEntries.slice(
        (effectivePricePage - 1) * pricePageSize,
        effectivePricePage * pricePageSize
      ),
    [filteredPriceEntries, effectivePricePage, pricePageSize]
  );

  const pageModelSet = useMemo(
    () => new Set(pagedPriceEntries.map(([model]) => model)),
    [pagedPriceEntries]
  );
  const allPageSelected =
    pageModelSet.size > 0 && [...pageModelSet].every((m) => selectedModels.has(m));
  const somePageSelected =
    !allPageSelected && [...pageModelSet].some((m) => selectedModels.has(m));

  useEffect(() => {
    if (selectedModel && modelPrices[selectedModel]) return;
    setSelectedModel(priceEntries[0]?.[0] ?? '');
    setPage(1);
  }, [modelPrices, priceEntries, selectedModel]);

  useEffect(() => {
    setPricePage(1);
  }, [priceSearch]);

  const preview = useMemo<ModelPrice | null>(() => {
    if (draft.mode === 'fixed') {
      const prompt = parseNonNegative(draft.prompt);
      const completion = parseNonNegative(draft.completion);
      const cache = parseNonNegative(draft.cache);
      if (prompt === null || completion === null || cache === null) return null;
      return { prompt, completion, cache, mode: 'fixed' };
    }

    let prompt = 0;
    let completion = 0;
    let cache = 0;
    for (const mapping of draft.mappings) {
      const coefficient = Number(mapping.coefficient);
      const source = modelPrices[mapping.model];
      if (
        !source ||
        source.mode === 'composite' ||
        !Number.isFinite(coefficient) ||
        coefficient <= 0
      ) {
        return null;
      }
      prompt += source.prompt * coefficient;
      completion += source.completion * coefficient;
      cache += source.cache * coefficient;
    }
    return { prompt, completion, cache, mode: 'composite' };
  }, [draft, modelPrices]);

  const coefficientTotal = useMemo(
    () =>
      draft.mappings.reduce((total, mapping) => {
        const coefficient = Number(mapping.coefficient);
        return total + (Number.isFinite(coefficient) ? coefficient : 0);
      }, 0),
    [draft.mappings]
  );

  const events = useMemo(
    () => readEvents(usagePages?.realtime?.items),
    [usagePages?.realtime?.items]
  );
  const totalItems = Math.max(0, usagePages?.realtime?.total_items ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const openCreate = useCallback(() => {
    setEditingModel(null);
    setDraft(emptyDraft());
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((model: string, price: ModelPrice) => {
    setEditingModel(model);
    setDraft(priceToDraft(model, price));
    setEditorOpen(true);
  }, []);

  const updateMapping = useCallback((index: number, field: keyof MappingDraft, value: string) => {
    setDraft((previous) => ({
      ...previous,
      mappings: previous.mappings.map((mapping, mappingIndex) =>
        mappingIndex === index ? { ...mapping, [field]: value } : mapping
      ),
    }));
  }, []);

  const addMapping = useCallback(() => {
    setDraft((previous) => ({
      ...previous,
      mappings: [...previous.mappings, { model: '', coefficient: '1' }],
    }));
  }, []);

  const removeMapping = useCallback((index: number) => {
    setDraft((previous) => ({
      ...previous,
      mappings: previous.mappings.filter((_, mappingIndex) => mappingIndex !== index),
    }));
  }, []);

  const savePrices = useCallback(
    async (prices: Record<string, ModelPrice>) => {
      if (!usageServiceAvailable || !resolvedUsageServiceBase) {
        throw new Error(t('model_price.service_unavailable'));
      }
      await usageServiceApi.saveModelPrices(resolvedUsageServiceBase, prices, managementKey);
      await loadModelPrices();
    },
    [loadModelPrices, managementKey, resolvedUsageServiceBase, t, usageServiceAvailable]
  );

  const handleSave = useCallback(async () => {
    const model = draft.model.trim();
    if (!model) {
      showNotification(t('model_price.validation_model'), 'warning');
      return;
    }
    if (!editingModel && modelPrices[model]) {
      showNotification(t('model_price.validation_duplicate'), 'warning');
      return;
    }
    if (!preview) {
      showNotification(t('model_price.validation_price'), 'warning');
      return;
    }

    let mappings: ModelPriceMapping[] | undefined;
    if (draft.mode === 'composite') {
      if (draft.mappings.length === 0) {
        showNotification(t('model_price.validation_mapping'), 'warning');
        return;
      }
      const names = draft.mappings.map((mapping) => mapping.model);
      if (new Set(names).size !== names.length) {
        showNotification(t('model_price.validation_mapping_duplicate'), 'warning');
        return;
      }
      mappings = draft.mappings.map((mapping) => ({
        model: mapping.model,
        coefficient: Number(mapping.coefficient),
      }));
    }

    const nextPrices = { ...modelPrices };
    if (editingModel && editingModel !== model) delete nextPrices[editingModel];
    nextPrices[model] = {
      ...preview,
      mode: draft.mode,
      mappings,
      source: draft.mode === 'composite' ? 'composite' : undefined,
    };

    setSaving(true);
    try {
      await savePrices(nextPrices);
      setSelectedModel(model);
      setPage(1);
      setEditorOpen(false);
      showNotification(t('model_price.saved'), 'success');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      showNotification(`${t('model_price.save_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, editingModel, modelPrices, preview, savePrices, showNotification, t]);

  const handleDelete = useCallback(
    (model: string) => {
      showConfirmation({
        title: t('model_price.delete_title'),
        message: t('model_price.delete_message', { model }),
        confirmText: t('common.confirm'),
        variant: 'danger',
        onConfirm: async () => {
          const nextPrices = { ...modelPrices };
          delete nextPrices[model];
          try {
            await savePrices(nextPrices);
            showNotification(t('model_price.deleted'), 'success');
          } catch (deleteError) {
            const message =
              deleteError instanceof Error ? deleteError.message : String(deleteError);
            showNotification(`${t('model_price.delete_failed')}: ${message}`, 'error');
          }
        },
      });
    },
    [modelPrices, savePrices, showConfirmation, showNotification, t]
  );

  const toggleModelSelection = useCallback((model: string) => {
    setSelectedModels((previous) => {
      const next = new Set(previous);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  }, []);

  const toggleSelectPage = useCallback(() => {
    setSelectedModels((previous) => {
      if (allPageSelected) {
        const next = new Set(previous);
        for (const m of pageModelSet) next.delete(m);
        return next;
      }
      const next = new Set(previous);
      for (const m of pageModelSet) next.add(m);
      return next;
    });
  }, [allPageSelected, pageModelSet]);

  const handleBatchDelete = useCallback(() => {
    const models = [...selectedModels];
    if (models.length === 0) return;
    showConfirmation({
      title: t('model_price.batch_delete_title'),
      message: t('model_price.batch_delete_message', { count: models.length }),
      confirmText: t('common.confirm'),
      variant: 'danger',
      onConfirm: async () => {
        const nextPrices = { ...modelPrices };
        for (const model of models) delete nextPrices[model];
        try {
          await savePrices(nextPrices);
          setSelectedModels(new Set());
          showNotification(t('model_price.batch_deleted'), 'success');
        } catch (deleteError) {
          const message =
            deleteError instanceof Error ? deleteError.message : String(deleteError);
          showNotification(`${t('model_price.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  }, [modelPrices, savePrices, selectedModels, showConfirmation, showNotification, t]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await syncModelPrices();
      const unmatchedCount = result.unmatched?.length ?? 0;
      const baseMessage = t('usage_stats.model_price_sync_success', {
        count: result.imported,
        source: result.source || 'LiteLLM',
      });
      if (unmatchedCount > 0) {
        showNotification(
          `${baseMessage}${t('usage_stats.model_price_sync_unmatched_suffix', { count: unmatchedCount })}`,
          'warning'
        );
      } else {
        showNotification(baseMessage, 'success');
      }
    } catch (syncError: unknown) {
      const rawMessage = syncError instanceof Error ? syncError.message : String(syncError || t('common.unknown_error'));
      const message =
        rawMessage === 'model_price_sync_requires_usage_service'
          ? t('usage_stats.model_price_sync_requires_usage_service')
          : rawMessage;
      showNotification(`${t('usage_stats.model_price_sync_failed')}: ${message}`, 'error');
    } finally {
      setSyncing(false);
    }
  }, [showNotification, syncModelPrices, t]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadModelPrices(), loadUsage()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadModelPrices, loadUsage]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t('model_price.title')}</h1>
          <p>{t('model_price.description')}</p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleSync()}
            loading={syncing}
          >
            <IconDownload size={16} />
            {t('usage_stats.model_price_sync')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleRefresh()}
            loading={refreshing}
          >
            <IconRefreshCw size={16} />
            {t('common.refresh')}
          </Button>
          <Button size="sm" onClick={openCreate}>
            <IconPlus size={16} />
            {t('model_price.add')}
          </Button>
        </div>
      </header>

      <div className={styles.summaryBar}>
        <div>
          <span>{t('model_price.total_models')}</span>
          <strong>{priceEntries.length}</strong>
        </div>
        <div>
          <span>{t('model_price.fixed_models')}</span>
          <strong>{priceEntries.length - compositeCount}</strong>
        </div>
        <div>
          <span>{t('model_price.composite_models')}</span>
          <strong>{compositeCount}</strong>
        </div>
        <div>
          <span>{t('model_price.unit')}</span>
          <strong>USD / 1M</strong>
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>{t('model_price.price_list')}</h2>
            <p>{t('model_price.price_list_hint')}</p>
          </div>
          <div className={styles.sectionHeaderActions}>
            <div className={styles.searchBox}>
              <span className={styles.searchIcon} aria-hidden="true">
                <IconSearch size={15} />
              </span>
              <input
                type="text"
                className={styles.searchInput}
                value={priceSearch}
                onChange={(event) => setPriceSearch(event.target.value)}
                placeholder={t('model_price.search_placeholder')}
                aria-label={t('model_price.search_placeholder')}
              />
              {priceSearch ? (
                <button
                  type="button"
                  className={styles.searchClear}
                  onClick={() => setPriceSearch('')}
                  aria-label={t('common.clear')}
                >
                  <IconX size={14} />
                </button>
              ) : null}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleBatchDelete()}
              disabled={selectedModels.size === 0}
            >
              <IconTrash2 size={16} />
              {t('model_price.batch_delete')}
              {selectedModels.size > 0 ? ` (${selectedModels.size})` : ''}
            </Button>
          </div>
        </div>
        {loading && priceEntries.length === 0 ? (
          <div className={styles.loadingState}>
            <LoadingSpinner size={24} />
          </div>
        ) : priceEntries.length === 0 ? (
          <div className={styles.emptyState}>{t('model_price.empty')}</div>
        ) : filteredPriceEntries.length === 0 ? (
          <div className={styles.emptyState}>{t('model_price.no_search_results')}</div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.selectableTable}`}>
                <thead>
                  <tr>
                    <th className={styles.checkCell}>
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = somePageSelected;
                        }}
                        onChange={toggleSelectPage}
                        aria-label={t('model_price.select_all_page')}
                      />
                    </th>
                    <th>{t('model_price.model')}</th>
                    <th>{t('model_price.mode')}</th>
                    <th>{t('model_price.prompt')}</th>
                    <th>{t('model_price.completion')}</th>
                    <th>{t('model_price.cache')}</th>
                    <th>{t('model_price.definition')}</th>
                    <th aria-label={t('common.actions')} />
                  </tr>
                </thead>
                <tbody>
                  {pagedPriceEntries.map(([model, price]) => {
                    const active = model === selectedModel;
                    const checked = selectedModels.has(model);
                    return (
                      <tr
                        key={model}
                        className={active ? styles.activeRow : undefined}
                        onClick={() => {
                          setSelectedModel(model);
                          setPage(1);
                        }}
                      >
                        <td className={styles.checkCell} onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleModelSelection(model)}
                            aria-label={t('model_price.select_model_row', { model })}
                          />
                        </td>
                        <td>
                          <span className={styles.modelName}>{model}</span>
                        </td>
                        <td>
                          <span
                            className={
                              price.mode === 'composite'
                                ? styles.compositeBadge
                                : styles.fixedBadge
                            }
                          >
                            {t(
                              price.mode === 'composite'
                                ? 'model_price.composite'
                                : 'model_price.fixed'
                            )}
                          </span>
                        </td>
                        <td>{formatRate(price.prompt)}</td>
                        <td>{formatRate(price.completion)}</td>
                        <td>{formatRate(price.cache)}</td>
                        <td className={styles.definitionCell}>
                          {price.mode === 'composite'
                            ? price.mappings
                                ?.map((mapping) => `${mapping.model} × ${mapping.coefficient}`)
                                .join(' + ')
                            : price.sourceModelId || price.source || t('model_price.manual')}
                        </td>
                        <td>
                          <div className={styles.rowActions}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEdit(model, price);
                              }}
                            >
                              {t('common.edit')}
                            </Button>
                            <button
                              type="button"
                              className={styles.iconButton}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDelete(model);
                              }}
                              title={t('common.delete')}
                              aria-label={t('common.delete')}
                            >
                              <IconTrash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredPriceEntries.length > pricePageSize ? (
              <div className={styles.pagination}>
                <span>
                  {t('model_price.page_info', {
                    page: effectivePricePage,
                    totalPages: priceTotalPages,
                    total: filteredPriceEntries.length,
                  })}
                </span>
                <Select
                  value={String(pricePageSize)}
                  options={PAGE_SIZE_OPTIONS.map((size) => ({
                    value: String(size),
                    label: t('model_price.page_size', { size }),
                  }))}
                  onChange={(value) => {
                    setPricePageSize(Number(value));
                    setPricePage(1);
                  }}
                  ariaLabel={t('model_price.page_size_label')}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={effectivePricePage <= 1}
                  onClick={() => setPricePage((current) => Math.max(1, current - 1))}
                >
                  {t('common.previous')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={effectivePricePage >= priceTotalPages}
                  onClick={() => setPricePage((current) => Math.min(priceTotalPages, current + 1))}
                >
                  {t('common.next')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>{t('model_price.request_details')}</h2>
            <p>
              {selectedModel
                ? t('model_price.request_details_for', { model: selectedModel })
                : t('model_price.select_model')}
            </p>
          </div>
          <div className={styles.requestDetailsControls}>
            <div className={styles.requestModelSelect}>
              <SearchableSelect
                value={selectedModel}
                options={requestModelOptions}
                onChange={(model) => {
                  setSelectedModel(model);
                  setPage(1);
                }}
                placeholder={t('model_price.select_model')}
                searchPlaceholder={t('model_price.search_model')}
                ariaLabel={t('model_price.select_model')}
                disabled={requestModelOptions.length === 0}
                size="sm"
              />
            </div>
            {selectedModel ? (
              <span className={styles.resultCount}>
                {t('model_price.request_count', { count: totalItems })}
              </span>
            ) : null}
          </div>
        </div>
        {error ? <div className={styles.errorState}>{error}</div> : null}
        {loading && selectedModel ? (
          <div className={styles.loadingState}>
            <LoadingSpinner size={24} />
          </div>
        ) : !selectedModel || events.length === 0 ? (
          <div className={styles.emptyState}>
            {t(selectedModel ? 'model_price.no_requests' : 'model_price.select_model')}
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('model_price.time')}</th>
                  <th>{t('model_price.request_id')}</th>
                  <th>{t('model_price.resolved_model')}</th>
                  <th>{t('model_price.endpoint')}</th>
                  <th>{t('model_price.account')}</th>
                  <th>{t('model_price.tokens')}</th>
                  <th>{t('model_price.cost')}</th>
                  <th>{t('model_price.latency')}</th>
                  <th>{t('model_price.status')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => {
                  const cost = calculateCost(
                    {
                      tokens: {
                        input_tokens: event.input_tokens,
                        output_tokens: event.output_tokens,
                        cached_tokens: event.cached_tokens,
                        cache_tokens: event.cache_tokens,
                      },
                      __modelName: event.model,
                      __resolvedModel: event.resolved_model,
                    },
                    modelPrices
                  );
                  return (
                    <tr key={event.event_hash}>
                      <td>{new Date(event.timestamp_ms).toLocaleString(i18n.language)}</td>
                      <td>
                        <span className={styles.mono}>
                          {event.request_id || event.event_hash.slice(0, 12)}
                        </span>
                      </td>
                      <td>
                        <span className={styles.mono}>{event.resolved_model || event.model}</span>
                      </td>
                      <td>
                        <span className={styles.mono}>
                          {event.endpoint ||
                            `${event.method ?? ''} ${event.path ?? ''}`.trim() ||
                            '-'}
                        </span>
                      </td>
                      <td>
                        {event.account_snapshot ||
                          event.auth_label_snapshot ||
                          event.source ||
                          event.auth_index ||
                          '-'}
                      </td>
                      <td>{formatCompactNumber(event.total_tokens)}</td>
                      <td>{formatUsd(cost) || '--'}</td>
                      <td>
                        {formatDurationMs(event.latency_ms ?? null, { locale: i18n.language })}
                      </td>
                      <td>
                        <span className={event.failed ? styles.failedStatus : styles.successStatus}>
                          {event.status_code ||
                            (event.failed ? t('model_price.failed') : t('model_price.success'))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {selectedModel && totalItems > 0 ? (
          <div className={styles.pagination}>
            <span>{t('model_price.page_info', { page, totalPages, total: totalItems })}</span>
            <Select
              value={String(pageSize)}
              options={PAGE_SIZE_OPTIONS.map((size) => ({
                value: String(size),
                label: t('model_price.page_size', { size }),
              }))}
              onChange={(value) => {
                setPageSize(Number(value));
                setPage(1);
              }}
              ariaLabel={t('model_price.page_size_label')}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {t('common.previous')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              {t('common.next')}
            </Button>
          </div>
        ) : null}
      </section>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={t(editingModel ? 'model_price.edit_title' : 'model_price.add_title')}
        width={760}
      >
        <div className={styles.editor}>
          <Input
            label={t('model_price.model')}
            value={draft.model}
            onChange={(event) =>
              setDraft((previous) => ({ ...previous, model: event.target.value }))
            }
            placeholder={t('model_price.model_placeholder')}
            readOnly={Boolean(editingModel)}
          />
          <div className={styles.modeField}>
            <span>{t('model_price.mode')}</span>
            <div className={styles.segmented}>
              {(['fixed', 'composite'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={draft.mode === mode ? styles.segmentActive : undefined}
                  onClick={() => setDraft((previous) => ({ ...previous, mode }))}
                >
                  {t(`model_price.${mode}`)}
                </button>
              ))}
            </div>
          </div>

          {draft.mode === 'fixed' ? (
            <div className={styles.priceFields}>
              <Input
                label={`${t('model_price.prompt')} (USD / 1M)`}
                type="number"
                min="0"
                step="0.0001"
                value={draft.prompt}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, prompt: event.target.value }))
                }
              />
              <Input
                label={`${t('model_price.completion')} (USD / 1M)`}
                type="number"
                min="0"
                step="0.0001"
                value={draft.completion}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, completion: event.target.value }))
                }
              />
              <Input
                label={`${t('model_price.cache')} (USD / 1M)`}
                type="number"
                min="0"
                step="0.0001"
                value={draft.cache}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, cache: event.target.value }))
                }
              />
            </div>
          ) : (
            <div className={styles.mappingEditor}>
              <div className={styles.mappingHeader}>
                <div>
                  <strong>{t('model_price.mapping_title')}</strong>
                  <p>{t('model_price.mapping_hint')}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={addMapping}
                  disabled={fixedModelOptions.length === 0}
                >
                  <IconPlus size={16} />
                  {t('model_price.add_mapping')}
                </Button>
              </div>
              {draft.mappings.map((mapping, index) => (
                <div className={styles.mappingRow} key={index}>
                  <SearchableSelect
                    value={mapping.model}
                    options={[
                      { value: '', label: t('model_price.select_source') },
                      ...fixedModelOptions,
                    ]}
                    onChange={(value) => updateMapping(index, 'model', value)}
                    ariaLabel={t('model_price.source_model')}
                    searchPlaceholder={t('model_price.search_model', '搜索模型')}
                    fullWidth
                  />
                  <span aria-hidden="true">×</span>
                  <Input
                    type="number"
                    min="0.000001"
                    step="0.1"
                    value={mapping.coefficient}
                    onChange={(event) => updateMapping(index, 'coefficient', event.target.value)}
                    aria-label={t('model_price.coefficient')}
                  />
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => removeMapping(index)}
                    disabled={draft.mappings.length <= 1}
                    title={t('model_price.remove_mapping')}
                    aria-label={t('model_price.remove_mapping')}
                  >
                    <IconTrash2 size={16} />
                  </button>
                </div>
              ))}
              <div className={styles.coefficientTotal}>
                {t('model_price.coefficient_total')}: <strong>{coefficientTotal.toFixed(4)}</strong>
              </div>
            </div>
          )}

          <div className={styles.preview}>
            <div className={styles.previewTitle}>
              <IconDollarSign size={17} />
              {t('model_price.preview')}
            </div>
            <div>
              <span>{t('model_price.prompt')}</span>
              <strong>{preview ? formatRate(preview.prompt) : '--'}</strong>
            </div>
            <div>
              <span>{t('model_price.completion')}</span>
              <strong>{preview ? formatRate(preview.completion) : '--'}</strong>
            </div>
            <div>
              <span>{t('model_price.cache')}</span>
              <strong>{preview ? formatRate(preview.cache) : '--'}</strong>
            </div>
          </div>

          <div className={styles.editorActions}>
            <Button variant="secondary" onClick={() => setEditorOpen(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handleSave()} loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
