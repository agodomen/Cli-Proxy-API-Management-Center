import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import {
  clusterApi,
  type ClusterNode,
  type ClusterNodeType,
  type ClusterNodeRole,
  type ClusterNodeStatus,
  type HomeConnection,
  type PushResult,
  type UpsertNodeRequest,
} from '@/external/services/api/cluster';
import styles from './ClusterSettingsPage.module.scss';

const NODE_TYPES: ClusterNodeType[] = ['cpa', 'cpa-home', 'cpamc'];
const NODE_ROLES: ClusterNodeRole[] = ['master', 'follower'];
const NODE_STATUSES: ClusterNodeStatus[] = ['active', 'draining', 'offline'];

// A node is considered stale (no recent heartbeat) if last_seen is older than
// this threshold. Matches the server-recommended heartbeat interval of 30s.
const HEARTBEAT_STALE_MS = 90_000;

function statusClass(status: ClusterNodeStatus): string {
  switch (status) {
    case 'active':
      return styles.badgeStatusActive;
    case 'draining':
      return styles.badgeStatusDraining;
    default:
      return styles.badgeStatusOffline;
  }
}

function livenessState(node: ClusterNode): 'live' | 'stale' | 'unknown' {
  if (!node.lastSeenAt) return 'unknown';
  const seenAt = new Date(node.lastSeenAt).getTime();
  if (Number.isNaN(seenAt)) return 'unknown';
  return Date.now() - seenAt > HEARTBEAT_STALE_MS ? 'stale' : 'live';
}

function livenessClass(state: 'live' | 'stale' | 'unknown'): string {
  switch (state) {
    case 'live':
      return styles.livenessLive;
    case 'stale':
      return styles.livenessStale;
    default:
      return styles.livenessUnknown;
  }
}

function timeAgo(iso?: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  const diffMs = Date.now() - at;
  if (diffMs < 60_000) return `${Math.max(1, Math.round(diffMs / 1000))}s`;
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m`;
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h`;
  return `${Math.round(diffMs / 86_400_000)}d`;
}

