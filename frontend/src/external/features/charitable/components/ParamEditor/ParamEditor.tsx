import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconTrash2 } from '../../../serviceProviders/ui/icons';
import {
  formatParamObject,
  inferParamValueType,
  isSafeParamKey,
  mergeParamObjects,
  parseParamValue,
  tryParseParamObject,
  type ParamObject,
  type ParamValueType,
} from './paramUtils';
import styles from './ParamEditor.module.scss';

interface ParamEditorProps {
  value: string;
  onChange: (value: string) => void;
  onValidityChange?: (valid: boolean) => void;
  inheritedParams?: ParamObject;
  inheritedLabel?: string;
}

type ParamPath = Array<string | number>;
const TYPE_OPTIONS: ParamValueType[] = ['string', 'number', 'boolean', 'array', 'map', 'null'];
const COMMON_KEYS = ['User-Agent', 'base_url', 'api_key', 'model'];

export function ParamEditor({ value, onChange, onValidityChange, inheritedParams = {}, inheritedLabel }: ParamEditorProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'visual' | 'json'>('visual');
  const [jsonDraft, setJsonDraft] = useState(value || '{}');
  const [error, setError] = useState('');
  const localParams = useMemo(() => tryParseParamObject(value), [value]);
  const effectiveParams = useMemo(() => mergeParamObjects(inheritedParams, localParams ?? {}), [inheritedParams, localParams]);

  useEffect(() => onValidityChange?.(localParams !== null), [localParams, onValidityChange]);

  const updateObject = (next: ParamObject) => {
    setError('');
    onValidityChange?.(true);
    onChange(formatParamObject(next));
  };

  const updateAtPath = (path: ParamPath, nextValue: unknown) => {
    if (!localParams) return;
    updateObject(setAtPath(localParams, path, nextValue) as ParamObject);
  };

  const removeAtPath = (path: ParamPath) => {
    if (!localParams) return;
    updateObject(deleteAtPath(localParams, path) as ParamObject);
  };

  const renameAtPath = (path: ParamPath, nextKey: string) => {
    if (!localParams || typeof path[path.length - 1] !== 'string') return;
    const normalized = nextKey.trim();
    const parent = getAtPath(localParams, path.slice(0, -1));
    const oldKey = path[path.length - 1] as string;
    if (!isSafeParamKey(normalized)) return setError(t('charitable.paramEditor.invalidKey'));
    if (normalized !== oldKey && isMap(parent) && Object.prototype.hasOwnProperty.call(parent, normalized)) {
      return setError(t('charitable.paramEditor.duplicateKey'));
    }
    updateObject(renameMapKeyAtPath(localParams, path, normalized));
  };

  const addChild = (path: ParamPath, key: string, type: ParamValueType) => {
    if (!localParams) return false;
    const container = getAtPath(localParams, path);
    const initialValue = defaultValueForType(type);
    if (Array.isArray(container)) {
      updateAtPath(path, [...container, initialValue]);
      return true;
    }
    const normalized = key.trim();
    if (!isMap(container) || !isSafeParamKey(normalized)) {
      setError(t('charitable.paramEditor.invalidKey'));
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(container, normalized)) {
      setError(t('charitable.paramEditor.duplicateKey'));
      return false;
    }
    updateAtPath(path, { ...container, [normalized]: initialValue });
    return true;
  };

  const handleJsonChange = (raw: string) => {
    setJsonDraft(raw);
    const parsed = tryParseParamObject(raw);
    onValidityChange?.(parsed !== null);
    if (parsed) onChange(raw);
  };

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          <button type="button" className={tab === 'visual' ? styles.activeTab : styles.tab} onClick={() => { setJsonDraft(value || '{}'); onValidityChange?.(localParams !== null); setTab('visual'); }}>{t('charitable.paramEditor.visual')}</button>
          <button type="button" className={tab === 'json' ? styles.activeTab : styles.tab} onClick={() => { setJsonDraft(value || '{}'); setTab('json'); }}>JSON</button>
        </div>
        <span className={styles.count}>{t('charitable.paramEditor.count', { count: Object.keys(localParams ?? {}).length })}</span>
      </div>

      {tab === 'visual' ? (
        !localParams ? <button type="button" className={styles.repairButton} onClick={() => updateObject({})}>{t('charitable.paramEditor.repairJson')}</button> : (
          <div className={styles.tree}>
            <div className={styles.headerRow}><span>{t('charitable.paramEditor.key')}</span><span>{t('charitable.paramEditor.type')}</span><span>{t('charitable.paramEditor.value')}</span><span /></div>
            {Object.entries(localParams).map(([key, childValue]) => (
              <ParamNode key={`${key}:${JSON.stringify(childValue)}`} path={[key]} name={key} value={childValue} depth={0} onUpdate={updateAtPath} onRemove={removeAtPath} onRename={renameAtPath} onAddChild={addChild} />
            ))}
            <AddChildRow container="map" depth={0} onAdd={(key, type) => addChild([], key, type)} />
          </div>
        )
      ) : (
        <div><textarea className={styles.jsonEditor} value={jsonDraft} onChange={event => handleJsonChange(event.target.value)} spellCheck={false} />{!tryParseParamObject(jsonDraft) && <p className={styles.error}>{t('charitable.paramEditor.invalidJson')}</p>}</div>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <details className={styles.preview}><summary>{t('charitable.paramEditor.preview')}</summary>{inheritedLabel && <p className={styles.inheritedHint}>{t('charitable.paramEditor.inheritedFrom', { source: inheritedLabel })}</p>}<pre>{JSON.stringify(effectiveParams, null, 2)}</pre></details>
    </div>
  );
}

interface ParamNodeProps {
  path: ParamPath;
  name: string | number;
  value: unknown;
  depth: number;
  onUpdate: (path: ParamPath, value: unknown) => void;
  onRemove: (path: ParamPath) => void;
  onRename: (path: ParamPath, key: string) => void;
  onAddChild: (path: ParamPath, key: string, type: ParamValueType) => boolean;
}

function ParamNode({ path, name, value, depth, onUpdate, onRemove, onRename, onAddChild }: ParamNodeProps) {
  const { t } = useTranslation();
  const actualType = inferParamValueType(value);
  const [keyDraft, setKeyDraft] = useState(String(name));
  const [valueDraft, setValueDraft] = useState(primitiveText(value));
  const [collapsed, setCollapsed] = useState(false);
  const isContainer = actualType === 'array' || actualType === 'map';

  const changeType = (type: ParamValueType) => {
    const next = defaultValueForType(type);
    setValueDraft(primitiveText(next));
    onUpdate(path, next);
  };

  const commitPrimitive = () => {
    try { onUpdate(path, parseParamValue(valueDraft, actualType)); } catch { setValueDraft(primitiveText(value)); }
  };

  const children = actualType === 'array'
    ? (value as unknown[]).map((child, index) => [index, child] as const)
    : actualType === 'map' ? Object.entries(value as ParamObject) : [];

  return (
    <div className={styles.node}>
      <div className={styles.nodeRow} style={{ '--tree-depth': depth } as CSSProperties}>
        <div className={styles.keyCell}>
          <span className={styles.branch}>{depth ? '↳' : ''}</span>
          {isContainer && (
            <button
              type="button"
              className={styles.collapseButton}
              onClick={() => setCollapsed(current => !current)}
              aria-expanded={!collapsed}
              title={t(collapsed ? 'charitable.paramEditor.expand' : 'charitable.paramEditor.collapse')}
            >
              <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
            </button>
          )}
          {typeof name === 'number' ? <span className={styles.index}>[{name}]</span> : <input value={keyDraft} onChange={event => setKeyDraft(event.target.value)} onBlur={() => onRename(path, keyDraft)} />}
          {typeof name === 'string' && COMMON_KEYS.includes(name) && <span className={styles.common}>{t('charitable.paramEditor.common')}</span>}
        </div>
        <select value={actualType} onChange={event => changeType(event.target.value as ParamValueType)}>{TYPE_OPTIONS.map(type => <option key={type} value={type}>{type}</option>)}</select>
        <div className={styles.valueCell}>
          {actualType === 'boolean' ? <select value={String(value)} onChange={event => onUpdate(path, event.target.value === 'true')}><option value="true">true</option><option value="false">false</option></select>
            : actualType === 'null' ? <span className={styles.nullValue}>null</span>
            : isContainer ? <span className={styles.containerSummary}>{actualType === 'array' ? `[${children.length}]` : `{${children.length}}`}</span>
            : <input value={valueDraft} onChange={event => setValueDraft(event.target.value)} onBlur={commitPrimitive} />}
        </div>
        <button type="button" className={styles.removeButton} onClick={() => onRemove(path)} title={t('charitable.paramEditor.remove')}><IconTrash2 size={15} /></button>
      </div>
      {isContainer && !collapsed && (
        <>
          {children.map(([childName, childValue]) => <ParamNode key={`${String(childName)}:${JSON.stringify(childValue)}`} path={[...path, childName]} name={childName} value={childValue} depth={depth + 1} onUpdate={onUpdate} onRemove={onRemove} onRename={onRename} onAddChild={onAddChild} />)}
          <AddChildRow container={actualType} depth={depth + 1} onAdd={(key, type) => onAddChild(path, key, type)} />
        </>
      )}
    </div>
  );
}

function AddChildRow({ container, depth, onAdd }: { container: 'array' | 'map'; depth: number; onAdd: (key: string, type: ParamValueType) => boolean }) {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [type, setType] = useState<ParamValueType>('string');
  const add = () => { if (onAdd(key, type)) setKey(''); };
  return <div className={styles.addRow} style={{ '--tree-depth': depth } as CSSProperties}>
    <div className={styles.keyCell}><span className={styles.branch}>{depth ? '↳' : ''}</span>{container === 'map' ? <input value={key} onChange={event => setKey(event.target.value)} placeholder={t('charitable.paramEditor.newKey')} list="charitable-common-param-keys" /> : <span className={styles.index}>{t('charitable.paramEditor.nextItem')}</span>}</div>
    <select value={type} onChange={event => setType(event.target.value as ParamValueType)}>{TYPE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select>
    <span className={styles.addHint}>{type === 'array' || type === 'map' ? t('charitable.paramEditor.nestable') : ''}</span>
    <button type="button" className={styles.addButton} onClick={add} title={t('charitable.paramEditor.add')}><IconPlus size={16} /></button>
    <datalist id="charitable-common-param-keys">{COMMON_KEYS.map(option => <option key={option} value={option} />)}</datalist>
  </div>;
}

function defaultValueForType(type: ParamValueType): unknown {
  if (type === 'string') return '';
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'array') return [];
  if (type === 'map') return {};
  return null;
}
function primitiveText(value: unknown): string { return value === null ? '' : String(value); }
function isMap(value: unknown): value is ParamObject { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function getAtPath(root: unknown, path: ParamPath): unknown { return path.reduce<unknown>((current, segment) => Array.isArray(current) || isMap(current) ? current[segment as never] : undefined, root); }
function setAtPath(root: unknown, path: ParamPath, value: unknown): unknown {
  if (!path.length) return value;
  const [head, ...tail] = path;
  if (Array.isArray(root)) { const next = [...root]; next[head as number] = setAtPath(next[head as number], tail, value); return next; }
  const map = isMap(root) ? root : {}; return { ...map, [head]: setAtPath(map[String(head)], tail, value) };
}
function deleteAtPath(root: unknown, path: ParamPath): unknown {
  const [head, ...tail] = path;
  if (Array.isArray(root)) { const next = [...root]; if (!tail.length) next.splice(head as number, 1); else next[head as number] = deleteAtPath(next[head as number], tail); return next; }
  const next = { ...(isMap(root) ? root : {}) }; if (!tail.length) delete next[String(head)]; else next[String(head)] = deleteAtPath(next[String(head)], tail); return next;
}
function renameMapKeyAtPath(root: ParamObject, path: ParamPath, nextKey: string): ParamObject {
  const parentPath = path.slice(0, -1); const oldKey = String(path[path.length - 1]); const parent = getAtPath(root, parentPath);
  if (!isMap(parent)) return root;
  const renamed: ParamObject = {}; Object.entries(parent).forEach(([key, value]) => { renamed[key === oldKey ? nextKey : key] = value; });
  return setAtPath(root, parentPath, renamed) as ParamObject;
}
