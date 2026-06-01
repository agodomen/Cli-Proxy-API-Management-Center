import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { Sheet } from '../../serviceProviders/ui/Sheet';
import { getProvider, listChannels, updateProvider } from '../api';
import {
  PROVIDER_INTEGRATION_OPTIONS,
  defaultCPAConfigForProtocols,
  formatProviderProtocols,
  parseProviderProtocols,
} from '../types';
import type { Channel, Provider, ProviderProtocolType, CPAConfigType } from '../types';
import { ParamEditor } from './ParamEditor/ParamEditor';
import { tryParseParamObject } from './ParamEditor/paramUtils';
import { ProxyCombobox } from './ProxyCombobox';
import styles from '../CharitablePage.module.scss';

interface ProviderEditorSheetProps {
  providerId: number | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (provider: Provider) => void;
}

export function ProviderEditorSheet({ providerId, open, onClose, onSaved }: ProviderEditorSheetProps) {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((state) => state.serviceBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paramValid, setParamValid] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [channelId, setChannelId] = useState<number | ''>('');
  const [status, setStatus] = useState(1);
  const [protocolTypes, setProtocolTypes] = useState<ProviderProtocolType[]>(['openai_compatible']);
  const [cpaConfigType, setCPAConfigType] = useState<CPAConfigType>('openai-compatibility');
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyId, setProxyId] = useState<number | undefined>();
  const [param, setParam] = useState('{}');

  const load = useCallback(async () => {
    if (!open || !providerId || !baseUrl) return;
    setLoading(true);
    try {
      const [nextProvider, channelResult] = await Promise.all([
        getProvider(baseUrl, providerId, managementKey),
        listChannels(baseUrl, { page: 1, page_size: 500 }, managementKey),
      ]);
      const providerParam = tryParseParamObject(nextProvider.param || '{}') ?? {};
      setProvider(nextProvider);
      setChannels(channelResult.items || []);
      setName(nextProvider.provider_name);
      setDescription(nextProvider.description || '');
      setProviderBaseUrl(nextProvider.base_url);
      setChannelId(nextProvider.channel_id ?? '');
      setStatus(nextProvider.status);
      const protocols = parseProviderProtocols(nextProvider.protocol_type);
      setProtocolTypes(protocols);
      setCPAConfigType(nextProvider.cpa_config_type || defaultCPAConfigForProtocols(protocols));
      setProxyUrl(String(providerParam.proxy_url ?? providerParam.proxyUrl ?? ''));
      setProxyId(typeof providerParam.proxy_id === 'number' ? providerParam.proxy_id : undefined);
      setParam(nextProvider.param || '{}');
      setParamValid(true);
    } catch {
      showNotification(t('charitable.loadFailed'), 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [baseUrl, managementKey, onClose, open, providerId, showNotification, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!baseUrl || !provider || !name.trim() || !providerBaseUrl.trim() || !paramValid) return;
    setSaving(true);
    try {
      const nextParam = tryParseParamObject(param) ?? {};
      delete nextParam.proxyUrl;
      if (proxyUrl.trim()) nextParam.proxy_url = proxyUrl.trim();
      else delete nextParam.proxy_url;
      if (proxyId) nextParam.proxy_id = proxyId;
      else delete nextParam.proxy_id;
      const saved = await updateProvider(baseUrl, provider.provider_id, {
        ...provider,
        provider_name: name.trim(),
        description: description.trim(),
        base_url: providerBaseUrl.trim(),
        channel_id: channelId === '' ? null : channelId,
        status,
        protocol_type: formatProviderProtocols(protocolTypes),
        cpa_config_type: cpaConfigType,
        param: JSON.stringify(nextParam),
      }, managementKey);
      onSaved?.(saved);
      showNotification(t('charitable.updateSuccess'), 'success');
      onClose();
    } catch {
      showNotification(t('charitable.updateFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={t('charitable.operations.editProvider')}
      description={provider?.provider_name}
      closeDisabled={saving}
      footer={(
        <>
          <button type="button" className={styles.btnGhost} onClick={onClose} disabled={saving}>{t('charitable.cancel')}</button>
          <button type="submit" form="inline-provider-editor" className={styles.btnPrimary} disabled={loading || saving || !paramValid}>{t('charitable.save')}</button>
        </>
      )}
    >
      <form id="inline-provider-editor" className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}><label className={styles.label}>{t('charitable.provider.name')} *</label><input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} required /></div>
        <div className={styles.field}><label className={styles.label}>{t('charitable.provider.description')}</label><textarea className={styles.input} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></div>
        <div className={styles.field}><label className={styles.label}>{t('charitable.provider.baseUrl')} *</label><input className={styles.input} value={providerBaseUrl} onChange={(event) => setProviderBaseUrl(event.target.value)} required /></div>
        <div className={styles.field}><label className={styles.label}>{t('charitable.provider.channelId')}</label><select className={styles.input} value={channelId} onChange={(event) => setChannelId(event.target.value === '' ? '' : Number(event.target.value))}><option value="">—</option>{channels.map((channel) => <option key={channel.channel_id} value={channel.channel_id}>{channel.channel_name}</option>)}</select></div>
        <div className={styles.field}><label className={styles.label}>{t('charitable.status')}</label><select className={styles.input} value={status} onChange={(event) => setStatus(Number(event.target.value))}><option value={1}>{t('charitable.statusValid')}</option><option value={0}>{t('charitable.statusUnknown')}</option><option value={-2}>{t('charitable.statusDisabled')}</option><option value={-1}>{t('charitable.statusInvalid')}</option></select></div>
        <div className={styles.field}>
          <label className={styles.label}>{t('charitable.provider.protocolType')}</label>
          <div className={styles.checkboxGroup}>
            {PROVIDER_INTEGRATION_OPTIONS.map((item) => (
              <label key={item.protocol} className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={protocolTypes.includes(item.protocol)}
                  onChange={() => {
                    setProtocolTypes((prev) => {
                      const exists = prev.includes(item.protocol);
                      const next = exists
                        ? prev.filter((protocol) => protocol !== item.protocol)
                        : [...prev, item.protocol];
                      const resolved = next.length > 0 ? next : prev;
                      // Keep CPA target aligned with the first selected protocol when user hasn't customized later.
                      setCPAConfigType(defaultCPAConfigForProtocols(resolved));
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
              value: formatProviderProtocols(protocolTypes),
            })}
          </span>
        </div>
        <div className={styles.field}><label className={styles.label}>{t('charitable.provider.cpaConfigType')}</label><select className={styles.input} value={cpaConfigType} onChange={(event) => setCPAConfigType(event.target.value as CPAConfigType)}>{PROVIDER_INTEGRATION_OPTIONS.map((item) => <option key={item.cpaConfig} value={item.cpaConfig}>{item.cpaConfig}</option>)}</select></div>
        <div className={styles.field}><label className={styles.label}>{t('charitable.provider.proxy')}</label><ProxyCombobox baseUrl={baseUrl} managementKey={managementKey} value={proxyUrl} selectedProxyId={proxyId} onInputChange={(value) => { setProxyUrl(value); setProxyId(undefined); }} onSelect={(proxy) => { setProxyUrl(proxy.proxy_value); setProxyId(proxy.id); }} placeholder={t('charitable.probe.proxySearchPlaceholder')} ariaLabel={t('charitable.probe.proxySearchLabel')} noResultsLabel={t('charitable.probe.proxyNoResults')} loadingLabel={t('charitable.probe.proxySearching')} /></div>
        <div className={styles.field}><label className={styles.label}>{t('charitable.provider.param')}</label><ParamEditor value={param} onChange={setParam} onValidityChange={setParamValid} /></div>
      </form>
    </Sheet>
  );
}
