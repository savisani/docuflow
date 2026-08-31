export interface SceneDSL {
  text: string;
  visual?: string;
  motion?: string;
  transition?: string;
  style?: string;
  duration?: string;
  layers?: string[];
  extras?: string[];
  reasoning?: string;
}

export type SupportedMotion =
  | 'none'
  | 'slow_zoom'
  | 'medium_zoom'
  | 'fast_zoom'
  | 'slow_zoom_out'
  | 'medium_zoom_out'
  | 'fast_zoom_out'
  | 'slow_pan_left'
  | 'slow_pan_right'
  | 'slow_pan_up'
  | 'slow_pan_down'
  | 'medium_pan_left'
  | 'medium_pan_right'
  | 'fast_pan_left'
  | 'fast_pan_right'
  | 'dolly_in'
  | 'dolly_out'
  | 'orbit_left'
  | 'orbit_right'
  | 'tilt_up'
  | 'tilt_down'
  | 'crane_up'
  | 'crane_down'
  | 'handheld'
  | 'parallax';

export type SupportedTransition = 'cut' | 'crossfade' | 'slide_left' | 'slide_right' | 'slide_up' | 'slide_down' | 'wipe_left' | 'wipe_right' | 'wipe_up' | 'wipe_down' | 'zoom_in' | 'zoom_out' | 'dissolve' | 'fade';

export type SupportedStyle = 'natural' | 'cinematic' | 'documentary' | 'vintage' | 'dramatic' | 'minimal' | 'none';

export const VALID_MOTIONS: SupportedMotion[] = [
  'none', 'slow_zoom', 'medium_zoom', 'fast_zoom',
  'slow_zoom_out', 'medium_zoom_out', 'fast_zoom_out',
  'slow_pan_left', 'slow_pan_right', 'slow_pan_up', 'slow_pan_down',
  'medium_pan_left', 'medium_pan_right',
  'fast_pan_left', 'fast_pan_right',
  'dolly_in', 'dolly_out', 'orbit_left', 'orbit_right',
  'tilt_up', 'tilt_down', 'crane_up', 'crane_down',
  'handheld', 'parallax',
];

export const VALID_TRANSITIONS: SupportedTransition[] = [
  'cut', 'crossfade', 'slide_left', 'slide_right', 'slide_up', 'slide_down',
  'wipe_left', 'wipe_right', 'wipe_up', 'wipe_down',
  'zoom_in', 'zoom_out', 'dissolve', 'fade',
];

export const VALID_STYLES: SupportedStyle[] = [
  'natural', 'cinematic', 'documentary', 'vintage', 'dramatic', 'minimal', 'none',
];

export const MOTION_ALIASES: Record<string, SupportedMotion> = {
  'none': 'none',
  'no': 'none',
  'static': 'none',
  'still': 'none',
  'slow zoom in': 'slow_zoom',
  'slow zoom': 'slow_zoom',
  'slowzoom': 'slow_zoom',
  'medium zoom in': 'medium_zoom',
  'medium zoom': 'medium_zoom',
  'mediumzoom': 'medium_zoom',
  'fast zoom in': 'fast_zoom',
  'fast zoom': 'fast_zoom',
  'fastzoom': 'fast_zoom',
  'slow zoom out': 'slow_zoom_out',
  'slowzoomout': 'slow_zoom_out',
  'medium zoom out': 'medium_zoom_out',
  'mediumzoomout': 'medium_zoom_out',
  'fast zoom out': 'fast_zoom_out',
  'fastzoomout': 'fast_zoom_out',
  'slow pan left': 'slow_pan_left',
  'slowpanleft': 'slow_pan_left',
  'slow pan right': 'slow_pan_right',
  'slowpanright': 'slow_pan_right',
  'slow pan up': 'slow_pan_up',
  'slowpanup': 'slow_pan_up',
  'slow pan down': 'slow_pan_down',
  'slowpandown': 'slow_pan_down',
  'medium pan left': 'medium_pan_left',
  'mediumpanleft': 'medium_pan_left',
  'medium pan right': 'medium_pan_right',
  'mediumpanright': 'medium_pan_right',
  'fast pan left': 'fast_pan_left',
  'fastpanleft': 'fast_pan_left',
  'fast pan right': 'fast_pan_right',
  'fastpanright': 'fast_pan_right',
  'dolly in': 'dolly_in',
  'dollyin': 'dolly_in',
  'dolly out': 'dolly_out',
  'dollyout': 'dolly_out',
  'orbit left': 'orbit_left',
  'orbitleft': 'orbit_left',
  'orbit right': 'orbit_right',
  'orbitright': 'orbit_right',
  'tilt up': 'tilt_up',
  'tiltup': 'tilt_up',
  'tilt down': 'tilt_down',
  'tiltdown': 'tilt_down',
  'crane up': 'crane_up',
  'craneup': 'crane_up',
  'crane down': 'crane_down',
  'cranedown': 'crane_down',
  'handheld': 'handheld',
  'hand': 'handheld',
  'parallax': 'parallax',
};

export const TRANSITION_ALIASES: Record<string, SupportedTransition> = {
  'cut': 'cut',
  'hard': 'cut',
  'jump': 'cut',
  'crossfade': 'crossfade',
  'cross-fade': 'crossfade',
  'cross fade': 'crossfade',
  'dissolve': 'dissolve',
  'fade': 'fade',
  'fade in': 'fade',
  'fade out': 'fade',
  'slide left': 'slide_left',
  'slide left to right': 'slide_left',
  'slide right': 'slide_right',
  'slide right to left': 'slide_right',
  'slide up': 'slide_up',
  'slide down': 'slide_down',
  'wipe left': 'wipe_left',
  'wipe left to right': 'wipe_left',
  'wipe right': 'wipe_right',
  'wipe right to left': 'wipe_right',
  'wipe up': 'wipe_up',
  'wipe down': 'wipe_down',
  'zoom in': 'zoom_in',
  'zoom out': 'zoom_out',
};

export const STYLE_ALIASES: Record<string, SupportedStyle> = {
  'natural': 'natural',
  'real': 'natural',
  'realistic': 'natural',
  'cinematic': 'cinematic',
  'movie': 'cinematic',
  'film': 'cinematic',
  'documentary': 'documentary',
  'docu': 'documentary',
  'vintage': 'vintage',
  'retro': 'vintage',
  'old': 'vintage',
  'classic': 'vintage',
  'dramatic': 'dramatic',
  'epic': 'dramatic',
  'intense': 'dramatic',
  'minimal': 'minimal',
  'simple': 'minimal',
  'clean': 'minimal',
  'none': 'none',
  'no style': 'none',
  'plain': 'none',
};

export interface CompileResult {
  scenes: SceneDSL[];
  errors: string[];
}

export interface CompileCommandsResult {
  commands: import('../commands/types').Command[];
  assets: Map<string, { logicalId: string; filename: string; type: 'image' | 'video' | 'audio' }>;
  errors: string[];
  warnings: string[];
}
