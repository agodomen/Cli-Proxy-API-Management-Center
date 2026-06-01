import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { listKeys, listProviders, updateProvider } from '../api';
import type { APIKey, KeyProbePolicy, Provider } from '../types';
import { CharitableConfigActions } from '../components/CharitableConfigActions';
import { ProviderKeysDrawer } from '../components/ProviderKeysDrawer';
import { ProviderEditorSheet } from '../components/ProviderEditorSheet';
import { DEFAULT_PROBE_CONFIG, getProbeConfig, type ProbeConfig } from './api';
import pageStyles from '../CharitablePage.module.scss';
import styles from './ProbePolicyPage.module.scss';

type PolicyMode = 'inherit' | 'custom' | 'disabled';

const PAGE_SIZE = 20;
const DEFAULT_POLICY: KeyProbePolicy = {
  enabled: true,
  autoPriorityEnabled: true,
  autoStatusEnabled: true,
  autoCpaAccountEnabled: true,
  renewExpiryOnSuccess: false,
  renewalSeconds: 86400,
  priorityBoost: 1,
  priorityPenalty: 2,
  failureThreshold: 3,
  recoveryThreshold: 2,
  minPriority: 0,
  maxPriority: 100,
};

function parsePolicy(raw?: string): KeyProbePolicy {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed as KeyProbePolicy : {};
  } catch {
    return {};
  }
}

function policyMode(policy: KeyProbePolicy): PolicyMode {
  if (policy.enabled === false) return 'disabled';
  return Object.keys(policy).length === 0 ? 'inherit' : 'custom';
}

interface ProbePolicyPageProps {
  headerCenter?: ReactNode;
}

