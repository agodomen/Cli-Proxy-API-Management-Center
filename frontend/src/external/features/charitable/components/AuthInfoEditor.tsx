import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthInfo, ProtocolKey } from '../types';
import { PROTOCOL_PRIMES } from '../types';
import { buildAuthInfo, parseAuthInfo } from '../authInfo';
import { computeApiType, parseApiType } from '../utils';
import { ParamEditor } from './ParamEditor/ParamEditor';
import { formatParamObject, tryParseParamObject } from './ParamEditor/paramUtils';
import styles from '../CharitablePage.module.scss';

const ALL_PROTOCOLS = Object.keys(PROTOCOL_PRIMES) as ProtocolKey[];
const CREDENTIAL_TYPES: AuthInfo['credential_type'][] = [
  'api_key',
  'service_account',
  'oauth2',
  'oidc',
  'api_key_set',
];

const CORE_KEYS = new Set([
  'schema_version',
  'credential_type',
  'api_type',
  'protocols',
]);

interface AuthInfoEditorProps {
  value: string;
  onChange: (value: string) => void;
  onValidityChange?: (valid: boolean) => void;
  authType?: number;
}

function credentialTypeToAuthType(type: AuthInfo['credential_type']): number {
  switch (type) {
    case 'service_account':
      return 2;
    case 'oauth2':
      return 3;
    case 'oidc':
      return 4;
    case 'api_key_set':
      return 5;
    default:
      return 1;
  }
}

function extractExtraFields(info: AuthInfo): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(info)) {
    if (CORE_KEYS.has(key)) continue;
    extra[key] = item;
  }
  return extra;
}

function composeAuthInfo(
  authType: number,
  protocols: ProtocolKey[],
  extra: Record<string, unknown>,
  existing?: string
): string {
  return buildAuthInfo(authType, protocols, existing, extra);
}

