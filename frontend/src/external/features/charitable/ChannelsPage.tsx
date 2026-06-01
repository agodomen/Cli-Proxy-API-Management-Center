import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useUsageServiceStore } from '@/external/stores/useUsageServiceStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { listChannels, createChannel, updateChannel, deleteChannel } from './api';
import { getStatusInfo } from './types';
import type { Channel } from './types';
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
} from '../serviceProviders/ui/icons';
import { ParamEditor } from './components/ParamEditor/ParamEditor';
import styles from './CharitablePage.module.scss';

export function ChannelsPage({ headerCenter }: { headerCenter?: ReactNode }) {
  const { t } = useTranslation();
  const baseUrl = useUsageServiceStore((s) => s.serviceBase);
  const managementKey = useAuthStore((s) => s.managementKey);
  const { showNotification } = useNotificationStore();

  const [items, setItems] = useState<Channel[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<number | 'all'>(1);
  const [loading, setLoading] = useState(false);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit'>('create');
  const [editTarget, setEditTarget] = useState<Channel | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formStatus, setFormStatus] = useState(1);
  const [formParam, setFormParam] = useState('{}');
  const [formParamValid, setFormParamValid] = useState(true);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);

  const pageSize = 20;

  const fetchData = useCallback(async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const result = await listChannels(
        baseUrl,
        { page, page_size: pageSize, search: search || undefined, status: statusFilter },
        managementKey
      );
      setItems(result.items || []);
      setTotalItems(result.total_items);
    } catch {
      showNotification(t('charitable.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, managementKey, page, search, statusFilter, showNotification, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setSheetMode('create');
    setEditTarget(null);
    setFormName('');
    setFormDescription('');
    setFormUrl('');
    setFormStatus(1);
    setFormParam('{}');
    setFormParamValid(true);
    setSheetOpen(true);
  };

  const openEdit = (ch: Channel) => {
    setSheetMode('edit');
    setEditTarget(ch);
    setFormName(ch.channel_name);
    setFormDescription(ch.description || '');
    setFormUrl(ch.url || '');
    setFormStatus(ch.status);
    setFormParam(ch.param || '{}');
    setFormParamValid(true);
    setSheetOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!baseUrl || !formName.trim() || !formParamValid) return;
    setSubmitting(true);
    try {
      const input = {
        channel_name: formName.trim(),
        description: formDescription.trim(),
        url: formUrl.trim() || undefined,
        status: formStatus,
        param: formParam,
      };
      if (sheetMode === 'create') {
        await createChannel(baseUrl, input, managementKey);
        showNotification(t('charitable.createSuccess'), 'success');
      } else if (editTarget) {
        await updateChannel(baseUrl, editTarget.channel_id, input, managementKey);
        showNotification(t('charitable.updateSuccess'), 'success');
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
      await deleteChannel(baseUrl, deleteTarget.channel_id, managementKey);
      showNotification(t('charitable.deleteSuccess'), 'success');
      setDeleteTarget(null);
      fetchData();
    } catch {
      showNotification(t('charitable.deleteFailed'), 'error');
    }
  };

  const totalPages = Math.ceil(totalItems / pageSize);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('charitable.channels')}</h1>
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
            placeholder={t('charitable.channel.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
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
            <TableHead>{t('charitable.channel.name')}</TableHead>
            <TableHead>{t('charitable.channel.description')}</TableHead>
            <TableHead>{t('charitable.channel.url')}</TableHead>
            <TableHead>{t('charitable.status')}</TableHead>
            <TableHead>{t('charitable.createdAt')}</TableHead>
            <TableHead alignRight>{t('charitable.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && !loading ? (
            <TableRow>
              <TableCell colSpan={7} className={styles.emptyCell}>
                {t('charitable.emptyList')}
              </TableCell>
            </TableRow>
          ) : (
            items.map((ch) => {
              const si = getStatusInfo(ch.status);
              return (
                <TableRow key={ch.channel_id}>
                  <TableCell className={styles.mono}>{ch.channel_id}</TableCell>
                  <TableCell>{ch.channel_name}</TableCell>
                  <TableCell>{ch.description || '—'}</TableCell>
                  <TableCell className={styles.mono}>{ch.url || '—'}</TableCell>
                  <TableCell>
                    <span className={styles[`badge_${si.color}`]}>{t(si.label)}</span>
                  </TableCell>
                  <TableCell className={styles.mono}>{ch.create_at}</TableCell>
                  <TableCell alignRight>
                    <button
                      className={styles.iconBtn}
                      onClick={() => openEdit(ch)}
                      title={t('charitable.edit')}
                    >
                      <IconPencil size={16} />
                    </button>
                    <button
                      className={styles.iconBtnDanger}
                      onClick={() => setDeleteTarget(ch)}
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

      {/* Create / Edit Sheet */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={sheetMode === 'create' ? t('charitable.create') : t('charitable.edit')}
        size="lg"
        footer={
          <>
            <button
              type="submit"
              form="channel-form"
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
        <form id="channel-form" className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.channel.name')} *</label>
            <input
              className={styles.input}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={t('charitable.channel.namePlaceholder')}
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.channel.url')}</label>
            <input
              className={styles.input}
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder={t('charitable.channel.urlPlaceholder')}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.channel.description')}</label>
            <textarea
              className={styles.input}
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder={t('charitable.channel.descriptionPlaceholder')}
              rows={3}
            />
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
            <label className={styles.label}>{t('charitable.channel.param')}</label>
            <ParamEditor
              value={formParam}
              onChange={setFormParam}
              onValidityChange={setFormParamValid}
            />
          </div>
        </form>
      </Sheet>

      {/* Delete Confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t('charitable.delete')}
      >
        <p>{t('charitable.deleteConfirm')}</p>
        {deleteTarget && <p className={styles.deleteTargetName}>{deleteTarget.channel_name}</p>}
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
