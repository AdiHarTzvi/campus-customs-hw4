// Small brand pieces shared across the site: the shield monogram and color swatches.

export function Crest({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`crest ${className}`}
      width={size}
      height={size * 1.15}
      viewBox="0 0 40 46"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 1.5 37.5 7v15.5C37.5 34 29.6 41.3 20 44.5 10.4 41.3 2.5 34 2.5 22.5V7L20 1.5Z" fill="var(--navy-900)" />
      <path
        d="M20 4.6 34.6 9.2v13.3c0 9.6-6.5 15.9-14.6 18.8-8.1-2.9-14.6-9.2-14.6-18.8V9.2L20 4.6Z"
        fill="none"
        stroke="var(--desert-400)"
        strokeWidth="1.4"
      />
      <text
        x="20"
        y="28.5"
        textAnchor="middle"
        fontFamily="var(--serif)"
        fontWeight="700"
        fontSize="15"
        fill="var(--desert-300)"
      >
        CC
      </text>
    </svg>
  )
}

// Database color names -> swatch colors. Unknown names fall back to a neutral swatch.
const SWATCHES: Record<string, string> = {
  navy: '#14284b',
  'navy blue': '#14284b',
  'dark navy': '#0e1d38',
  blue: '#2f63b4',
  'royal blue': '#2457b8',
  'light blue': '#9cc4ea',
  white: '#ffffff',
  'off-white': '#f4f0e6',
  cream: '#f3ead2',
  'heather gray': '#b8bcc2',
  'light heather gray': '#cfd2d6',
  'dark heather gray': '#6b7078',
  gray: '#9aa0a6',
  grey: '#9aa0a6',
  'light gray': '#cdd1d5',
  'dark gray': '#5f646b',
  charcoal: '#3d4249',
  'charcoal gray': '#3d4249',
  black: '#1a1a1a',
  red: '#c0392b',
  maroon: '#7a1f2b',
  green: '#2f7a4f',
  'dark green': '#1f5537',
  yellow: '#e9c33c',
  gold: '#c9a227',
  orange: '#e07b2e',
  pink: '#e8a1b6',
  'dusty coral': '#d98b7a',
  coral: '#e8846f',
  purple: '#6b4c9a',
  brown: '#7b5537',
  tan: '#c9a77c',
  multicolor: 'conic-gradient(#c0392b, #e9c33c, #2f7a4f, #2f63b4, #c0392b)',
}

export function swatchFor(color: string): string {
  return SWATCHES[color.trim().toLowerCase()] ?? '#d9d4c7'
}

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: swatchFor(color) }} aria-hidden="true" />
}
