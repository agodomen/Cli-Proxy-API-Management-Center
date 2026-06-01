import type { SVGProps } from 'react';
import { IconX } from '@/components/ui/icons';

// Re-export Center icons needed by external components so sibling files can import from './icons'.
export { IconX };

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

const baseSvgProps: SVGProps<SVGSVGElement> = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

const sidebarSvgProps: SVGProps<SVGSVGElement> = {
  ...baseSvgProps,
  strokeWidth: 1.72,
  strokeLinecap: 'square',
  strokeLinejoin: 'miter',
  strokeMiterlimit: 10,
};

export function IconChevronRight({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function IconCrosshair({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="22" y1="12" x2="18" y2="12" />
      <line x1="6" y1="12" x2="2" y2="12" />
      <line x1="12" y1="6" x2="12" y2="2" />
      <line x1="12" y1="22" x2="12" y2="18" />
    </svg>
  );
}

export function IconMoreVertical({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

export function IconFilter({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

export function IconSidebarUsage({ size = 20, ...props }: IconProps) {
  return (
    <svg {...sidebarSvgProps} width={size} height={size} {...props}>
      <path d="M3.5 20h17" />
      <rect x="5" y="13" width="3.5" height="7" rx="0.5" />
      <rect
        x="10.25"
        y="7"
        width="3.5"
        height="13"
        rx="0.5"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <rect x="15.5" y="10" width="3.5" height="10" rx="0.5" />
    </svg>
  );
}
