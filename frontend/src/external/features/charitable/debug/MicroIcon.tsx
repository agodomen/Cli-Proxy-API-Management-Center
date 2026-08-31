import { useId, type ReactNode, type SVGProps } from 'react';

export type MicroIconTone = 'neutral' | 'blue' | 'green' | 'red' | 'ink';

type MicroIconProps = {
  size?: number;
  tone?: MicroIconTone;
  active?: boolean;
  spinning?: boolean;
  children: ReactNode;
} & Omit<SVGProps<SVGSVGElement>, 'children'>;

const TONE: Record<MicroIconTone, string> = {
  neutral: 'currentColor',
  blue: '#3b82f6',
  green: '#16a34a',
  red: '#dc2626',
  ink: '#111827',
};

/**
 * Light skeuomorphic / micro-textured icon shell:
 * soft plate, top highlight, fine grain, restrained tone colors.
 */
export function MicroIcon({
  size = 16,
  tone = 'neutral',
  active = false,
  spinning = false,
  children,
  className,
  ...props
}: MicroIconProps) {
  const uid = useId().replace(/:/g, '');
  const stroke = TONE[tone];
  const glow = `color-mix(in srgb, ${stroke === 'currentColor' ? '#6b7280' : stroke} 28%, transparent)`;

  return (
    <span
      className={className}
      style={{
        animation: spinning ? 'debugMicroSpin 0.8s linear infinite' : undefined,
        display: 'inline-grid',
        placeItems: 'center',
        width: size + 10,
        height: size + 10,
        borderRadius: 999,
        position: 'relative',
        flexShrink: 0,
        color: stroke === 'currentColor' ? undefined : stroke,
        background: active
          ? `radial-gradient(120% 120% at 30% 20%, color-mix(in srgb, ${stroke === 'currentColor' ? '#3b82f6' : stroke} 18%, #fff), color-mix(in srgb, ${stroke === 'currentColor' ? '#3b82f6' : stroke} 8%, transparent))`
          : 'radial-gradient(120% 120% at 30% 18%, color-mix(in srgb, #fff 55%, transparent), color-mix(in srgb, #000 6%, transparent))',
        boxShadow: active
          ? `inset 0 1px 0 color-mix(in srgb, #fff 55%, transparent), inset 0 -1px 0 color-mix(in srgb, #000 10%, transparent), 0 0 0 1px color-mix(in srgb, ${stroke === 'currentColor' ? '#3b82f6' : stroke} 28%, transparent), 0 4px 10px ${glow}`
          : 'inset 0 1px 0 color-mix(in srgb, #fff 45%, transparent), inset 0 -1px 0 color-mix(in srgb, #000 8%, transparent), 0 0 0 1px color-mix(in srgb, currentColor 10%, transparent)',
      }}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.85}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          filter: active
            ? `drop-shadow(0 1px 0 color-mix(in srgb, #fff 40%, transparent)) drop-shadow(0 1px 2px ${glow})`
            : 'drop-shadow(0 1px 0 color-mix(in srgb, #fff 35%, transparent))',
          opacity: 0.96,
        }}
        {...props}
      >
        <defs>
          <filter id={`${uid}-grain`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="2"
              stitchTiles="stitch"
              result="noise"
            />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.2  0 0 0 0 0.2  0 0 0 0 0.2  0 0 0 0.12 0"
            />
            <feComposite operator="in" in2="SourceGraphic" />
          </filter>
        </defs>
        <g filter={`url(#${uid}-grain)`} opacity={0.5}>
          {children}
        </g>
        <g>{children}</g>
      </svg>
    </span>
  );
}

export function Path(props: SVGProps<SVGPathElement>) {
  return <path {...props} />;
}

export function Circle(props: SVGProps<SVGCircleElement>) {
  return <circle {...props} />;
}

export function GlyphPulse() {
  return (
    <>
      <Path d="M3 12h4l2.2-5 4.1 10 2.2-5H21" />
      <Path d="M5 5.5A9 9 0 0 1 19 7" opacity=".55" />
      <Path d="M19 18.5A9 9 0 0 1 5 17" opacity=".55" />
    </>
  );
}

export function GlyphSliders() {
  return (
    <>
      <Path d="M4 6h10" />
      <Path d="M18 6h2" />
      <Circle cx="16" cy="6" r="2" />
      <Path d="M4 12h2" />
      <Path d="M10 12h10" />
      <Circle cx="8" cy="12" r="2" />
      <Path d="M4 18h8" />
      <Path d="M16 18h4" />
      <Circle cx="14" cy="18" r="2" />
    </>
  );
}

export function Polyline(props: SVGProps<SVGPolylineElement>) {
  return <polyline {...props} />;
}

export function Line(props: SVGProps<SVGLineElement>) {
  return <line {...props} />;
}

export function Rect(props: SVGProps<SVGRectElement>) {
  return <rect {...props} />;
}

export function GlyphData() {
  return (
    <>
      <Path d="M4 19V5" />
      <Path d="M4 19h16" />
      <Path d="M8 15v-4" />
      <Path d="M12 15V8" />
      <Path d="M16 15v-6" />
    </>
  );
}

export function GlyphStats() {
  return (
    <>
      <Path d="M4 19V9" />
      <Path d="M10 19V5" />
      <Path d="M16 19v-7" />
      <Path d="M20 19v-3" />
      <Path d="M3 5h5" />
    </>
  );
}

export function GlyphRun() {
  return <Path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />;
}

export function GlyphRefresh() {
  return (
    <>
      <Path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <Path d="M21 3v5h-5" />
      <Path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <Path d="M3 21v-5h5" />
    </>
  );
}

export function GlyphFormat() {
  return (
    <>
      <Path d="M4 7h16" />
      <Path d="M4 12h10" />
      <Path d="M4 17h13" />
    </>
  );
}

export function GlyphClear() {
  return (
    <>
      <Path d="M3 6h18" />
      <Path d="M8 6V4h8v2" />
      <Path d="M19 6l-1 14H6L5 6" />
    </>
  );
}

export function GlyphCopy() {
  return (
    <>
      <Rect x="9" y="9" width="11" height="11" rx="2" />
      <Path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  );
}

export function GlyphExport() {
  return (
    <>
      <Path d="M12 3v11" />
      <Path d="m7 9 5 5 5-5" />
      <Path d="M5 19h14" />
    </>
  );
}

export function GlyphDb() {
  return (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <Path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <Path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </>
  );
}

export function GlyphSpinner() {
  return <Path d="M21 12a9 9 0 1 1-6.219-8.56" />;
}

export function GlyphApi() {
  return (
    <>
      <Path d="M4 8h4l2 8 4-16 2 8h4" />
      <Path d="M3 19h18" />
    </>
  );
}

export function GlyphKey() {
  return (
    <>
      <Circle cx="8" cy="15" r="4" />
      <Path d="M12 15h8" />
      <Path d="M17 13v4" />
    </>
  );
}

export function GlyphMeta() {
  return (
    <>
      <Path d="M4 6h16" />
      <Path d="M4 12h16" />
      <Path d="M4 18h16" />
      <Circle cx="8" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <Circle cx="8" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <Circle cx="8" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </>
  );
}
