export const colors = {
  base: {
    bg: '#0a0a0a',
    bgElevated: '#111111',
    bgElevated2: '#181818',
    panel: '#141414',
    panelHover: '#1a1a1a',
    border: '#2a2a2a',
    borderStrong: '#333333',
    divider: '#222222',
  },

  text: {
    primary: '#e8e8e8',
    secondary: '#a0a0a0',
    muted: '#6a6a6a',
    inverse: '#0a0a0a',
  },

  accent: {
    primary: '#3b82f6',
    primaryHover: '#2563eb',
    primaryActive: '#1d4ed8',
    primaryMuted: '#3b82f633',
    secondary: '#64748b',
  },

  semantic: {
    success: '#22c55e',
    successMuted: '#22c55e33',
    warning: '#f59e0b',
    warningMuted: '#f59e0b33',
    error: '#ef4444',
    errorMuted: '#ef444433',
    info: '#3b82f6',
    infoMuted: '#3b82f633',
  },

  track: {
    video: '#3b82f6',
    voiceover: '#8b5cf6',
    music: '#22c55e',
    sfx: '#f59e0b',
    ambient: '#06b6d4',
    text: '#ec4899',
  },

  overlay: {
    backdrop: 'rgba(0, 0, 0, 0.6)',
    tooltip: '#1a1a1a',
    tooltipBorder: '#333333',
  },

  focus: {
    ring: '#3b82f6',
    ringOffset: '#0a0a0a',
  },
} as const;

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = {
  none: 0,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 9999,
} as const;

export const typography = {
  fontFamily: {
    ui: '"JetBrains Mono", "Fira Code", "SF Mono", "Monaco", "Inconsolata", monospace',
    mono: '"JetBrains Mono", "Fira Code", "SF Mono", "Monaco", "Inconsolata", monospace',
  },
  fontSize: {
    xs: ['10px', { lineHeight: '14px', letterSpacing: '0.02em' }],
    sm: ['11px', { lineHeight: '16px', letterSpacing: '0.01em' }],
    base: ['13px', { lineHeight: '20px', letterSpacing: '0' }],
    lg: ['14px', { lineHeight: '22px', letterSpacing: '0' }],
    xl: ['16px', { lineHeight: '24px', letterSpacing: '-0.01em' }],
    '2xl': ['18px', { lineHeight: '28px', letterSpacing: '-0.02em' }],
    '3xl': ['22px', { lineHeight: '32px', letterSpacing: '-0.02em' }],
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

export const shadows = {
  none: 'none',
  sm: '0 1px 2px rgba(0,0,0,0.3)',
  md: '0 4px 8px rgba(0,0,0,0.4)',
  lg: '0 8px 24px rgba(0,0,0,0.5)',
  xl: '0 16px 48px rgba(0,0,0,0.6)',
  inset: 'inset 0 1px 2px rgba(0,0,0,0.3)',
  focus: '0 0 0 2px #3b82f6, 0 0 0 4px #0a0a0a',
} as const;

export const transitions = {
  fast: '120ms ease-out',
  normal: '180ms ease-out',
  slow: '250ms ease-out',
} as const;

export const zIndex = {
  base: 1,
  dropdown: 10,
  sticky: 20,
  modal: 30,
  popover: 40,
  tooltip: 50,
  toast: 60,
} as const;

export const controlHeight = {
  sm: 24,
  md: 30,
  lg: 36,
} as const;

export const controlWidth = {
  label: 80,
  input: 120,
  select: 160,
} as const;

export const layout = {
  headerHeight: 40,
  panelHeaderHeight: 28,
  trackHeight: 32,
  rulerHeight: 28,
  labelWidth: 128,
  rightPanelWidth: 288,
  assetsMinWidth: 160,
  assetsMaxWidth: 400,
  pixelsPerSecond: 80,
} as const;

export type ColorScale = typeof colors;
export type SpacingScale = typeof spacing;
export type RadiusScale = typeof radius;
export type TypographyScale = typeof typography;
export type ShadowsScale = typeof shadows;
export type TransitionsScale = typeof transitions;
export type ZIndexScale = typeof zIndex;
export type ControlHeightScale = typeof controlHeight;
export type ControlWidthScale = typeof controlWidth;
export type LayoutScale = typeof layout;

export const designTokens = {
  colors,
  spacing,
  radius,
  typography,
  shadows,
  transitions,
  zIndex,
  controlHeight,
  controlWidth,
  layout,
} as const;