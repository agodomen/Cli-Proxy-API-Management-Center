import type { SVGProps } from 'react';

// Self-contained icon bundle for serviceProviders feature.
// Reuses CPAMC icons where possible; adds only the missing ones from source project.

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

export function IconLoader2({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export function IconCheckCircle2({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function IconAlertTriangle({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function IconCheck({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconX({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function IconPlus({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

export function IconPencil({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function IconTrash2({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

export function IconSearch({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function IconEye({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconEyeOff({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

export function IconDownload({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

export function IconUpload({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}

export function IconFileText({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

export function IconCopy({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function IconRefreshCw({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

export function IconTransfer({ size = 20, ...props }: IconProps) {
  return (
    <svg {...baseSvgProps} width={size} height={size} {...props}>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}
