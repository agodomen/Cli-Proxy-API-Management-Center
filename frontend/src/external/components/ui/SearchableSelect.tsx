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
import { IconChevronDown, IconSearch } from '@/components/ui/icons';
export interface SelectOption {
  value: string;
  label: string;
  /** Native tooltip shown on hover for the trigger (selected) and each option. */
  title?: string;
}
import styles from './SearchableSelect.module.scss';

export interface SearchableSelectProps {
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  id?: string;
}

const VIEWPORT_MARGIN = 8;
const DROPDOWN_OFFSET = 6;
const DROPDOWN_MAX_HEIGHT = 280;
const DROPDOWN_Z_INDEX = 2010;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

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
    0,
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

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  className,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  fullWidth = true,
  size = 'md',
  id,
}: SearchableSelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const listboxId = `${selectId}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);
  const isOpen = open && !disabled;

  const filteredOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(trimmed) || opt.value.toLowerCase().includes(trimmed)
    );
  }, [options, query]);

  useEffect(() => {
    if (!open || disabled) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [disabled, open]);

  const updateDropdownStyle = useCallback(() => {
    if (!wrapRef.current) return;
    setDropdownStyle(resolveDropdownStyle(wrapRef.current));
  }, []);

  const scheduleDropdownStyleUpdate = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateDropdownStyle();
    });
  }, [updateDropdownStyle]);

  useLayoutEffect(() => {
    if (!isOpen) {
      if (rafRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    updateDropdownStyle();

    const handleViewportChange = () => {
      scheduleDropdownStyleUpdate();
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && wrapRef.current
        ? new ResizeObserver(() => {
            scheduleDropdownStyleUpdate();
          })
        : null;

    if (resizeObserver && wrapRef.current) {
      resizeObserver.observe(wrapRef.current);
    }

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      resizeObserver?.disconnect();
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isOpen, scheduleDropdownStyleUpdate, updateDropdownStyle]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setHighlightedIndex(-1);
      const focusTimer = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(focusTimer);
    }
  }, [isOpen]);

  const selectedIndex = useMemo(
    () => options.findIndex((opt) => opt.value === value),
    [options, value]
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const displayText = selected?.label ?? placeholder ?? '';
  const isPlaceholder = !selected && placeholder;

  const resolvedHighlightedIndex = highlightedIndex >= filteredOptions.length ? -1 : highlightedIndex;

  const commitSelection = useCallback(
    (option: SelectOption) => {
      onChange(option.value);
      setOpen(false);
      setHighlightedIndex(-1);
    },
    [onChange]
  );

  const moveHighlight = useCallback(
    (direction: 1 | -1) => {
      if (filteredOptions.length === 0) return;
      setHighlightedIndex((current) => {
        const base = current < 0 ? (direction === 1 ? -1 : 0) : current;
        return (base + direction + filteredOptions.length) % filteredOptions.length;
      });
    },
    [filteredOptions.length]
  );

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (!isOpen) {
            setOpen(true);
            return;
          }
          moveHighlight(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          if (!isOpen) {
            setOpen(true);
            return;
          }
          moveHighlight(-1);
          return;
        case 'Home':
          if (filteredOptions.length === 0) return;
          event.preventDefault();
          setHighlightedIndex(0);
          return;
        case 'End':
          if (filteredOptions.length === 0) return;
          event.preventDefault();
          setHighlightedIndex(filteredOptions.length - 1);
          return;
        case 'Enter':
          if (isOpen && resolvedHighlightedIndex >= 0) {
            event.preventDefault();
            commitSelection(filteredOptions[resolvedHighlightedIndex]);
          }
          return;
        case 'Escape':
          if (!isOpen) return;
          event.preventDefault();
          setOpen(false);
          return;
        case 'Tab':
          if (isOpen) setOpen(false);
          return;
        default:
          return;
      }
    },
    [commitSelection, filteredOptions, isOpen, moveHighlight, resolvedHighlightedIndex]
  );

  useEffect(() => {
    if (!isOpen || resolvedHighlightedIndex < 0) return;
    const highlightedOption = document.getElementById(
      `${selectId}-option-${resolvedHighlightedIndex}`
    );
    highlightedOption?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, resolvedHighlightedIndex, selectId]);

  const dropdown =
    isOpen && dropdownStyle ? (
      <div
        ref={dropdownRef}
        className={styles.dropdown}
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        style={dropdownStyle}
      >
        <div className={styles.searchBox}>
          <span className={styles.searchIcon} aria-hidden="true">
            <IconSearch size={14} />
          </span>
          <input
            ref={inputRef}
            type="text"
            className={styles.searchInput}
            value={query}
            placeholder={searchPlaceholder ?? ''}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightedIndex(-1);
            }}
            onKeyDown={handleSearchKeyDown}
            aria-label={ariaLabel}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className={styles.optionList}>
          {filteredOptions.length === 0 ? (
            <div className={styles.empty}>—</div>
          ) : (
            filteredOptions.map((opt, index) => {
              const active = opt.value === value;
              const highlighted = index === resolvedHighlightedIndex;
              return (
                <button
                  key={opt.value}
                  id={`${selectId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  title={opt.title}
                  className={`${styles.option} ${active ? styles.optionActive : ''} ${highlighted ? styles.optionHighlighted : ''}`.trim()}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => commitSelection(opt)}
                >
                  {opt.label}
                </button>
              );
            })
          )}
        </div>
      </div>
    ) : null;

  return (
    <>
      <div
        className={`${styles.wrap} ${fullWidth ? styles.wrapFullWidth : ''} ${className ?? ''}`}
        ref={wrapRef}
      >
        <button
          id={selectId}
          type="button"
          className={`${styles.trigger} ${size === 'sm' ? styles.triggerSm : ''}`.trim()}
          onClick={disabled ? undefined : () => setOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={
            isOpen && resolvedHighlightedIndex >= 0
              ? `${selectId}-option-${resolvedHighlightedIndex}`
              : undefined
          }
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          title={selected?.title ?? ariaLabel}
          disabled={disabled}
        >
          <span className={`${styles.triggerText} ${isPlaceholder ? styles.placeholder : ''}`}>
            {displayText}
          </span>
          <span className={styles.triggerIcon} aria-hidden="true">
            <IconChevronDown size={14} />
          </span>
        </button>
      </div>
      {dropdown &&
        (typeof document === 'undefined' ? dropdown : createPortal(dropdown, document.body))}
    </>
  );
}