export function ClusterSettingsPage() {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<ClusterNode[]>([]);
  const [home, setHome] = useState<HomeConnection>({ baseUrl: '' });
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pushResults, setPushResults] = useState<PushResult[] | null>(null);
  const [pushing, setPushing] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [overview] = await Promise.all([clusterApi.getOverview()]);
      setNodes(overview.nodes ?? []);
      setHome(overview.home ?? { baseUrl: '' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = async (id: string) => {
    await clusterApi.deleteNode(id);
    setNodes((prev) => prev.filter((n) => n.id !== id));
  };

  const handlePushAll = async () => {
    setPushing(true);
    setPushResults(null);
    try {
      const results = await clusterApi.pushAll();
      setPushResults(results);
    } finally {
      setPushing(false);
    }
  };

  const handlePushNode = async (id: string) => {
    const result = await clusterApi.pushNode(id);
    setPushResults([result]);
  };

  const handleSaveHome = async (conn: HomeConnection) => {
    const saved = await clusterApi.setHome(conn);
    setHome(saved);
  };

  if (loading) {
    return <div className={styles.clusterPage}>{t('common.loading')}</div>;
  }

  return (
    <div className={styles.clusterPage}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('nav.cluster_settings')}</h1>
        <div className={styles.pageActions}>
          <Button variant="primary" size="sm" onClick={handlePushAll} disabled={pushing}>
            {pushing ? t('common.loading') : t('cluster.push_all')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowAddModal(true)}>
            {t('cluster.add_node')}
          </Button>
        </div>
      </div>

      {pushResults && pushResults.length > 0 && (
        <Card title={t('cluster.push_results')}>
          <div className={styles.pushResults}>
            {pushResults.map((r) => (
              <div
                key={r.nodeId}
                className={[
                  styles.pushResult,
                  r.status === 'success'
                    ? styles.pushResultSuccess
                    : r.status === 'failed'
                      ? styles.pushResultFailed
                      : styles.pushResultSkipped,
                ].join(' ')}
              >
                <span>{r.nodeId}:</span>
                <span>{r.status}</span>
                {r.error && <span>— {r.error}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title={t('cluster.nodes')}>
        {nodes.length === 0 ? (
          <div className={styles.emptyState}>{t('cluster.no_nodes')}</div>
        ) : (
          <div className={styles.nodeList}>
            {nodes.map((node) => (
              <div key={node.id} className={styles.nodeCard}>
                <div className={styles.nodeInfo}>
                  <span className={styles.nodeName}>{node.name || node.id}</span>
                  <div className={styles.nodeMeta}>
                    <span className={`${styles.badge} ${styles.badgeType}`}>{node.type}</span>
                    <span className={`${styles.badge} ${styles.badgeRole}`}>{node.role}</span>
                    <span className={`${styles.badge} ${statusClass(node.status)}`}>
                      {node.status}
                    </span>
                    {node.endpoint && <span>{node.endpoint}</span>}
                    {(() => {
                      const state = livenessState(node);
                      const ago = timeAgo(node.lastSeenAt);
                      return (
                        <span
                          className={`${styles.badge} ${livenessClass(state)}`}
                          title={node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : ''}
                        >
                          {state === 'unknown' ? t('cluster.heartbeat_none') : `${t('cluster.heartbeat')} ${ago}`}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                <div className={styles.nodeActions}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handlePushNode(node.id)}
                    disabled={node.status !== 'active' || node.type === 'cpa-home'}
                  >
                    {t('cluster.push')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(node.id)}>
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={t('cluster.home_connection')}>
        <HomeConnectionForm home={home} onSave={handleSaveHome} />
      </Card>

      {showAddModal && (
        <AddNodeModal
          onClose={() => setShowAddModal(false)}
          onSaved={async () => {
            setShowAddModal(false);
            await loadData();
          }}
        />
      )}
    </div>
  );
}

function HomeConnectionForm({
  home,
  onSave,
}: {
  home: HomeConnection;
  onSave: (conn: HomeConnection) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState(home.baseUrl ?? '');
  const [managementKey, setManagementKey] = useState(home.managementKey ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBaseUrl(home.baseUrl ?? '');
    setManagementKey(home.managementKey ?? '');
  }, [home]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ baseUrl: baseUrl.trim(), managementKey: managementKey.trim() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.homeSection}>
      <div className={styles.homeForm}>
        <div className={styles.inputGroup}>
          <label className={styles.label}>{t('cluster.home_base_url')}</label>
          <input
            className={styles.input}
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://127.0.0.1:8327"
          />
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.label}>{t('cluster.home_management_key')}</label>
          <input
            className={styles.input}
            type="password"
            value={managementKey}
            onChange={(e) => setManagementKey(e.target.value)}
          />
        </div>
        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

function AddNodeModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<UpsertNodeRequest>({
    id: '',
    type: 'cpa',
    role: 'follower',
    endpoint: '',
    status: 'active',
    name: '',
    managementKey: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!form.id.trim()) {
      setError(t('cluster.error_id_required'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await clusterApi.upsertNode({
        ...form,
        id: form.id.trim(),
        endpoint: (form.endpoint ?? '').trim(),
        name: (form.name ?? '').trim(),
        managementKey: (form.managementKey ?? '').trim(),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={true} title={t('cluster.add_node')} onClose={onClose}>
      <div className={styles.homeSection}>
        <div className={styles.inputGroup}>
          <label className={styles.label}>{t('cluster.node_id')}</label>
          <input
            className={styles.input}
            value={form.id}
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
          />
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.label}>{t('cluster.node_name')}</label>
          <input
            className={styles.input}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.label}>{t('cluster.node_type')}</label>
          <select
            className={styles.input}
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ClusterNodeType }))}
          >
            {NODE_TYPES.map((nt) => (
              <option key={nt} value={nt}>
                {nt}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.label}>{t('cluster.node_role')}</label>
          <select
            className={styles.input}
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as ClusterNodeRole }))}
          >
            {NODE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.label}>{t('cluster.node_status')}</label>
          <select
            className={styles.input}
            value={form.status}
            onChange={(e) =>
              setForm((f) => ({ ...f, status: e.target.value as ClusterNodeStatus }))
            }
          >
            {NODE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.label}>{t('cluster.node_endpoint')}</label>
          <input
            className={styles.input}
            value={form.endpoint}
            onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
            placeholder="http://192.168.1.10:8317"
          />
        </div>
        <div className={styles.inputGroup}>
          <label className={styles.label}>{t('cluster.node_management_key')}</label>
          <input
            className={styles.input}
            type="password"
            value={form.managementKey}
            onChange={(e) => setForm((f) => ({ ...f, managementKey: e.target.value }))}
          />
        </div>
        {error && <span style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</span>}
        <div className={styles.pageActions}>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
