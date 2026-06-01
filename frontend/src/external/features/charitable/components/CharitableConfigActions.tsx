import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ProviderCpaSyncButton } from './ProviderCpaSyncButton';
import styles from './CharitableConfigActions.module.scss';

interface CharitableConfigActionsProps {
  keyId?: number | null;
  providerId?: number | null;
  onEditKey?: (keyId: number) => void;
  onEditProvider?: (providerId: number) => void;
}

const buildEditPath = (target: 'key' | 'provider', id: number) => {
  const params = new URLSearchParams({
    tab: target === 'key' ? 'keys' : 'providers',
    [target === 'key' ? 'editKeyId' : 'editProviderId']: String(id),
  });
  return `/charitable/token?${params.toString()}`;
};

export function CharitableConfigActions({
  keyId,
  providerId,
  onEditKey,
  onEditProvider,
}: CharitableConfigActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (!keyId && !providerId) return null;

  return (
    <div className={styles.actions}>
      {keyId ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onEditKey ? onEditKey(keyId) : navigate(buildEditPath('key', keyId))}
        >
          {t('charitable.operations.editKey')}
        </Button>
      ) : null}
      {providerId ? (
        <>
          <ProviderCpaSyncButton providerId={providerId} />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onEditProvider ? onEditProvider(providerId) : navigate(buildEditPath('provider', providerId))}
          >
            {t('charitable.operations.editProvider')}
          </Button>
        </>
      ) : null}
    </div>
  );
}