export function AuthInfoEditor({
  value,
  onChange,
  onValidityChange,
  authType,
}: AuthInfoEditorProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'visual' | 'json'>('visual');
  const [jsonDraft, setJsonDraft] = useState(value || '{}');
  const [jsonError, setJsonError] = useState('');

  const parsed = useMemo(() => parseAuthInfo(value), [value]);
  const protocols = useMemo(() => {
    if (Array.isArray(parsed.protocols) && parsed.protocols.length > 0) {
      return parsed.protocols.filter((item): item is ProtocolKey =>
        ALL_PROTOCOLS.includes(item as ProtocolKey)
      );
    }
    return parseApiType(parsed.api_type);
  }, [parsed]);
  const extraObject = useMemo(() => extractExtraFields(parsed), [parsed]);
  const extraJSON = useMemo(() => formatParamObject(extraObject), [extraObject]);
  const resolvedAuthType = authType && authType > 0
    ? authType
    : credentialTypeToAuthType(parsed.credential_type);

  useEffect(() => {
    if (tab === 'json') return;
    // visual mode: value always comes from controlled compose, treat as valid object
    onValidityChange?.(true);
  }, [tab, value, onValidityChange]);

  useEffect(() => {
    if (tab !== 'json') return;
    setJsonDraft(value || '{}');
  }, [tab, value]);

  const emitVisual = (
    nextProtocols: ProtocolKey[],
    nextCredentialType: AuthInfo['credential_type'],
    nextExtra: Record<string, unknown>
  ) => {
    const nextAuthType = authType && authType > 0
      ? authType
      : credentialTypeToAuthType(nextCredentialType);
    const next = composeAuthInfo(nextAuthType, nextProtocols, {
      ...nextExtra,
      credential_type: nextCredentialType,
    }, value);
    onChange(next);
    onValidityChange?.(true);
    setJsonError('');
  };

  const toggleProtocol = (key: ProtocolKey) => {
    const next = protocols.includes(key)
      ? protocols.filter((item) => item !== key)
      : [...protocols, key];
    if (next.length === 0) return;
    emitVisual(next, parsed.credential_type, extraObject);
  };

  const handleCredentialType = (type: AuthInfo['credential_type']) => {
    emitVisual(protocols.length ? protocols : ['openai'], type, extraObject);
  };

  const handleExtraChange = (raw: string) => {
    const parsedExtra = tryParseParamObject(raw);
    if (!parsedExtra) {
      onValidityChange?.(false);
      return;
    }
    emitVisual(protocols.length ? protocols : ['openai'], parsed.credential_type, parsedExtra);
  };

  const handleJsonChange = (raw: string) => {
    setJsonDraft(raw);
    try {
      const obj = JSON.parse(raw || '{}') as unknown;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        setJsonError(t('charitable.authInfo.invalidJson'));
        onValidityChange?.(false);
        return;
      }
      const next = parseAuthInfo(JSON.stringify(obj));
      if (!next.api_type || next.api_type < 1) {
        setJsonError(t('charitable.authInfo.apiTypeRequired'));
        onValidityChange?.(false);
        return;
      }
      // Normalize through buildAuthInfo so secrets are stripped and api_type/protocols stay consistent.
      const nextProtocols =
        Array.isArray(next.protocols) && next.protocols.length > 0
          ? next.protocols.filter((item): item is ProtocolKey =>
              ALL_PROTOCOLS.includes(item as ProtocolKey)
            )
          : parseApiType(next.api_type);
      const composed = composeAuthInfo(
        authType && authType > 0 ? authType : credentialTypeToAuthType(next.credential_type),
        nextProtocols.length ? nextProtocols : parseApiType(next.api_type || 2),
        extractExtraFields(next),
        JSON.stringify(next)
      );
      setJsonError('');
      onValidityChange?.(true);
      onChange(composed);
    } catch {
      setJsonError(t('charitable.authInfo.invalidJson'));
      onValidityChange?.(false);
    }
  };

  return (
    <div className={styles.authInfoEditor}>
      <div className={styles.authInfoToolbar}>
        <div className={styles.authInfoTabs}>
          <button
            type="button"
            className={tab === 'visual' ? styles.authInfoTabActive : styles.authInfoTab}
            onClick={() => {
              setTab('visual');
              onValidityChange?.(true);
            }}
          >
            {t('charitable.authInfo.visual')}
          </button>
          <button
            type="button"
            className={tab === 'json' ? styles.authInfoTabActive : styles.authInfoTab}
            onClick={() => {
              setJsonDraft(value || '{}');
              setTab('json');
            }}
          >
            JSON
          </button>
        </div>
        <span className={styles.fieldHint}>api_type = {computeApiType(protocols.length ? protocols : ['openai'])}</span>
      </div>

      {tab === 'visual' ? (
        <div className={styles.authInfoVisual}>
          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.authInfo.credentialType')}</label>
            <select
              className={styles.input}
              value={parsed.credential_type || 'api_key'}
              onChange={(event) =>
                handleCredentialType(event.target.value as AuthInfo['credential_type'])
              }
              disabled={Boolean(authType && authType > 0)}
            >
              {CREDENTIAL_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`charitable.authInfo.credentialTypes.${type}`)}
                </option>
              ))}
            </select>
            {authType && authType > 0 ? (
              <span className={styles.fieldHint}>
                {t('charitable.authInfo.credentialTypeLocked', { type: resolvedAuthType })}
              </span>
            ) : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.key.apiType')} *</label>
            <div className={styles.checkboxGroup}>
              {ALL_PROTOCOLS.map((key) => (
                <label key={key} className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={protocols.includes(key)}
                    onChange={() => toggleProtocol(key)}
                  />
                  {t(`charitable.key.protocols.${key}`)}
                </label>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('charitable.authInfo.extraFields')}</label>
            <ParamEditor
              value={extraJSON}
              onChange={handleExtraChange}
              onValidityChange={onValidityChange}
            />
            <span className={styles.fieldHint}>{t('charitable.authInfo.extraFieldsHint')}</span>
          </div>
        </div>
      ) : (
        <div className={styles.field}>
          <textarea
            className={styles.textarea}
            rows={12}
            value={jsonDraft}
            onChange={(event) => handleJsonChange(event.target.value)}
            spellCheck={false}
          />
          {jsonError ? <p className={styles.fieldError}>{jsonError}</p> : null}
        </div>
      )}
    </div>
  );
}
