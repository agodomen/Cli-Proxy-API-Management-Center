import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { IconCheck, IconFileText, IconRefreshCw, IconSearch } from '@/components/ui/icons';
import {
  ACCOUNT_IMPORT_TARGET_TYPES,
  buildAccountImportPreview,
  mergeAccountImportResults,
  type AccountImportFormat,
  type AccountImportItem,
  type AccountImportResult,
  type AccountImportTargetType,
} from './accountImportConverter';
import { parseHeadersText } from './headersValidation';
import {
  collectProbeStatusCodes,
  formatProbeStatusCode,
  getAccountImportItemKey,
  probeAccountImportItems,
  type AccountImportProbeResultMap,
  type AccountImportProbeStatus,
} from './accountImportProbe';
import { loadImportFile, type ImportTextFile } from './archiveImport';
import styles from './AccountImportModal.module.scss';

type AccountImportModalProps = {
  open: boolean;
  saving: boolean;
  title?: string;
  onClose: () => void;
  onImport: (payload: AccountImportResult) => Promise<void>;
};

const DEFAULT_FORMAT: AccountImportFormat = 'auto';
const DEFAULT_TARGET_TYPE: AccountImportTargetType = 'auto';
const DEFAULT_EXCLUDED_STATUS_CODES = new Set<number>([401]);