export function ProbePolicyPage({ headerCenter }: ProbePolicyPageProps) {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((state) => state.serviceBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [keysTarget, setKeysTarget] = useState<Provider | null>(null);
  const [editingProviderId, setEditingProviderId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formMode, setFormMode] = useState<PolicyMode>('inherit');
  const [formPolicy, setFormPolicy] = useState<KeyProbePolicy>(DEFAULT_POLICY);
  const [globalPolicy, setGlobalPolicy] = useState<ProbeConfig>(DEFAULT_PROBE_CONFIG);

  const load = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const [providerResult, keyResult, globalConfig] = await Promise.all([
        listProviders(baseUrl, { page, page_size: PAGE_SIZE, search }, managementKey),
        listKeys(baseUrl, { page: 1, page_size: 500, status: 'all' }, managementKey),
        getProbeConfig(baseUrl, managementKey),
      ]);
      setProviders(providerResult.items);
      setTotalItems(providerResult.total_items);
      setKeys(keyResult.items);
      setGlobalPolicy(globalConfig);
    } catch (error) {
      showNotification(error instanceof Error ? error.message : t('charitable.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, managementKey, page, search, showNotification, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const keyCounts = useMemo(() => {
    const counts = new Map<number, number>();
    keys.forEach((key) => {
      if (key.provider_id) counts.set(key.provider_id, (counts.get(key.provider_id) ?? 0) + 1);
    });
    return counts;
  }, [keys]);

  const summary = useMemo(() => ({
    total: providers.length,
    inherit: providers.filter((item) => policyMode(parsePolicy(item.probe_policy)) === 'inherit').length,
    custom: providers.filter((item) => policyMode(parsePolicy(item.probe_policy)) === 'custom').length,
    disabled: providers.filter((item) => policyMode(parsePolicy(item.probe_policy)) === 'disabled').length,
  }), [providers]);

  const openEditor = (provider: Provider) => {
    const parsed = parsePolicy(provider.probe_policy);
    const mode = policyMode(parsed);
    const inheritedPolicy: KeyProbePolicy = {
      enabled: globalPolicy.enabled,
      autoPriorityEnabled: globalPolicy.autoPriorityEnabled,
      autoStatusEnabled: globalPolicy.autoStatusEnabled,
      autoCpaAccountEnabled: globalPolicy.autoCpaAccountEnabled,
      renewExpiryOnSuccess: globalPolicy.renewExpiryOnSuccess,
      renewalSeconds: globalPolicy.renewalSeconds,
      priorityBoost: globalPolicy.priorityBoost,
      priorityPenalty: globalPolicy.priorityPenalty,
      failureThreshold: globalPolicy.failureThreshold,
      recoveryThreshold: globalPolicy.recoveryThreshold,
      minPriority: globalPolicy.minPriority,
      maxPriority: globalPolicy.maxPriority,
    };
    setEditing(provider);
    setFormMode(mode);
    setFormPolicy(mode === 'custom' ? { ...inheritedPolicy, ...parsed } : inheritedPolicy);
  };

  const save = async () => {
    if (!baseUrl || !editing) return;
    setSaving(true);
    try {
      const nextPolicy = formMode === 'inherit'
        ? {}
        : formMode === 'disabled'
          ? { enabled: false }
          : { ...formPolicy, enabled: true };
      const saved = await updateProvider(baseUrl, editing.provider_id, {
        ...editing,
        probe_policy: JSON.stringify(nextPolicy),
      }, managementKey);
      setProviders((current) => current.map((item) => item.provider_id === saved.provider_id ? saved : item));
      setEditing(null);
      showNotification(t('charitable.policy.providerSaveSuccess'), 'success');
    } catch (error) {
      showNotification(error instanceof Error ? error.message : t('charitable.updateFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  return (
    <div className={pageStyles.page}>
      <div className={pageStyles.header}>
        <div><h1 className={pageStyles.title}>{t('charitable.policy.providerTitle')}</h1><p className={pageStyles.pageDesc}>{t('charitable.policy.providerDescription')}</p></div>
        {headerCenter}
        <div className={pageStyles.actions}><Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>{t('charitable.refresh')}</Button></div>
      </div>

      <div className={styles.summaryGrid}>
        <div><span>{t('charitable.policy.providerTotal')}</span><strong>{summary.total}</strong></div>
        <div><span>{t('charitable.policy.modes.inherit')}</span><strong>{summary.inherit}</strong></div>
        <div><span>{t('charitable.policy.customPolicies')}</span><strong>{summary.custom}</strong></div>
        <div><span>{t('charitable.policy.modes.disabled')}</span><strong>{summary.disabled}</strong></div>
      </div>

      <div className={styles.toolbar}>
        <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t('charitable.policy.providerSearch')} />
        <span>{t('charitable.policy.providerInheritance')}</span>
      </div>

      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>{t('charitable.policy.provider')}</th><th>{t('charitable.provider.baseUrl')}</th><th>{t('charitable.status')}</th><th>{t('charitable.keys')}</th><th>{t('charitable.policy.strategy')}</th><th>{t('charitable.actions')}</th></tr></thead>
          <tbody>{providers.map((provider) => {
            const mode = policyMode(parsePolicy(provider.probe_policy));
            return <tr key={provider.provider_id}>
              <td><strong>{provider.provider_name}</strong><small>#{provider.provider_id}</small></td>
              <td>{provider.base_url}</td>
              <td>{provider.status >= 1 ? t('charitable.statusValid') : t('charitable.statusDisabled')}</td>
              <td><button type="button" className={styles.linkButton} onClick={() => setKeysTarget(provider)}>{t('charitable.policy.keyCount', { count: keyCounts.get(provider.provider_id) ?? 0 })}</button></td>
              <td><span className={styles.policyBadge}>{t(`charitable.policy.modes.${mode}`)}</span></td>
              <td><div className={styles.rowActions}><Button variant="secondary" size="sm" onClick={() => openEditor(provider)}>{t('charitable.policy.configure')}</Button><Button variant="secondary" size="sm" onClick={() => setKeysTarget(provider)}>{t('charitable.provider.viewKeys')}</Button><CharitableConfigActions providerId={provider.provider_id} onEditProvider={setEditingProviderId} /></div></td>
            </tr>;
          })}</tbody>
        </table>
        {!loading && providers.length === 0 ? <div className={styles.empty}>{t('charitable.emptyList')}</div> : null}
      </div>

      <div className={styles.pagination}><span>{t('charitable.totalItems', { count: totalItems })}</span><div><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t('common.previous')}</Button><span>{page} / {totalPages}</span><Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>{t('common.next')}</Button></div></div>

      {editing ? <div className={styles.overlay} onMouseDown={() => setEditing(null)}><aside className={styles.drawer} onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.drawerHeader}><div><h2>{t('charitable.policy.providerDrawerTitle')}</h2><p>{editing.provider_name}</p></div><button type="button" onClick={() => setEditing(null)}>×</button></div>
        <div className={styles.drawerBody}><section><h3>{t('charitable.policy.strategy')}</h3><div className={styles.modeGrid}>{(['inherit', 'custom', 'disabled'] as PolicyMode[]).map((mode) => <button type="button" key={mode} className={formMode === mode ? styles.modeActive : ''} onClick={() => setFormMode(mode)}>{t(`charitable.policy.modes.${mode}`)}</button>)}</div></section>
          {formMode === 'inherit' ? <section><h3>{t('charitable.policy.globalPolicyTitle')}</h3><p>{t('charitable.policy.globalPolicyHint')}</p><div className={styles.globalPolicyGrid}>
            <div><span>{t('charitable.policy.serviceEnabled')}</span><strong>{t(globalPolicy.enabled ? 'charitable.policy.booleanEnabled' : 'charitable.policy.booleanDisabled')}</strong></div>
            <div><span>{t('charitable.policy.autoPriority')}</span><strong>{t(globalPolicy.autoPriorityEnabled ? 'charitable.policy.booleanEnabled' : 'charitable.policy.booleanDisabled')}</strong></div>
            <div><span>{t('charitable.policy.autoStatus')}</span><strong>{t(globalPolicy.autoStatusEnabled ? 'charitable.policy.booleanEnabled' : 'charitable.policy.booleanDisabled')}</strong></div>
            <div><span>{t('charitable.policy.autoCpa')}</span><strong>{t(globalPolicy.autoCpaAccountEnabled ? 'charitable.policy.booleanEnabled' : 'charitable.policy.booleanDisabled')}</strong></div>
            <div><span>{t('charitable.policy.autoRenew')}</span><strong>{t(globalPolicy.renewExpiryOnSuccess ? 'charitable.policy.booleanEnabled' : 'charitable.policy.booleanDisabled')}</strong></div>
            <div><span>{t('charitable.policy.renewalSeconds')}</span><strong>{globalPolicy.renewalSeconds}</strong></div>
            <div><span>{t('charitable.policy.windowSeconds')}</span><strong>{globalPolicy.windowSeconds}</strong></div>
            <div><span>{t('charitable.policy.failureThreshold')}</span><strong>{globalPolicy.failureThreshold}</strong></div>
            <div><span>{t('charitable.policy.recoveryThreshold')}</span><strong>{globalPolicy.recoveryThreshold}</strong></div>
            <div><span>{t('charitable.policy.priorityBoost')}</span><strong>{globalPolicy.priorityBoost}</strong></div>
            <div><span>{t('charitable.policy.priorityPenalty')}</span><strong>{globalPolicy.priorityPenalty}</strong></div>
            <div><span>{t('charitable.policy.priorityRange')}</span><strong>{globalPolicy.minPriority} – {globalPolicy.maxPriority}</strong></div>
            <div><span>{t('charitable.policy.maxActionsPerBatch')}</span><strong>{globalPolicy.maxActionsPerBatch}</strong></div>
          </div></section> : null}
          {formMode === 'custom' ? <section><h3>{t('charitable.policy.automation')}</h3><div className={styles.toggleGrid}>
            <ToggleSwitch checked={formPolicy.autoPriorityEnabled ?? true} onChange={(value) => setFormPolicy((current) => ({ ...current, autoPriorityEnabled: value }))} label={t('charitable.policy.autoPriority')} />
            <ToggleSwitch checked={formPolicy.autoStatusEnabled ?? true} onChange={(value) => setFormPolicy((current) => ({ ...current, autoStatusEnabled: value }))} label={t('charitable.policy.autoStatus')} />
            <ToggleSwitch checked={formPolicy.autoCpaAccountEnabled ?? true} onChange={(value) => setFormPolicy((current) => ({ ...current, autoCpaAccountEnabled: value }))} label={t('charitable.policy.autoCpa')} />
            <ToggleSwitch checked={formPolicy.renewExpiryOnSuccess ?? false} onChange={(value) => setFormPolicy((current) => ({ ...current, renewExpiryOnSuccess: value }))} label={t('charitable.policy.autoRenew')} />
          </div><div className={styles.numberGrid}>
            <label><span>{t('charitable.policy.failureThreshold')}</span><input type="number" min="1" value={formPolicy.failureThreshold ?? 3} onChange={(event) => setFormPolicy((current) => ({ ...current, failureThreshold: Number(event.target.value) }))} /></label>
            <label><span>{t('charitable.policy.recoveryThreshold')}</span><input type="number" min="1" value={formPolicy.recoveryThreshold ?? 2} onChange={(event) => setFormPolicy((current) => ({ ...current, recoveryThreshold: Number(event.target.value) }))} /></label>
            <label><span>{t('charitable.policy.priorityBoost')}</span><input type="number" min="0" value={formPolicy.priorityBoost ?? 1} onChange={(event) => setFormPolicy((current) => ({ ...current, priorityBoost: Number(event.target.value) }))} /></label>
            <label><span>{t('charitable.policy.priorityPenalty')}</span><input type="number" min="0" value={formPolicy.priorityPenalty ?? 2} onChange={(event) => setFormPolicy((current) => ({ ...current, priorityPenalty: Number(event.target.value) }))} /></label>
            <label><span>{t('charitable.policy.minPriority')}</span><input type="number" value={formPolicy.minPriority ?? 0} onChange={(event) => setFormPolicy((current) => ({ ...current, minPriority: Number(event.target.value) }))} /></label>
            <label><span>{t('charitable.policy.maxPriority')}</span><input type="number" value={formPolicy.maxPriority ?? 100} onChange={(event) => setFormPolicy((current) => ({ ...current, maxPriority: Number(event.target.value) }))} /></label>
          </div></section> : null}</div>
        <div className={styles.drawerFooter}><Button variant="secondary" onClick={() => setEditing(null)}>{t('charitable.cancel')}</Button><Button onClick={() => void save()} loading={saving}>{t('charitable.save')}</Button></div>
      </aside></div> : null}

      <ProviderKeysDrawer provider={keysTarget} open={Boolean(keysTarget)} onClose={() => setKeysTarget(null)} />
      <ProviderEditorSheet
        providerId={editingProviderId}
        open={editingProviderId !== null}
        onClose={() => setEditingProviderId(null)}
        onSaved={(saved) => {
          setProviders((current) => current.map((provider) => provider.provider_id === saved.provider_id ? saved : provider));
          setKeysTarget((current) => current?.provider_id === saved.provider_id ? saved : current);
        }}
      />
    </div>
  );
}
