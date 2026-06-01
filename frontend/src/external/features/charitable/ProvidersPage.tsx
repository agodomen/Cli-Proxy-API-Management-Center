import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import {
  listProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  listChannels,
} from './api';
import { getStatusInfo } from './types';
import {
  PROVIDER_INTEGRATION_OPTIONS,
  defaultCPAConfigForProtocols,
  formatProviderProtocols,
  parseProviderProtocols,
} from './types';
import type { Provider, Channel, ListParams, ProviderProtocolType, CPAConfigType } from './types';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../serviceProviders/ui/Table';
import { Sheet } from '../serviceProviders/ui/Sheet';
import { Modal } from '@/components/ui/Modal';
import {
  IconPlus,
  IconPencil,
  IconTrash2,
  IconSearch,
  IconRefreshCw,
  IconEye,
} from '../serviceProviders/ui/icons';
import { ParamEditor } from './components/ParamEditor/ParamEditor';
import { ProviderKeysDrawer } from './components/ProviderKeysDrawer';
import { ProviderCpaSyncButton } from './components/ProviderCpaSyncButton';
import { ProviderAuthFileSyncDialog } from './components/ProviderAuthFileSyncDialog';
import { listAllFilteredKeys } from './keyProbeService';
import { isAuthFileCredential } from './authFilePush';
import { ProxyCombobox } from './components/ProxyCombobox';
import { tryParseParamObject } from './components/ParamEditor/paramUtils';
import styles from './CharitablePage.module.scss';

interface ProvidersPageProps {
  headerCenter?: ReactNode;
  editRequestId?: number;
  onEditRequestHandled?: () => void;
}

