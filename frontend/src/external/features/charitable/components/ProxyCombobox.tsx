import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useDebounce } from '@/external/hooks/useDebounce';
import { IconCheck, IconLoader2, IconSearch } from '../../serviceProviders/ui/icons';
import { listProxies } from '../api';
import { getProxyTypeLabel, type ProxyDetail } from '../types';
import styles from '../CharitablePage.module.scss';

interface ProxyComboboxProps {
  baseUrl: string;
  managementKey?: string;
  value: string;
  selectedProxyId?: number;
  onInputChange: (value: string) => void;
  onSelect: (proxy: ProxyDetail) => void;
  placeholder: string;
  ariaLabel: string;
  noResultsLabel: string;
  loadingLabel: string;
  disabled?: boolean;
}

const VIEWPORT_MARGIN = 8;
const DROPDOWN_OFFSET = 4;
const DROPDOWN_MAX_HEIGHT = 280;
const DROPDOWN_Z_INDEX = 2020;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const resolveDropdownStyle = (element: HTMLElement): CSSProperties => {
  const rect = element.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(rect.width, Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2));
  const left = clamp(rect.left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN));
  const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_MARGIN - DROPDOWN_OFFSET;
  const spaceAbove = rect.top - VIEWPORT_MARGIN - DROPDOWN_OFFSET;
  const direction = spaceBelow >= DROPDOWN_MAX_HEIGHT || spaceBelow >= spaceAbove ? 'down' : 'up';
  const maxHeight = Math.max(96, Math.min(DROPDOWN_MAX_HEIGHT, direction === 'down' ? spaceBelow : spaceAbove));

  return direction === 'down'
    ? { position: 'fixed', top: rect.bottom + DROPDOWN_OFFSET, left, width, maxHeight, zIndex: DROPDOWN_Z_INDEX }
    : { position: 'fixed', bottom: viewportHeight - rect.top + DROPDOWN_OFFSET, left, width, maxHeight, zIndex: DROPDOWN_Z_INDEX };
};

export function ProxyCombobox({
  baseUrl,
  managementKey,
  value,
  selectedProxyId,
  onInputChange,
  onSelect,
  placeholder,
  ariaLabel,
  noResultsLabel,
  loadingLabel,
  disabled = false,
}: ProxyComboboxProps) {
  const generatedId = useId();
  const inputId = `${generatedId}-input`;
  const listboxId = `${generatedId}-listbox`;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ProxyDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);
  const query = useDebounce(value.trim(), 250);

  const loadProxies = useCallback(async (search: string, signal: AbortSignal) => {
    setLoading(true);
    try {
      const result = await listProxies(
        baseUrl,
        { page: 1, page_size: 20, status: 1, ...(search ? { search } : {}) },
        managementKey,
      );
      if (signal.aborted) return;
      setItems(result.items ?? []);
      setHighlightedIndex(0);
    } catch {
      if (!signal.aborted) setItems([]);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [baseUrl, managementKey]);

  const updateDropdownStyle = useCallback(() => {
    if (wrapRef.current) setDropdownStyle(resolveDropdownStyle(wrapRef.current));
  }, []);

  const scheduleDropdownStyleUpdate = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateDropdownStyle();
    });
  }, [updateDropdownStyle]);

  useLayoutEffect(() => {
    if (!open) return;
    updateDropdownStyle();
    window.addEventListener('resize', scheduleDropdownStyleUpdate);
    window.addEventListener('scroll', scheduleDropdownStyleUpdate, true);
    return () => {
      window.removeEventListener('resize', scheduleDropdownStyleUpdate);
      window.removeEventListener('scroll', scheduleDropdownStyleUpdate, true);
    };
  }, [open, scheduleDropdownStyleUpdate, updateDropdownStyle]);

  useEffect(() => () => {
    if (rafRef.current !== null && typeof window !== 'undefined') window.cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  useEffect(() => {
    if (!open || !baseUrl || disabled) return;
    const controller = new AbortController();
    void loadProxies(query, controller.signal);
    return () => controller.abort();
  }, [baseUrl, disabled, loadProxies, open, query]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const selectProxy = useCallback((proxy: ProxyDetail) => {
    onSelect(proxy);
    setOpen(false);
  }, [onSelect]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setHighlightedIndex((index) => Math.min(index + 1, Math.max(0, items.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setHighlightedIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter' && open && items[highlightedIndex]) {
      event.preventDefault();
      selectProxy(items[highlightedIndex]);
      return;
    }
    if (event.key === 'Escape') setOpen(false);
    if (event.key === 'Tab') setOpen(false);
  };

  const dropdown = open && dropdownStyle ? (
    <div
      ref={dropdownRef}
      id={listboxId}
      role="listbox"
      className={styles.providerComboDropdown}
      style={dropdownStyle}
      aria-label={ariaLabel}
    >
      {loading ? (
        <div className={styles.providerComboEmpty}><IconLoader2 className={styles.probePending} size={14} /> {loadingLabel}</div>
      ) : items.length > 0 ? items.map((proxy, index) => {
        const selected = proxy.id === selectedProxyId;
        return (
          <button
            key={proxy.id}
            id={`${generatedId}-option-${index}`}
            type="button"
            role="option"
            aria-selected={selected}
            className={`${styles.providerComboOption} ${index === highlightedIndex ? styles.providerComboOptionHighlighted : ''} ${selected ? styles.providerComboOptionSelected : ''}`}
            onMouseEnter={() => setHighlightedIndex(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectProxy(proxy)}
          >
            <span className={styles.providerComboText}>
              <span className={styles.providerComboMain}>{proxy.proxy_info || `#${proxy.id}`}</span>
              <span className={styles.providerComboMeta}>#{proxy.id} · {getProxyTypeLabel(proxy.proxy_type)} · {proxy.proxy_value}</span>
            </span>
            {selected ? <IconCheck size={14} /> : null}
          </button>
        );
      }) : (
        <div className={styles.providerComboEmpty}>{noResultsLabel}</div>
      )}
    </div>
  ) : null;

  return (
    <>
      <div ref={wrapRef} className={styles.providerCombo}>
        <IconSearch size={15} className={styles.providerComboSearchIcon} />
        <input
          id={inputId}
          type="text"
          className={styles.providerComboInput}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && items[highlightedIndex] ? `${generatedId}-option-${highlightedIndex}` : undefined}
          aria-label={ariaLabel}
          disabled={disabled}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onChange={(event) => {
            if (disabled) return;
            onInputChange(event.target.value);
            setHighlightedIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {dropdown && (typeof document === 'undefined' ? dropdown : createPortal(dropdown, document.body))}
    </>
  );
}
