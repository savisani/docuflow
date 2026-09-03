export const colors = {
  base: {
    bg: '#08080f',
    bgElevated: '#0e0e18',
    bgElevated2: '#12121e',
    panel: '#0c0c16',
    panelHover: 'rgba(139, 92, 246, 0.06)',
    border: 'rgba(139, 92, 246, 0.10)',
    borderStrong: 'rgba(139, 92, 246, 0.18)',
    borderFocus: 'rgba(224, 64, 160, 0.5)',
    divider: 'rgba(139, 92, 246, 0.08)',
  },

  text: {
    primary: '#f0f0f5',
    secondary: '#9898b0',
    muted: '#5c5c78',
    dim: '#3a3a50',
    inverse: '#08080f',
  },

  accent: {
    primary: '#e040a0',
    primaryHover: '#ec60b8',
    primaryActive: '#c83090',
    primaryMuted: 'rgba(224, 64, 160, 0.12)',
    secondary: '#a855f7',
    secondaryMuted: 'rgba(168, 85, 247, 0.10)',
  },

  semantic: {
    success: '#3ecf8e',
    successMuted: 'rgba(62, 207, 142, 0.12)',
    warning: '#f5a623',
    warningMuted: 'rgba(245, 166, 35, 0.12)',
    error: '#ef5350',
    errorMuted: 'rgba(239, 83, 80, 0.12)',
    info: '#a855f7',
    infoMuted: 'rgba(168, 85, 247, 0.12)',
  },

  track: {
    video: '#a855f7',
    voiceover: '#c084fc',
    music: '#3ecf8e',
    sfx: '#f5a623',
    ambient: '#5cc9d4',
    text: '#e040a0',
  },

  overlay: {
    backdrop: 'rgba(0, 0, 0, 0.75)',
    tooltip: '#181828',
    tooltipBorder: 'rgba(139, 92, 246, 0.15)',
  },

  focus: {
    ring: '#e040a0',
    ringOffset: '#08080f',
  },
} as const;

export const spacing = {
  0: 0,
  1: 2,
  2: 4,
  3: 6,
  4: 8,
  5: 10,
  6: 12,
  8: 16,
  10: 20,
  12: 24,
  16: 32,
  20: 40,
} as const;

export const radius = {
  none: 0,
  xs: 2,
  sm: 3,
  md: 4,
  lg: 6,
  xl: 8,
  full: 9999,
} as const;

export const typography = {
  fontFamily: {
    ui: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: '"JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace',
  },
  fontSize: {
    xs: ['10px', { lineHeight: '14px' }],
    sm: ['11px', { lineHeight: '16px' }],
    base: ['12px', { lineHeight: '18px' }],
    md: ['13px', { lineHeight: '20px' }],
    lg: ['14px', { lineHeight: '22px' }],
    xl: ['16px', { lineHeight: '24px' }],
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
  subtle: '0 1px 2px rgba(0,0,0,0.4)',
  medium: '0 4px 12px rgba(0,0,0,0.5)',
  heavy: '0 8px 24px rgba(0,0,0,0.6)',
  focus: '0 0 0 2px rgba(224, 64, 160, 0.4)',
  glow: '0 0 20px rgba(168, 85, 247, 0.15)',
} as const;

export const transitions = {
  fast: '100ms cubic-bezier(0.23, 1, 0.32, 1)',
  normal: '160ms cubic-bezier(0.23, 1, 0.32, 1)',
  slow: '240ms cubic-bezier(0.23, 1, 0.32, 1)',
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
  md: 28,
  lg: 32,
} as const;

export const controlWidth = {
  label: 80,
  input: 120,
  select: 160,
} as const;

export const layout = {
  headerHeight: 36,
  panelHeaderHeight: 28,
  trackHeight: 32,
  rulerHeight: 28,
  labelWidth: 120,
  rightPanelWidth: 280,
  assetsMinWidth: 160,
  assetsMaxWidth: 320,
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