export function ProvidersPage({
  headerCenter,
  editRequestId,
  onEditRequestHandled,
}: ProvidersPageProps) {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((s) => s.serviceBase);
  const managementKey = useAuthStore((s) => s.managementKey);
  const { showNotification } = useNotificationStore();

  const [items, setItems] = useState<Provider[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<number | ''>('');
  const [statusFilter, setStatusFilter] = useState<number | 'all'>(1);
  const [baseUrlFilter, setBaseUrlFilter] = useState('');
  const [loading, setLoading] = useState(false);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit'>('create');
  const [editTarget, setEditTarget] = useState<Provider | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formChannelId, setFormChannelId] = useState<number | ''>('');
  const [formStatus, setFormStatus] = useState(1);
  const [formProtocolTypes, setFormProtocolTypes] = useState<ProviderProtocolType[]>(['openai_compatible']);
  const [formCPAConfigType, setFormCPAConfigType] = useState<CPAConfigType>('openai-compatibility');
  const [formProxyUrl, setFormProxyUrl] = useState('');
  const [formProxyId, setFormProxyId] = useState<number | undefined>();
  const [formParam, setFormParam] = useState('{}');
  const [formParamValid, setFormParamValid] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);
  const [keysTarget, setKeysTarget] = useState<Provider | null>(null);
  const [authFileConfigTarget, setAuthFileConfigTarget] = useState<Provider | null>(null);
  const [authFileConfigAfterSave, setAuthFileConfigAfterSave] = useState(false);

  const closeAuthFileConfigSync = useCallback(() => {
    setAuthFileConfigTarget(null);
    setAuthFileConfigAfterSave(false);
  }, []);

  const pageSize = 20;

  const fetchChannels = useCallback(async () => {
    if (!baseUrl) return;
    try {
      const result = await listChannels(baseUrl, { page: 1, page_size: 500 }, managementKey);
      setChannels(result.items || []);
    } catch {
      /* ignore */
    }
  }, [baseUrl, managementKey]);

  const fetchData = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const params: ListParams = { page, page_size: pageSize };
      if (search) params.search = search;
      if (channelFilter !== '') params.channel_id = channelFilter;
      params.status = statusFilter;
      if (baseUrlFilter) params.base_url = baseUrlFilter;
      const result = await listProviders(baseUrl, params, managementKey);
      setItems(result.items || []);
      setTotalItems(result.total_items);
    } catch {
      showNotification(t('charitable.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [
    baseUrl,
    managementKey,
    page,
    search,
    channelFilter,
    statusFilter,
    baseUrlFilter,
    showNotification,
    t,
  ]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setSheetMode('create');
    setEditTarget(null);
    setFormName('');
    setFormDescription('');
    setFormBaseUrl('');
    setFormChannelId('');
    setFormStatus(1);
    setFormProtocolTypes(['openai_compatible']);
    setFormCPAConfigType('openai-compatibility');
    setFormProxyUrl('');
    setFormProxyId(undefined);
    setFormParam('{}');
    setFormParamValid(true);
    setSheetOpen(true);
  };

  const openEdit = (pv: Provider) => {
    setSheetMode('edit');
    setEditTarget(pv);
    setFormName(pv.provider_name);
    setFormDescription(pv.description || '');
    setFormBaseUrl(pv.base_url);
    setFormChannelId(pv.channel_id ?? '');
    setFormStatus(pv.status);
    const protocols = parseProviderProtocols(pv.protocol_type);
    setFormProtocolTypes(protocols);
    setFormCPAConfigType(pv.cpa_config_type || defaultCPAConfigForProtocols(protocols));
    const providerParam = tryParseParamObject(pv.param || '{}') ?? {};
    setFormProxyUrl(String(providerParam.proxy_url ?? providerParam.proxyUrl ?? ''));
    setFormProxyId(typeof providerParam.proxy_id === 'number' ? providerParam.proxy_id : undefined);
    setFormParam(pv.param || '{}');
    setFormParamValid(true);
    setSheetOpen(true);
  };

  useEffect(() => {
    if (!baseUrl || !editRequestId) return;
    let active = true;
    void getProvider(baseUrl, editRequestId, managementKey)
      .then((provider) => {
        if (!active) return;
        openEdit(provider);
      })
      .catch(() => {
        if (active) showNotification(t('charitable.loadFailed'), 'error');
      })
      .finally(() => {
        if (active) onEditRequestHandled?.();
      });
    return () => {
      active = false;
    };
  }, [baseUrl, editRequestId, managementKey, onEditRequestHandled, showNotification, t]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!baseUrl || !formName.trim() || !formBaseUrl.trim() || !formParamValid) return;
    setSubmitting(true);
    try {
      const nextParam = tryParseParamObject(formParam) ?? {};
      delete nextParam.proxyUrl;
      if (formProxyUrl.trim()) nextParam.proxy_url = formProxyUrl.trim();
      else delete nextParam.proxy_url;
      if (formProxyId) nextParam.proxy_id = formProxyId;
      else delete nextParam.proxy_id;
      const input = {
        provider_name: formName.trim(),
        description: formDescription.trim(),
        base_url: formBaseUrl.trim(),
        channel_id: formChannelId === '' ? null : formChannelId,
        status: formStatus,
        protocol_type: formatProviderProtocols(formProtocolTypes),
        cpa_config_type: formCPAConfigType,
        probe_policy: editTarget?.probe_policy || '{}',
        param: JSON.stringify(nextParam),
      };
      if (sheetMode === 'create') {
        await createProvider(baseUrl, input, managementKey);
        showNotification(t('charitable.createSuccess'), 'success');
      } else if (editTarget) {
        const savedProvider = await updateProvider(baseUrl, editTarget.provider_id, input, managementKey);
        showNotification(t('charitable.updateSuccess'), 'success');
        setSheetOpen(false);
        fetchData();
        // Explicit opt-in batch sync: never silent auto-push.
        try {
          const linked = await listAllFilteredKeys(
            baseUrl,
            { provider_id: savedProvider.provider_id, credential_kind: 'auth_file', status: 'all' },
            managementKey
          );
          const authFiles = linked.filter((item) => isAuthFileCredential(item));
          if (authFiles.length > 0) {
            setAuthFileConfigAfterSave(true);
            setAuthFileConfigTarget(savedProvider);
          }
        } catch {
          // Save already succeeded; sync prompt is optional.
        }
        return;
      }
      setSheetOpen(false);
      fetchData();
    } catch {
      showNotification(
        sheetMode === 'create' ? t('charitable.createFailed') : t('charitable.updateFailed'),
        'error'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!baseUrl || !deleteTarget) return;
    try {
      await deleteProvider(baseUrl, deleteTarget.provider_id, managementKey);
      showNotification(t('charitable.deleteSuccess'), 'success');
      setDeleteTarget(null);
      fetchData();
    } catch {
      showNotification(t('charitable.deleteFailed'), 'error');
    }
  };

  const totalPages = Math.ceil(totalItems / pageSize);
  const channelMap = Object.fromEntries(channels.map((c) => [c.channel_id, c.channel_name]));
  const selectedChannel = channels.find((channel) => channel.channel_id === formChannelId);
  const inheritedParams = tryParseParamObject(selectedChannel?.param || '{}') ?? {};

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('charitable.providers')}</h1>
        {headerCenter}
        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={fetchData} disabled={loading}>
            <IconRefreshCw size={16} /> {t('charitable.refresh')}
          </button>
          <button className={styles.btnPrimary} onClick={openCreate}>
            <IconPlus size={16} /> {t('charitable.create')}
          </button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <IconSearch size={16} />
          <input
            type="text"
            placeholder={t('charitable.provider.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className={styles.searchBox}>
          <IconSearch size={16} />
          <input
            value={baseUrlFilter}
            onChange={(e) => {
              setBaseUrlFilter(e.target.value);
              setPage(1);
            }}
            placeholder={t('charitable.provider.baseUrlFilter')}
          />
        </div>
        <select
          className={styles.filterSelect}
          value={channelFilter}
          onChange={(e) => {
            setChannelFilter(e.target.value === '' ? '' : Number(e.target.value));
            setPage(1);
          }}
        >
          <option value="">{t('charitable.provider.channelSelect')}</option>
          {channels.map((c) => (
            <option key={c.channel_id} value={c.channel_id}>
              {c.channel_name}
            </option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => {
            const v = e.target.value;
            setStatusFilter(v === 'all' ? 'all' : Number(v));
            setPage(1);
          }}
        >
          <option value="all">{t('charitable.statusAll')}</option>
          <option value={1}>{t('charitable.statusValid')}</option>
          <option value={0}>{t('charitable.statusUnknown')}</option>
          <option value={-2}>{t('charitable.statusDisabled')}</option>
          <option value={-1}>{t('charitable.statusInvalid')}</option>
        </select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>{t('charitable.provider.name')}</TableHead>
            <TableHead>{t('charitable.provider.channelId')}</TableHead>
            <TableHead>{t('charitable.provider.baseUrl')}</TableHead>
            <TableHead>{t('charitable.provider.integrationType')}</TableHead>
            <TableHead>{t('charitable.status')}</TableHead>
            <TableHead>{t('charitable.createdAt')}</TableHead>
            <TableHead alignRight>{t('charitable.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && !loading ? (
            <TableRow>
              <TableCell colSpan={8} className={styles.emptyCell}>
                {t('charitable.emptyList')}
              </TableCell>
            </TableRow>
          ) : (
            items.map((pv) => {
              const si = getStatusInfo(pv.status);
              return (
                <TableRow key={pv.provider_id}>
                  <TableCell className={styles.mono}>{pv.provider_id}</TableCell>
                  <TableCell>{pv.provider_name}</TableCell>
                  <TableCell>
                    {pv.channel_id ? channelMap[pv.channel_id] || pv.channel_id : '—'}
                  </TableCell>
                  <TableCell className={styles.mono}>{pv.base_url}</TableCell>
                  <TableCell>
                    <span className={styles.mono}>
                      {parseProviderProtocols(pv.protocol_type)
                        .map((protocol) => t(`charitable.provider.protocols.${protocol}`))
                        .join(' · ')}
                    </span>
                    <small>{pv.cpa_config_type || 'openai-compatibility'}</small>
                  </TableCell>
                  <TableCell>
                    <span className={styles[`badge_${si.color}`]}>{t(si.label)}</span>
                  </TableCell>
                  <TableCell className={styles.mono}>{pv.create_at}</TableCell>
                  <TableCell alignRight>
                    <ProviderCpaSyncButton provider={pv} />
                    <button
                      className={styles.iconBtn}
                      onClick={() => {
                        setAuthFileConfigAfterSave(false);
                        setAuthFileConfigTarget(pv);
                      }}
                      title={t('charitable.provider.authFileConfigSyncAction')}
                    >
                      <IconRefreshCw size={16} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() => setKeysTarget(pv)}
                      title={t('charitable.provider.viewKeys')}
                    >
                      <IconEye size={16} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() => openEdit(pv)}
                      title={t('charitable.edit')}
                    >
                      <IconPencil size={16} />
                    </button>
                    <button
                      className={styles.iconBtnDanger}
                      onClick={() => setDeleteTarget(pv)}
                      title={t('charitable.delete')}
                    >
                      <IconTrash2 size={16} />
                    </button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <ProviderKeysDrawer
        provider={keysTarget}
        open={Boolean(keysTarget)}
        onClose={() => setKeysTarget(null)}
      />

      <ProviderAuthFileSyncDialog
        provider={authFileConfigTarget}
        open={Boolean(authFileConfigTarget)}
        afterSave={authFileConfigAfterSave}
        onClose={closeAuthFileConfigSync}
      />

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Prev
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={sheetMode === 'create' ? t('charitable.create') : t('charitable.edit')}
        size="lg"
        footer={
          <>
            <button
              type="submit"
              form="provider-form"
              className={styles.btnPrimary}
              disabled={submitting || !formParamValid}
            >
              {t('charitable.save')}
            </button>
            <button type="button" className={styles.btnGhost} onClick={() => setSheetOpen(false)}>
              {t('charitable.cancel')}
            </button>
          </>
        }
      >
        <form id="provider-form" className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.provider.name')} *</label>
            <input
              className={styles.input}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={t('charitable.provider.namePlaceholder')}
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.provider.baseUrl')} *</label>
            <input
              className={styles.input}
              value={formBaseUrl}
              onChange={(e) => setFormBaseUrl(e.target.value)}
              placeholder={t('charitable.provider.baseUrlPlaceholder')}
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.provider.description')}</label>
            <textarea
              className={styles.input}
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder={t('charitable.provider.descriptionPlaceholder')}
              rows={3}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.provider.channelId')}</label>
            <select
              className={styles.input}
              value={formChannelId}
              onChange={(e) =>
                setFormChannelId(e.target.value === '' ? '' : Number(e.target.value))
              }
            >
              <option value="">—</option>
              {channels.map((c) => (
                <option key={c.channel_id} value={c.channel_id}>
                  {c.channel_name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.status')}</label>
            <select
              className={styles.input}
              value={formStatus}
              onChange={(e) => setFormStatus(Number(e.target.value))}
            >
              <option value={1}>{t('charitable.statusValid')}</option>
              <option value={0}>{t('charitable.statusUnknown')}</option>
              <option value={-2}>{t('charitable.statusDisabled')}</option>
              <option value={-1}>{t('charitable.statusInvalid')}</option>
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.provider.protocolType')}</label>
            <div className={styles.checkboxGroup}>
              {PROVIDER_INTEGRATION_OPTIONS.map((item) => (
                <label key={item.protocol} className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={formProtocolTypes.includes(item.protocol)}
                    onChange={() => {
                      setFormProtocolTypes((prev) => {
                        const exists = prev.includes(item.protocol);
                        const next = exists
                          ? prev.filter((protocol) => protocol !== item.protocol)
                          : [...prev, item.protocol];
                        const resolved = next.length > 0 ? next : prev;
                        setFormCPAConfigType(defaultCPAConfigForProtocols(resolved));
                        return resolved;
                      });
                    }}
                  />
                  {t(`charitable.provider.protocols.${item.protocol}`)}
                </label>
              ))}
            </div>
            <span className={styles.fieldHint}>
              {t('charitable.provider.protocolMultiHint', {
                value: formatProviderProtocols(formProtocolTypes),
              })}
            </span>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.provider.cpaConfigType')}</label>
            <select className={styles.input} value={formCPAConfigType} onChange={(event) => setFormCPAConfigType(event.target.value as CPAConfigType)}>
              {PROVIDER_INTEGRATION_OPTIONS.map((item) => <option key={item.cpaConfig} value={item.cpaConfig}>{item.cpaConfig}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.provider.proxy')}</label>
            <ProxyCombobox
              baseUrl={baseUrl}
              managementKey={managementKey}
              value={formProxyUrl}
              selectedProxyId={formProxyId}
              onInputChange={(value) => {
                setFormProxyUrl(value);
                setFormProxyId(undefined);
              }}
              onSelect={(proxy) => {
                setFormProxyUrl(proxy.proxy_value);
                setFormProxyId(proxy.id);
              }}
              placeholder={t('charitable.probe.proxySearchPlaceholder')}
              ariaLabel={t('charitable.probe.proxySearchLabel')}
              noResultsLabel={t('charitable.probe.proxyNoResults')}
              loadingLabel={t('charitable.probe.proxySearching')}
            />
            <span className={styles.fieldHint}>
              {formProxyId
                ? t('charitable.probe.proxySelected', { id: formProxyId })
                : t('charitable.provider.proxyHint')}
            </span>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.provider.param')}</label>
            <ParamEditor
              value={formParam}
              onChange={setFormParam}
              onValidityChange={setFormParamValid}
              inheritedParams={inheritedParams}
              inheritedLabel={selectedChannel?.channel_name}
            />
          </div>
        </form>
      </Sheet>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t('charitable.delete')}
      >
        <p>{t('charitable.deleteConfirm')}</p>
        {deleteTarget && <p className={styles.deleteTargetName}>{deleteTarget.provider_name}</p>}
        <div className={styles.modalActions}>
          <button className={styles.btnDanger} onClick={handleDelete}>
            {t('charitable.confirm')}
          </button>
          <button className={styles.btnGhost} onClick={() => setDeleteTarget(null)}>
            {t('charitable.cancel')}
          </button>
        </div>
      </Modal>
    </div>
  );
}
