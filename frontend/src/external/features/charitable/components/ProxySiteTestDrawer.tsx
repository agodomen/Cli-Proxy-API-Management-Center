import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProxyConnectivityTestResult } from '../api';
import { getProxyTypeLabel } from '../types';
import { Sheet } from '../../serviceProviders/ui/Sheet';
import { IconCheckCircle2, IconLoader2, IconX } from '../../serviceProviders/ui/icons';
import styles from './ProxySiteTestDrawer.module.scss';

interface ProxySiteTestDrawerProps {
  open: boolean;
  loading: boolean;
  results: ProxyConnectivityTestResult[];
  onClose: () => void;
}

const CATEGORY_ORDER = ['global_ai', 'global_web', 'mainland_china'] as const;

export function ProxySiteTestDrawer({ open, loading, results, onClose }: ProxySiteTestDrawerProps) {
  const { t } = useTranslation();
  const [activeID, setActiveID] = useState<number | null>(null);

  const activeResult = results.find(result => result.id === activeID) ?? results[0];
  const groupedSites = useMemo(() => {
    if (!activeResult) return [];
    return CATEGORY_ORDER.map(category => ({
      category,
      sites: activeResult.sites.filter(site => site.category === category),
    })).filter(group => group.sites.length > 0);
  }, [activeResult]);
  const okCount = activeResult?.sites.filter(site => site.ok).length ?? 0;
  const totalCount = activeResult?.sites.length ?? 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('charitable.proxy.siteTestTitle')}
      description={t('charitable.proxy.siteTestDescription')}
      size="xl"
    >
      {loading ? (
        <div className={styles.loading}>
          <IconLoader2 size={24} />
          <span>{t('charitable.proxy.siteTesting')}</span>
        </div>
      ) : results.length === 0 ? (
        <div className={styles.empty}>{t('charitable.proxy.siteTestEmpty')}</div>
      ) : (
        <div className={`${styles.layout} ${results.length === 1 ? styles.layoutSingle : ''}`}>
          {results.length > 1 && (
            <div className={styles.proxyTabs}>
              {results.map(result => {
                const ok = result.sites.filter(site => site.ok).length;
                return (
                  <button
                    key={result.id}
                    type="button"
                    className={`${styles.proxyTab} ${result.id === activeResult?.id ? styles.proxyTabActive : ''}`}
                    onClick={() => setActiveID(result.id)}
                  >
                    <span>#{result.id} {result.proxy_info || t('charitable.proxy.unnamed')}</span>
                    <small>{result.supported ? `${ok}/${result.sites.length}` : t('charitable.proxy.unsupported')}</small>
                  </button>
                );
              })}
            </div>
          )}

          {activeResult && (
            <div className={styles.content}>
              <div className={styles.summary}>
                <div>
                  <strong>#{activeResult.id} {activeResult.proxy_info || t('charitable.proxy.unnamed')}</strong>
                  <span>{t(`charitable.proxy.types.${getProxyTypeLabel(activeResult.proxy_type)}`)}</span>
                </div>
                {activeResult.supported ? (
                  <span className={okCount === totalCount ? styles.summaryOK : styles.summaryWarning}>
                    {t('charitable.proxy.siteTestSummary', { ok: okCount, total: totalCount })}
                  </span>
                ) : (
                  <span className={styles.summaryError}>{t('charitable.proxy.unsupported')}</span>
                )}
              </div>

              {!activeResult.supported ? (
                <div className={styles.unsupported}>
                  {t('charitable.proxy.unsupportedDescription')}
                  {activeResult.error ? <code>{activeResult.error}</code> : null}
                </div>
              ) : (
                groupedSites.map(group => (
                  <section key={group.category} className={styles.group}>
                    <h3>{t(`charitable.proxy.siteCategories.${group.category}`)}</h3>
                    <div className={styles.siteList}>
                      {group.sites.map(site => (
                        <article key={site.key} className={styles.siteCard}>
                          <span className={site.ok ? styles.siteOK : styles.siteFailed}>
                            {site.ok ? <IconCheckCircle2 size={18} /> : <IconX size={18} />}
                          </span>
                          <div className={styles.siteMain}>
                            <div className={styles.siteHeader}>
                              <strong>{site.name}</strong>
                              <span>{site.ok ? `HTTP ${site.status_code}` : t('charitable.proxy.siteUnavailable')}</span>
                            </div>
                            <code title={site.url}>{site.url}</code>
                            {site.error ? <p title={site.error}>{site.error}</p> : null}
                          </div>
                          <span className={styles.latency}>{site.latency_ms} ms</span>
                        </article>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