export function AccountImportModal({
  open,
  saving,
  title,
  onClose,
  onImport,
}: AccountImportModalProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<AccountImportFormat>(DEFAULT_FORMAT);
  const [jsonText, setJsonText] = useState('');
  const [fileInputs, setFileInputs] = useState<ImportTextFile[]>([]);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<AccountImportResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [targetType, setTargetType] = useState<AccountImportTargetType>(DEFAULT_TARGET_TYPE);
  // default import state: disabled (toggle off = disabled)
  const [importEnabled, setImportEnabled] = useState(false);
  const [probeResults, setProbeResults] = useState<AccountImportProbeResultMap>({});
  const [probing, setProbing] = useState(false);
  const [probeProgress, setProbeProgress] = useState<{ done: number; total: number } | null>(null);
  const [excludedStatusCodes, setExcludedStatusCodes] = useState<Set<number>>(
    () => new Set(DEFAULT_EXCLUDED_STATUS_CODES)
  );
  const [importHeaders, setImportHeaders] = useState('');
  const [importHeadersError, setImportHeadersError] = useState('');
  const [importProxyUrl, setImportProxyUrl] = useState('');
  const [importPriority, setImportPriority] = useState('');
  const probeCancelRef = useRef({ cancelled: false });

  useEffect(() => {
    if (!open) {
      probeCancelRef.current.cancelled = true;
      setFormat(DEFAULT_FORMAT);
      setTargetType(DEFAULT_TARGET_TYPE);
      setImportEnabled(false);
      setImportHeaders('');
      setImportHeadersError('');
      setImportProxyUrl('');
      setImportPriority('');
      setJsonText('');
      setFileInputs([]);
      setError('');
      setPreview(null);
      setPreviewing(false);
      setProbeResults({});
      setProbing(false);
      setProbeProgress(null);
      setExcludedStatusCodes(new Set(DEFAULT_EXCLUDED_STATUS_CODES));
    }
  }, [open]);

  const formatOptions = useMemo(
    () => [
      { value: 'auto', label: t('monitoring.import_format_auto') },
      { value: 'sub2api', label: t('monitoring.import_format_sub2api') },
      { value: 'cpa-multi', label: t('monitoring.import_format_cpa_multi') },
      { value: 'cpa-single', label: t('monitoring.import_format_cpa_single') },
      { value: 'session', label: t('monitoring.import_format_session') },
    ],
    [t]
  );

  const targetFormatOptions = useMemo(
    () =>
      ACCOUNT_IMPORT_TARGET_TYPES.map((value) => ({
        value,
        label: t(`monitoring.import_target_type_${value}`, {
          defaultValue: value === 'auto' ? 'Auto detect type' : value,
        }),
      })),
    [t]
  );

  const resetProbeState = () => {
    probeCancelRef.current.cancelled = true;
    setProbeResults({});
    setProbing(false);
    setProbeProgress(null);
    setExcludedStatusCodes(new Set(DEFAULT_EXCLUDED_STATUS_CODES));
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    try {
      const loadedFiles = (await Promise.all(files.map(loadImportFile))).flat();
      setFileInputs(loadedFiles);
      setJsonText(loadedFiles.length === 1 ? loadedFiles[0].text : '');
      setError('');
      setPreview(null);
      resetProbeState();
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : t('notification.load_failed'));
    } finally {
      event.target.value = '';
    }
  };

  const resolveImportOverrides = () => {
    const headersTrimmed = importHeaders.trim();
    let parsedHeaders: Record<string, string> | undefined;
    if (headersTrimmed) {
      const { value, errorKey } = parseHeadersText(headersTrimmed);
      if (errorKey === 'auth_files.headers_invalid_json') {
        setImportHeadersError(t('monitoring.import_headers_invalid_json'));
        return null;
      }
      if (errorKey === 'auth_files.headers_invalid_object') {
        setImportHeadersError(t('monitoring.import_headers_invalid_object'));
        return null;
      }
      if (errorKey === 'auth_files.headers_invalid_value') {
        setImportHeadersError(t('monitoring.import_headers_invalid_value'));
        return null;
      }
      parsedHeaders = value ?? undefined;
      setImportHeadersError('');
    } else {
      setImportHeadersError('');
    }

    const proxyUrlTrimmed = importProxyUrl.trim() || undefined;
    const priorityTrimmed = importPriority.trim();
    let parsedPriority: number | undefined;
    if (priorityTrimmed) {
      const num = Number(priorityTrimmed);
      if (Number.isFinite(num)) {
        parsedPriority = Math.trunc(num);
      }
    }

    return {
      headers: parsedHeaders,
      proxyUrl: proxyUrlTrimmed,
      priority: parsedPriority,
    };
  };

  const handlePreview = async () => {
    if (saving || previewing || probing) return;
    const manualText = jsonText.trim();
    if (!manualText && fileInputs.length === 0) {
      setError(t('monitoring.import_error_json_required'));
      return;
    }
    const overrides = resolveImportOverrides();
    if (!overrides) return;

    setPreviewing(true);
    setError('');
    resetProbeState();
    try {
      const importOptions = {
        targetType,
        defaultDisabled: !importEnabled,
        headers: overrides.headers,
        proxyUrl: overrides.proxyUrl,
        priority: overrides.priority,
      };
      const result =
        fileInputs.length > 0
          ? (() => {
              const results: AccountImportResult[] = [];
              const warnings: string[] = [];
              fileInputs.forEach((file) => {
                try {
                  results.push(buildAccountImportPreview(file.text, format, importOptions));
                } catch (fileError) {
                  const message =
                    fileError instanceof Error ? fileError.message : String(fileError);
                  warnings.push(`${file.name}: ${message}`);
                }
              });
              const merged = mergeAccountImportResults(results, targetType);
              return { ...merged, warnings: [...merged.warnings, ...warnings] };
            })()
          : buildAccountImportPreview(manualText, format, importOptions);
      if (result.items.length === 0) {
        throw new Error(result.warnings[0] || t('notification.load_failed'));
      }
      setPreview(result);
    } catch (previewError) {
      setPreview(null);
      setError(
        previewError instanceof Error ? previewError.message : t('notification.load_failed')
      );
    } finally {
      setPreviewing(false);
    }
  };

  const handleSourceChange = (value: string) => {
    setFormat(value as AccountImportFormat);
    setPreview(null);
    setError('');
    resetProbeState();
  };

  const handleTargetTypeChange = (value: string) => {
    setTargetType(value as AccountImportTargetType);
    setPreview(null);
    setError('');
    resetProbeState();
  };

  const handleImportEnabledChange = (enabled: boolean) => {
    setImportEnabled(enabled);
    // Keep preview items aligned with the latest default status choice.
    setPreview((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item) => ({
          ...item,
          authJson: {
            ...item.authJson,
            disabled: !enabled,
          },
        })),
      };
    });
  };

  const handleProbe = async () => {
    if (!preview || saving || previewing || probing) return;
    probeCancelRef.current = { cancelled: false };
    setProbing(true);
    setError('');
    setProbeProgress({ done: 0, total: preview.items.length });
    setProbeResults({});
    try {
      const results = await probeAccountImportItems(preview.items, {
        concurrency: 4,
        signal: probeCancelRef.current,
        onProgress: (done, total, key, status) => {
          setProbeProgress({ done, total });
          setProbeResults((current) => ({ ...current, [key]: status }));
        },
      });
      if (!probeCancelRef.current.cancelled) {
        setProbeResults(results);
      }
    } catch (probeError) {
      setError(probeError instanceof Error ? probeError.message : t('notification.load_failed'));
    } finally {
      setProbing(false);
      setProbeProgress(null);
    }
  };

  const handleToggleExcludedStatus = (statusCode: number, checked: boolean) => {
    setExcludedStatusCodes((current) => {
      const next = new Set(current);
      if (checked) next.add(statusCode);
      else next.delete(statusCode);
      return next;
    });
  };

  const probeStatusCodes = useMemo(
    () => (preview ? collectProbeStatusCodes(preview.items, probeResults) : []),
    [preview, probeResults]
  );

  const hasProbeResults = Object.keys(probeResults).length > 0;

  const getItemProbeStatus = (
    item: AccountImportItem,
    index: number
  ): AccountImportProbeStatus | undefined => probeResults[getAccountImportItemKey(item, index)];

  const importableItems = useMemo(() => {
    if (!preview) return [];
    if (!hasProbeResults) return preview.items;
    return preview.items.filter((item, index) => {
      const status = getItemProbeStatus(item, index);
      if (!status) return true;
      return !excludedStatusCodes.has(status.statusCode);
    });
  }, [excludedStatusCodes, hasProbeResults, preview, probeResults]);

  const handleImport = async () => {
    if (!preview || saving || probing) return;
    if (importableItems.length === 0) {
      setError(
        t('monitoring.import_error_all_filtered', {
          defaultValue: '没有可导入的账号，请调整状态码过滤后再试',
        })
      );
      return;
    }
    try {
      const overrides = resolveImportOverrides();
      if (!overrides) return;
      const payload: AccountImportResult = {
        ...preview,
        items: importableItems.map((item) => ({
          ...item,
          authJson: {
            ...item.authJson,
            disabled: !importEnabled,
          },
        })),
        meta: {
          ...preview.meta,
          accountCount: importableItems.length,
        },
      };
      await onImport(payload);
      setError('');
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t('notification.save_failed'));
    }
  };

  const statusToneClass = (statusCode: number | undefined) => {
    if (statusCode === undefined) return styles.statusIdle;
    if (statusCode === 0) return styles.statusTimeout;
    if (statusCode >= 200 && statusCode < 300) return styles.statusOk;
    if (statusCode === 401 || statusCode === 403) return styles.statusAuth;
    if (statusCode >= 400) return styles.statusError;
    return styles.statusOther;
  };

  const renderPreviewItem = (item: AccountImportItem, index: number) => {
    const probeStatus = getItemProbeStatus(item, index);
    const filteredOut =
      hasProbeResults &&
      probeStatus !== undefined &&
      excludedStatusCodes.has(probeStatus.statusCode);

    return (
      <div
        className={`${styles.previewItem} ${filteredOut ? styles.previewItemFiltered : ''}`}
        key={`${item.fileName}-${index}`}
      >
        <div className={styles.previewTitleRow}>
          <span className={styles.previewTitle}>{item.fileName}</span>
          <div className={styles.previewTitleTags}>
            {probeStatus ? (
              <span className={`${styles.statusBadge} ${statusToneClass(probeStatus.statusCode)}`}>
                {formatProbeStatusCode(probeStatus.statusCode)}
              </span>
            ) : null}
            <span className={styles.previewTag}>
              {t(`monitoring.import_source_${item.source}`)}
            </span>
          </div>
        </div>
        <div className={styles.previewFieldRow}>
          <span className={styles.fieldLabel}>{t('monitoring.import_preview_label')}</span>
          <span className={styles.previewValue}>{item.label}</span>
        </div>
        {item.email ? (
          <div className={styles.previewFieldRow}>
            <span className={styles.fieldLabel}>{t('monitoring.import_preview_email')}</span>
            <span className={styles.previewValue}>{item.email}</span>
          </div>
        ) : null}
        {item.accountId ? (
          <div className={styles.previewFieldRow}>
            <span className={styles.fieldLabel}>{t('monitoring.import_preview_account_id')}</span>
            <span className={styles.previewValue}>{item.accountId}</span>
          </div>
        ) : null}
        {probeStatus?.message ? (
          <div className={styles.previewFieldRow}>
            <span className={styles.fieldLabel}>
              {t('monitoring.import_probe_message', { defaultValue: '探测信息' })}
            </span>
            <span className={styles.previewValue}>{probeStatus.message}</span>
          </div>
        ) : null}
        {filteredOut ? (
          <div className={styles.filteredHint}>
            {t('monitoring.import_probe_filtered_hint', {
              defaultValue: '已按状态码过滤，不会导入',
            })}
          </div>
        ) : null}
      </div>
    );
  };

  const previewReady = !!preview;
  const detectedLabel = preview ? t(`monitoring.import_source_${preview.detectedFormat}`) : '';

  const inputModeLabel = preview ? t(`monitoring.import_input_mode_${preview.meta.inputMode}`) : '';

  const busy = saving || previewing || probing;
  const importCount = importableItems.length;
  const totalCount = preview?.items.length ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? t('monitoring.import_modal_title')}
      width={860}
      closeDisabled={busy}
      footer={
        <div className={styles.footerActions}>
          <span className={styles.footerInfo}>
            {preview
              ? hasProbeResults
                ? t('monitoring.import_preview_summary_filtered', {
                    count: importCount,
                    total: totalCount,
                    format: detectedLabel,
                    defaultValue: '将导入 {{count}} / {{total}} 个账号，识别格式：{{format}}。',
                  })
                : t('monitoring.import_preview_summary', {
                    count: preview.items.length,
                    format: detectedLabel,
                  })
              : t('monitoring.import_footer_hint')}
          </span>
          <div className={styles.footerButtons}>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handlePreview()}
              loading={previewing}
              disabled={probing}
            >
              {previewReady ? <IconRefreshCw size={14} aria-hidden="true" /> : null}
              {previewReady
                ? t('monitoring.import_repreview_button')
                : t('monitoring.import_preview_button')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleProbe()}
              loading={probing}
              disabled={!previewReady || saving || previewing}
            >
              <IconSearch size={14} aria-hidden="true" />
              {probing
                ? t('monitoring.import_probe_progress', {
                    done: probeProgress?.done ?? 0,
                    total: probeProgress?.total ?? totalCount,
                    defaultValue: '探测中 {{done}}/{{total}}',
                  })
                : t('monitoring.import_probe_button', { defaultValue: '测试探查' })}
            </Button>
            <Button
              onClick={() => void handleImport()}
              loading={saving}
              disabled={!previewReady || probing || importCount === 0}
            >
              <IconCheck size={14} aria-hidden="true" />
              {t('monitoring.import_confirm_button')}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.accountImportModal}>
        {error ? <div className={styles.errorBanner}>{error}</div> : null}
        {preview?.warnings.length ? (
          <div className={styles.warningBanner}>{preview.warnings.join(' ')}</div>
        ) : null}

        <div className={styles.inputArea}>
          <div className={styles.selectRow}>
            <div className={styles.selectGroup}>
              <label>{t('monitoring.import_source_format_label')}</label>
              <Select
                value={format}
                options={formatOptions}
                onChange={handleSourceChange}
                ariaLabel={t('monitoring.import_source_format_label')}
                disabled={busy}
              />
            </div>
            <div className={styles.selectGroup}>
              <label>{t('monitoring.import_target_format_label')}</label>
              <Select
                value={targetType}
                options={targetFormatOptions}
                onChange={handleTargetTypeChange}
                ariaLabel={t('monitoring.import_target_format_label')}
                disabled={busy}
              />
            </div>
          </div>

          <div className={styles.textAreaGroup}>
            <label htmlFor="request-monitor-import-json">{t('monitoring.import_json_label')}</label>
            <textarea
              id="request-monitor-import-json"
              className={styles.textArea}
              value={jsonText}
              onChange={(event) => {
                setJsonText(event.target.value);
                setFileInputs([]);
                setPreview(null);
                setError('');
                resetProbeState();
              }}
              placeholder={t('monitoring.import_json_placeholder')}
              spellCheck={false}
              disabled={busy}
            />
            <div className={styles.filePickerRow}>
              <label className={styles.filePickerButton}>
                <IconFileText size={16} />
                <span>{t('monitoring.import_pick_files')}</span>
                <input
                  type="file"
                  multiple
                  accept="application/json,.json,application/zip,.zip"
                  onChange={handleFileChange}
                  disabled={busy}
                  className={styles.fileInput}
                />
              </label>
              {fileInputs.length > 0 ? (
                <span className={styles.fileCount}>
                  {t('monitoring.import_selected_files', { count: fileInputs.length })}
                </span>
              ) : null}
            </div>

            <div className={styles.defaultStatusRow}>
              <div className={styles.defaultStatusCopy}>
                <span className={styles.defaultStatusLabel}>
                  {t('monitoring.import_default_status_label', {
                    defaultValue: '导入后默认状态',
                  })}
                </span>
                <span className={styles.defaultStatusHint}>
                  {importEnabled
                    ? t('monitoring.import_default_status_enabled_hint', {
                        defaultValue: '账号将以启用状态导入',
                      })
                    : t('monitoring.import_default_status_disabled_hint', {
                        defaultValue: '账号将以禁用状态导入',
                      })}
                </span>
              </div>
              <ToggleSwitch
                checked={importEnabled}
                onChange={handleImportEnabledChange}
                disabled={busy}
                ariaLabel={t('monitoring.import_default_status_toggle', {
                  defaultValue: '切换导入后默认启用或禁用',
                })}
                label={
                  importEnabled
                    ? t('monitoring.import_default_status_enabled', { defaultValue: '启用' })
                    : t('monitoring.import_default_status_disabled', { defaultValue: '禁用' })
                }
              />
            </div>

            <div className={styles.importSettingsPanel}>
              <div className={styles.importSettingsGrid}>
                <Input
                  label={t('monitoring.import_proxy_url_label')}
                  value={importProxyUrl}
                  onChange={(event) => {
                    setImportProxyUrl(event.target.value);
                    setPreview(null);
                    resetProbeState();
                  }}
                  placeholder={t('monitoring.import_proxy_url_placeholder')}
                  hint={t('monitoring.import_proxy_url_hint')}
                  disabled={busy}
                />
                <Input
                  type="number"
                  step={1}
                  label={t('monitoring.import_priority_label')}
                  value={importPriority}
                  onChange={(event) => {
                    setImportPriority(event.target.value);
                    setPreview(null);
                    resetProbeState();
                  }}
                  placeholder={t('monitoring.import_priority_placeholder')}
                  disabled={busy}
                />
              </div>
              <div className={styles.headersField}>
                <label htmlFor="request-monitor-import-headers">
                  {t('monitoring.import_headers_label')}
                </label>
                <textarea
                  id="request-monitor-import-headers"
                  className={`${styles.textArea} ${styles.headersTextArea}`}
                  value={importHeaders}
                  onChange={(event) => {
                    setImportHeaders(event.target.value);
                    setImportHeadersError('');
                    setPreview(null);
                    resetProbeState();
                  }}
                  placeholder={t('monitoring.import_headers_placeholder')}
                  spellCheck={false}
                  disabled={busy}
                  aria-invalid={Boolean(importHeadersError)}
                  aria-describedby="request-monitor-import-headers-hint"
                />
                <span id="request-monitor-import-headers-hint" className={styles.fieldHint}>
                  {importHeadersError || t('monitoring.import_headers_hint')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {preview ? (
          <div className={styles.summaryCard}>
            <div className={styles.summaryHeader}>
              <IconCheck size={16} className={styles.summaryIcon} />
              <span>{t('monitoring.import_detection_title')}</span>
            </div>

            <div className={styles.summaryStats}>
              <div className={styles.statRow}>
                <span className={styles.statLabel}>
                  {t('monitoring.import_stat_account_count')}
                </span>
                <span className={styles.statValue}>{preview.meta.accountCount}</span>
              </div>
              <div className={styles.statRow}>
                <span className={styles.statLabel}>{t('monitoring.import_stat_file_count')}</span>
                <span className={styles.statValue}>{preview.meta.fileCount}</span>
              </div>
              <div className={styles.statRow}>
                <span className={styles.statLabel}>{t('monitoring.import_stat_input_mode')}</span>
                <span className={styles.statValue}>{inputModeLabel}</span>
              </div>
              {hasProbeResults ? (
                <div className={styles.statRow}>
                  <span className={styles.statLabel}>
                    {t('monitoring.import_stat_importable_count', { defaultValue: '可导入' })}
                  </span>
                  <span className={styles.statValue}>
                    {importCount}/{totalCount}
                  </span>
                </div>
              ) : null}
            </div>

            <div className={styles.summaryControls}>
              <div className={styles.selectGroup}>
                <label>{t('monitoring.import_source_format_label')}</label>
                <Select
                  value={format}
                  options={formatOptions}
                  onChange={handleSourceChange}
                  ariaLabel={t('monitoring.import_source_format_label')}
                  disabled={busy}
                />
              </div>
              <div className={styles.selectGroup}>
                <label>{t('monitoring.import_target_format_label')}</label>
                <Select
                  value={targetType}
                  options={targetFormatOptions}
                  onChange={handleTargetTypeChange}
                  ariaLabel={t('monitoring.import_target_format_label')}
                  disabled={busy}
                />
              </div>
            </div>

            <div className={styles.summaryMetaRow}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>{t('monitoring.import_detected_format')}</span>
                <span className={styles.metaValue}>{detectedLabel}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>
                  {t('monitoring.import_target_format_label')}
                </span>
                <span className={styles.metaValue}>
                  {t(`monitoring.import_target_type_${preview.meta.targetFormat}`, {
                    defaultValue: preview.meta.targetFormat,
                  })}
                </span>
              </div>
            </div>

            {hasProbeResults ? (
              <div className={styles.probeFilterPanel}>
                <div className={styles.probeFilterHeader}>
                  <span className={styles.probeFilterTitle}>
                    {t('monitoring.import_probe_filter_title', {
                      defaultValue: '按状态码过滤（勾选后排除，不导入）',
                    })}
                  </span>
                  <span className={styles.probeFilterHint}>
                    {t('monitoring.import_probe_filter_hint', {
                      defaultValue: '默认排除 401；超时/无状态为 0',
                    })}
                  </span>
                </div>
                <div className={styles.probeFilterList}>
                  {probeStatusCodes.map((code) => (
                    <SelectionCheckbox
                      key={code}
                      checked={excludedStatusCodes.has(code)}
                      onChange={(checked) => handleToggleExcludedStatus(code, checked)}
                      disabled={busy}
                      ariaLabel={t('monitoring.import_probe_filter_code', {
                        code: formatProbeStatusCode(code),
                        defaultValue: `排除状态码 ${formatProbeStatusCode(code)}`,
                      })}
                      label={
                        <span className={styles.probeFilterLabel}>
                          <span className={`${styles.statusBadge} ${statusToneClass(code)}`}>
                            {formatProbeStatusCode(code)}
                          </span>
                          <span>
                            {t('monitoring.import_probe_filter_count', {
                              count: preview.items.filter((item, index) => {
                                const status = getItemProbeStatus(item, index);
                                return status?.statusCode === code;
                              }).length,
                              defaultValue: '{{count}} 个',
                            })}
                          </span>
                        </span>
                      }
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.probeHint}>
                {t('monitoring.import_probe_hint', {
                  defaultValue: '识别完成后可点击“测试探查”，检查账号凭证 HTTP 状态。',
                })}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.previewPlaceholder}>{t('monitoring.import_preview_empty')}</div>
        )}

        {/* 账号预览列表 */}
        {preview ? (
          <div className={styles.previewPanel}>
            <div className={styles.previewHeader}>
              {t('monitoring.import_preview_title')}
              <span className={styles.previewMeta}>
                {hasProbeResults
                  ? t('monitoring.import_preview_description_filtered', {
                      count: importCount,
                      total: totalCount,
                      format: detectedLabel,
                      defaultValue: '可导入 {{count}} / {{total}} 个账号，来源格式：{{format}}。',
                    })
                  : t('monitoring.import_preview_description', {
                      count: preview.items.length,
                      format: detectedLabel,
                    })}
              </span>
            </div>
            <div className={styles.previewList}>{preview.items.map(renderPreviewItem)}</div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
