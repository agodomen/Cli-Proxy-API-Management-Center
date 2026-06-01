import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconSearch, IconX } from '../../serviceProviders/ui/icons';
import type { Provider } from '../types';
import styles from '../CharitablePage.module.scss';

type ProviderComboboxBaseProps = {
  providers: Provider[];
  placeholder: string;
  allLabel?: string;
  emptyLabel: string;
  selectAllMatchesLabel?: (count: number) => string;
  selectedCountLabel?: (count: number) => string;
  ariaLabel?: string;
  className?: string;
  allowEmpty?: boolean;
};

type ProviderComboboxSingleProps = ProviderComboboxBaseProps & {
  multiple?: false;
  value: number | '';
  onChange: (value: number | '') => void;
};

type ProviderComboboxMultiProps = ProviderComboboxBaseProps & {
  multiple: true;
  value: number[];
  onChange: (value: number[]) => void;
};

export type ProviderComboboxProps = ProviderComboboxSingleProps | ProviderComboboxMultiProps;

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
  const left = clamp(
    rect.left,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)
  );
  const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_MARGIN - DROPDOWN_OFFSET;
  const spaceAbove = rect.top - VIEWPORT_MARGIN - DROPDOWN_OFFSET;
  const direction = spaceBelow >= DROPDOWN_MAX_HEIGHT || spaceBelow >= spaceAbove ? 'down' : 'up';
  const maxHeight = Math.max(
    96,
    Math.min(DROPDOWN_MAX_HEIGHT, direction === 'down' ? spaceBelow : spaceAbove)
  );

  return direction === 'down'
    ? {
        position: 'fixed',
        top: rect.bottom + DROPDOWN_OFFSET,
        left,
        width,
        maxHeight,
        zIndex: DROPDOWN_Z_INDEX,
      }
    : {
        position: 'fixed',
        bottom: viewportHeight - rect.top + DROPDOWN_OFFSET,
        left,
        width,
        maxHeight,
        zIndex: DROPDOWN_Z_INDEX,
      };
};

const normalize = (value: string) => value.trim().toLowerCase();

const providerMatches = (provider: Provider, query: string) => {
  const needle = normalize(query);
  if (!needle) return true;
  return [provider.provider_name, String(provider.provider_id), provider.base_url].some((part) =>
    normalize(part || '').includes(needle)
  );
};

function isMulti(props: ProviderComboboxProps): props is ProviderComboboxMultiProps {
  return props.multiple === true;
}

