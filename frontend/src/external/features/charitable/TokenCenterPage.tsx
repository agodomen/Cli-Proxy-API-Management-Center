import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router-dom';
import { KeysPage } from './KeysPage';
import { ProvidersPage } from './ProvidersPage';
import { ChannelsPage } from './ChannelsPage';
import { ProbeStatsPage } from './probe/ProbeStatsPage';
import { ProbePolicyPage } from './probe/ProbePolicyPage';
import { GlyphApi, GlyphData, GlyphKey, GlyphPulse, GlyphSliders, MicroIcon } from './debug/MicroIcon';
import styles from './CharitablePage.module.scss';
import debugStyles from './debug/DebugPage.module.scss';

type Tab = 'keys' | 'providers' | 'channels' | 'policy' | 'probe';

interface TokenTabsProps {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}

function TokenTabs({ activeTab, onChange }: TokenTabsProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.headerTabs} role="tablist">
      <div className={`${debugStyles.floatCapsule} ${styles.tabCapsule}`}>
        <div className={debugStyles.floatGroup}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'policy'}
            className={`${debugStyles.floatBtn} ${activeTab === 'policy' ? `${debugStyles.floatBtnActive} ${debugStyles.floatBtnBlue}` : ''}`}
            onClick={() => onChange('policy')}
          >
            <MicroIcon tone={activeTab === 'policy' ? 'blue' : 'neutral'} active={activeTab === 'policy'} size={15}>
              <GlyphSliders />
            </MicroIcon>
            <span className={debugStyles.floatBtnLabel}>{t('charitable.policy.nav')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'keys'}
            className={`${debugStyles.floatBtn} ${activeTab === 'keys' ? `${debugStyles.floatBtnActive} ${debugStyles.floatBtnBlue}` : ''}`}
            onClick={() => onChange('keys')}
          >
            <MicroIcon
              tone={activeTab === 'keys' ? 'blue' : 'neutral'}
              active={activeTab === 'keys'}
              size={15}
            >
              <GlyphKey />
            </MicroIcon>
            <span className={debugStyles.floatBtnLabel}>{t('charitable.keys')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'providers'}
            className={`${debugStyles.floatBtn} ${activeTab === 'providers' ? `${debugStyles.floatBtnActive} ${debugStyles.floatBtnBlue}` : ''}`}
            onClick={() => onChange('providers')}
          >
            <MicroIcon
              tone={activeTab === 'providers' ? 'blue' : 'neutral'}
              active={activeTab === 'providers'}
              size={15}
            >
              <GlyphApi />
            </MicroIcon>
            <span className={debugStyles.floatBtnLabel}>{t('charitable.providers')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'channels'}
            className={`${debugStyles.floatBtn} ${activeTab === 'channels' ? `${debugStyles.floatBtnActive} ${debugStyles.floatBtnBlue}` : ''}`}
            onClick={() => onChange('channels')}
          >
            <MicroIcon
              tone={activeTab === 'channels' ? 'blue' : 'neutral'}
              active={activeTab === 'channels'}
              size={15}
            >
              <GlyphData />
            </MicroIcon>
            <span className={debugStyles.floatBtnLabel}>{t('charitable.channels')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'probe'}
            className={`${debugStyles.floatBtn} ${activeTab === 'probe' ? `${debugStyles.floatBtnActive} ${debugStyles.floatBtnBlue}` : ''}`}
            onClick={() => onChange('probe')}
          >
            <MicroIcon
              tone={activeTab === 'probe' ? 'blue' : 'neutral'}
              active={activeTab === 'probe'}
              size={15}
            >
              <GlyphPulse />
            </MicroIcon>
            <span className={debugStyles.floatBtnLabel}>{t('charitable.probe.nav')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function TokenCenterPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedTab = useMemo<Tab>(() => {
    const tab = searchParams.get('tab');
    if (tab === 'keys' || tab === 'providers' || tab === 'channels' || tab === 'policy' || tab === 'probe') {
      return tab;
    }
    if (location.pathname.includes('/providers')) return 'providers';
    if (location.pathname.includes('/channels')) return 'channels';
    if (location.pathname.includes('/policy')) return 'policy';
    if (location.pathname.includes('/probe')) return 'probe';
    return 'keys';
  }, [location.pathname, searchParams]);

  const editKeyId = Number(searchParams.get('editKeyId')) || undefined;
  const editProviderId = Number(searchParams.get('editProviderId')) || undefined;

  const [activeTab, setActiveTab] = useState<Tab>(requestedTab);

  useEffect(() => {
    setActiveTab(requestedTab);
  }, [requestedTab]);

  const clearEditRequest = useCallback(() => {
    setSearchParams({ tab: activeTab }, { replace: true });
  }, [activeTab, setSearchParams]);

  const headerTabs = <TokenTabs activeTab={activeTab} onChange={setActiveTab} />;

  return (
    <div className={styles.tokenCenterPage}>
      <div className={styles.tabContent}>
        {activeTab === 'keys' && (
          <KeysPage
            headerCenter={headerTabs}
            editRequestId={editKeyId}
            onEditRequestHandled={clearEditRequest}
          />
        )}
        {activeTab === 'providers' && (
          <ProvidersPage
            headerCenter={headerTabs}
            editRequestId={editProviderId}
            onEditRequestHandled={clearEditRequest}
          />
        )}
        {activeTab === 'channels' && <ChannelsPage headerCenter={headerTabs} />}
        {activeTab === 'policy' && (
          <ProbePolicyPage headerCenter={headerTabs} />
        )}
        {activeTab === 'probe' && <ProbeStatsPage headerCenter={headerTabs} />}
      </div>
    </div>
  );
}