export function ProviderCombobox(props: ProviderComboboxProps) {
  const {
    providers,
    placeholder,
    allLabel,
    emptyLabel,
    selectAllMatchesLabel,
    selectedCountLabel,
    ariaLabel,
    className,
    allowEmpty = true,
  } = props;
  const multi = isMulti(props);
  const selectedIds = useMemo(() => {
    if (multi) return props.value;
    return props.value === '' ? [] : [props.value];
    // Keep a stable array identity across renders for single-select.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi, multi ? props.value.join(',') : props.value]);

  const generatedId = useId();
  const inputId = `${generatedId}-input`;
  const listboxId = `${generatedId}-listbox`;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);

  const selectedProviders = useMemo(
    () => providers.filter((provider) => selectedIds.includes(provider.provider_id)),
    [providers, selectedIds]
  );

  const visibleProviders = useMemo(
    () => providers.filter((provider) => providerMatches(provider, query)),
    [providers, query]
  );

  const options = useMemo(
    () => [
      ...(allowEmpty && !normalize(query) && !multi ? [{ kind: 'empty' as const }] : []),
      ...visibleProviders.map((provider) => ({ kind: 'provider' as const, provider })),
    ],
    [allowEmpty, multi, query, visibleProviders]
  );

  const closedLabel = useMemo(() => {
    if (selectedProviders.length === 0) return '';
    if (!multi) return selectedProviders[0]?.provider_name ?? '';
    if (selectedProviders.length === 1) return selectedProviders[0].provider_name;
    if (selectedCountLabel) return selectedCountLabel(selectedProviders.length);
    return selectedProviders
      .slice(0, 2)
      .map((provider) => provider.provider_name)
      .join(', ')
      .concat(selectedProviders.length > 2 ? ` +${selectedProviders.length - 2}` : '');
  }, [multi, selectedCountLabel, selectedProviders]);

  const inputValue = open ? query : closedLabel;
  const activeDescendant =
    open && options[highlightedIndex] ? `${generatedId}-option-${highlightedIndex}` : undefined;

  const updateDropdownStyle = useCallback(() => {
    if (!wrapRef.current) return;
    setDropdownStyle(resolveDropdownStyle(wrapRef.current));
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
    if (!open) {
      if (rafRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    updateDropdownStyle();

    window.addEventListener('resize', scheduleDropdownStyleUpdate);
    window.addEventListener('scroll', scheduleDropdownStyleUpdate, true);
    return () => {
      window.removeEventListener('resize', scheduleDropdownStyleUpdate);
      window.removeEventListener('scroll', scheduleDropdownStyleUpdate, true);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [open, scheduleDropdownStyleUpdate, updateDropdownStyle]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    const highlightedOption = document.getElementById(`${generatedId}-option-${highlightedIndex}`);
    highlightedOption?.scrollIntoView({ block: 'nearest' });
  }, [generatedId, highlightedIndex, open]);

  const emitSingle = useCallback(
    (next: number | '') => {
      if (!multi) props.onChange(next);
    },
    [multi, props]
  );

  const emitMulti = useCallback(
    (next: number[]) => {
      if (multi) props.onChange(Array.from(new Set(next)));
    },
    [multi, props]
  );

  const toggleProvider = useCallback(
    (providerId: number) => {
      if (multi) {
        const exists = selectedIds.includes(providerId);
        emitMulti(
          exists ? selectedIds.filter((id) => id !== providerId) : [...selectedIds, providerId]
        );
        return;
      }
      emitSingle(providerId);
      setOpen(false);
      setQuery('');
      window.setTimeout(() => inputRef.current?.blur(), 0);
    },
    [emitMulti, emitSingle, multi, selectedIds]
  );

  const selectAllMatches = useCallback(() => {
    if (!multi || visibleProviders.length === 0) return;
    const next = Array.from(
      new Set([...selectedIds, ...visibleProviders.map((provider) => provider.provider_id)])
    );
    emitMulti(next);
    setQuery('');
    setHighlightedIndex(0);
  }, [emitMulti, multi, selectedIds, visibleProviders]);

  const commitOption = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option) return;
      if (option.kind === 'empty') {
        if (multi) emitMulti([]);
        else emitSingle('');
        setOpen(false);
        setQuery('');
        window.setTimeout(() => inputRef.current?.blur(), 0);
        return;
      }
      toggleProvider(option.provider.provider_id);
      if (multi) {
        setQuery('');
        inputRef.current?.focus();
      }
    },
    [emitMulti, emitSingle, multi, options, toggleProvider]
  );

  const clearSelection = useCallback(() => {
    if (multi) emitMulti([]);
    else emitSingle('');
    setQuery('');
    setOpen(true);
    inputRef.current?.focus();
  }, [emitMulti, emitSingle, multi]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          setHighlightedIndex(0);
          setOpen(true);
          return;
        }
        setHighlightedIndex((index) => Math.min(index + 1, Math.max(0, options.length - 1)));
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) {
          setHighlightedIndex(0);
          setOpen(true);
          return;
        }
        setHighlightedIndex((index) => Math.max(index - 1, 0));
        return;
      case 'Enter':
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        // Multi mode: Enter with a query selects all fuzzy matches at once.
        if (multi && normalize(query) && visibleProviders.length > 0) {
          selectAllMatches();
          return;
        }
        commitOption(highlightedIndex);
        return;
      case 'Backspace':
        if (multi && !query && selectedIds.length > 0) {
          event.preventDefault();
          emitMulti(selectedIds.slice(0, -1));
        }
        return;
      case 'Escape':
        if (!open) return;
        event.preventDefault();
        setOpen(false);
        setQuery('');
        return;
      case 'Tab':
        setOpen(false);
        setQuery('');
        return;
      default:
        return;
    }
  };

  const dropdown =
    open && dropdownStyle ? (
      <div
        ref={dropdownRef}
        id={listboxId}
        role="listbox"
        className={styles.providerComboDropdown}
        style={dropdownStyle}
        aria-label={ariaLabel}
        aria-multiselectable={multi || undefined}
      >
        {multi && normalize(query) && visibleProviders.length > 0 ? (
          <button
            type="button"
            className={styles.providerComboSelectAll}
            onMouseDown={(event) => event.preventDefault()}
            onClick={selectAllMatches}
          >
            {selectAllMatchesLabel
              ? selectAllMatchesLabel(visibleProviders.length)
              : `Select all matches (${visibleProviders.length})`}
          </button>
        ) : null}
        {options.length > 0 ? (
          options.map((option, index) => {
            const highlighted = index === highlightedIndex;
            if (option.kind === 'empty') {
              const selected = selectedIds.length === 0;
              return (
                <button
                  key="empty"
                  id={`${generatedId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`${styles.providerComboOption} ${highlighted ? styles.providerComboOptionHighlighted : ''} ${selected ? styles.providerComboOptionSelected : ''}`}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commitOption(index)}
                >
                  <span className={styles.providerComboMain}>{allLabel ?? placeholder}</span>
                  {selected ? <IconCheck size={14} /> : null}
                </button>
              );
            }

            const selected = selectedIds.includes(option.provider.provider_id);
            return (
              <button
                key={option.provider.provider_id}
                id={`${generatedId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={`${styles.providerComboOption} ${highlighted ? styles.providerComboOptionHighlighted : ''} ${selected ? styles.providerComboOptionSelected : ''}`}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commitOption(index)}
              >
                <span className={styles.providerComboText}>
                  <span className={styles.providerComboMain}>{option.provider.provider_name}</span>
                  <span className={styles.providerComboMeta}>
                    #{option.provider.provider_id}
                    {option.provider.base_url ? ` · ${option.provider.base_url}` : ''}
                  </span>
                </span>
                {selected ? <IconCheck size={14} /> : null}
              </button>
            );
          })
        ) : (
          <div className={styles.providerComboEmpty}>{emptyLabel}</div>
        )}
      </div>
    ) : null;

  return (
    <>
      <div
        ref={wrapRef}
        className={`${styles.providerCombo} ${multi ? styles.providerComboMulti : ''} ${className ?? ''}`.trim()}
      >
        <IconSearch size={15} className={styles.providerComboSearchIcon} />
        {multi && selectedProviders.length > 0 && open ? (
          <div className={styles.providerComboChips}>
            {selectedProviders.map((provider) => (
              <span key={provider.provider_id} className={styles.providerComboChip}>
                <span className={styles.providerComboChipText}>{provider.provider_name}</span>
                <button
                  type="button"
                  className={styles.providerComboChipRemove}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggleProvider(provider.provider_id)}
                  aria-label={`Remove ${provider.provider_name}`}
                >
                  <IconX size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className={styles.providerComboInput}
          value={inputValue}
          placeholder={selectedIds.length > 0 && !open ? closedLabel || placeholder : placeholder}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={activeDescendant}
          aria-label={ariaLabel}
          onFocus={() => {
            setQuery('');
            setHighlightedIndex(0);
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlightedIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {allowEmpty && selectedIds.length > 0 ? (
          <button
            type="button"
            className={styles.providerComboClear}
            onClick={clearSelection}
            aria-label={allLabel ?? placeholder}
          >
            <IconX size={14} />
          </button>
        ) : null}
      </div>
      {dropdown &&
        (typeof document === 'undefined' ? dropdown : createPortal(dropdown, document.body))}
    </>
  );
}
