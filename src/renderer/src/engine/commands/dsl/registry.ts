export interface CommandDef {
  dslName: string;
  aliases?: string[];
  internalType: string;
  description: string;
  syntax: string;
  example: string;
  assetRef?: 'image' | 'audio' | 'none';
  audioRole?: 'sfx' | 'music';
}

export const COMMAND_REGISTRY: CommandDef[] = [
  {
    dslName: 'SHOW',
    internalType: 'show',
    description: 'Show an image/video asset during a specific time range',
    syntax: 'SHOW IMAGE <n> FROM <start> TO <end>',
    example: 'SHOW IMAGE 1 FROM 0 TO 5',
    assetRef: 'image',
  },
  {
    dslName: 'HIDE',
    internalType: 'hide',
    description: 'Hide an asset',
    syntax: 'HIDE IMAGE <n> AT <time>',
    example: 'HIDE IMAGE 1 AT 5',
    assetRef: 'image',
  },
  {
    dslName: 'MOVE',
    internalType: 'move',
    description: 'Move an asset in 2D X/Y space',
    syntax: 'MOVE IMAGE <n> FROM <x>,<y> TO <x>,<y> DURING <start>-<end>',
    example: 'MOVE IMAGE 1 FROM 0,0 TO 300,100 DURING 0-5',
    assetRef: 'image',
  },
  {
    dslName: 'MOVE3D',
    internalType: 'move3D',
    description: 'Move an asset through X/Y/Z 3D space',
    syntax: 'MOVE3D IMAGE <n> FROM <x>,<y>,<z> TO <x>,<y>,<z> DURING <start>-<end>',
    example: 'MOVE3D IMAGE 1 FROM 0,0,0 TO 100,0,400 DURING 0-5',
    assetRef: 'image',
  },
  {
    dslName: 'SCALE',
    internalType: 'scale',
    description: 'Zoom an asset',
    syntax: 'SCALE IMAGE <n> FROM <startScale> TO <endScale> DURING <start>-<end>',
    example: 'SCALE IMAGE 1 FROM 1 TO 1.25 DURING 0-5',
    assetRef: 'image',
  },
  {
    dslName: 'ROTATE',
    internalType: 'rotate',
    description: 'Rotate an asset around the Z axis',
    syntax: 'ROTATE IMAGE <n> FROM <startDegrees> TO <endDegrees> DURING <start>-<end>',
    example: 'ROTATE IMAGE 1 FROM 0 TO 180 DURING 0-5',
    assetRef: 'image',
  },
  {
    dslName: 'ROTATE3D',
    internalType: 'rotate3D',
    description: 'Rotate an asset around X/Y/Z axes',
    syntax: 'ROTATE3D IMAGE <n> FROM <rx>,<ry>,<rz> TO <rx>,<ry>,<rz> DURING <start>-<end>',
    example: 'ROTATE3D IMAGE 1 FROM 0,0,0 TO 10,25,0 DURING 0-5',
    assetRef: 'image',
  },
  {
    dslName: 'DEPTH',
    internalType: 'depth',
    description: 'Move an asset along the Z axis',
    syntax: 'DEPTH IMAGE <n> FROM <startZ> TO <endZ> DURING <start>-<end>',
    example: 'DEPTH IMAGE 1 FROM 0 TO 400 DURING 0-5',
    assetRef: 'image',
  },
  {
    dslName: 'OPACITY',
    internalType: 'opacity',
    description: 'Fade an asset between opacity values',
    syntax: 'OPACITY IMAGE <n> FROM <start> TO <end> DURING <start>-<end>',
    example: 'OPACITY IMAGE 1 FROM 0 TO 1 DURING 0-2',
    assetRef: 'image',
  },
  {
    dslName: 'FADE',
    internalType: 'fadeIn',
    description: 'Fade an asset into visibility',
    syntax: 'FADE IN IMAGE <n> DURING <start>-<end>',
    example: 'FADE IN IMAGE 1 DURING 0-2',
    assetRef: 'image',
  },
  {
    dslName: 'FADE OUT',
    internalType: 'fadeOut',
    description: 'Fade an asset out',
    syntax: 'FADE OUT IMAGE <n> DURING <start>-<end>',
    example: 'FADE OUT IMAGE 1 DURING 4-6',
    assetRef: 'image',
  },
  {
    dslName: 'BLUR',
    internalType: 'blur',
    description: 'Animate blur',
    syntax: 'BLUR IMAGE <n> FROM <start> TO <end> DURING <start>-<end>',
    example: 'BLUR IMAGE 1 FROM 10 TO 0 DURING 0-2',
    assetRef: 'image',
  },
  {
    dslName: 'REPLACE',
    internalType: 'replace',
    description: 'Replace one visual asset with another',
    syntax: 'REPLACE IMAGE <n> WITH IMAGE <n> AT <time>',
    example: 'REPLACE IMAGE 1 WITH IMAGE 2 AT 5',
    assetRef: 'image',
  },
  {
    dslName: 'SLIDE',
    internalType: 'slide',
    description: 'Slide a new image into the scene',
    syntax: 'SLIDE IMAGE <n> FROM <direction> DURING <start>-<end>',
    example: 'SLIDE IMAGE 2 FROM RIGHT DURING 5-6',
    assetRef: 'image',
  },
  {
    dslName: 'CAMERA MOVE',
    internalType: 'cameraMove',
    description: 'Move the virtual camera in 3D space',
    syntax: 'CAMERA MOVE FROM <x>,<y>,<z> TO <x>,<y>,<z> DURING <start>-<end>',
    example: 'CAMERA MOVE FROM 0,0,1200 TO 0,0,800 DURING 0-6',
  },
  {
    dslName: 'CAMERA ROTATE',
    internalType: 'cameraRotate',
    description: 'Rotate the virtual camera',
    syntax: 'CAMERA ROTATE FROM <x>,<y>,<z> TO <x>,<y>,<z> DURING <start>-<end>',
    example: 'CAMERA ROTATE FROM 0,0,0 TO 5,10,0 DURING 0-6',
  },
  {
    dslName: 'TEXT',
    internalType: 'text',
    description: 'Display text',
    syntax: 'TEXT "<content>" FROM <start> TO <end>',
    example: 'TEXT "THE COMPUTER REVOLUTION" FROM 0 TO 5',
  },
  {
    dslName: 'SUBTITLE',
    internalType: 'subtitle',
    description: 'Display timed subtitle text',
    syntax: 'SUBTITLE "<content>" FROM <start> TO <end>',
    example: 'SUBTITLE "Hello World" FROM 0 TO 5',
  },
  {
    dslName: 'SFX',
    internalType: 'sfx',
    description: 'Play a sound effect at a specific time',
    syntax: 'SFX <n> AT <time>',
    example: 'SFX 1 AT 5',
    assetRef: 'audio',
    audioRole: 'sfx',
  },
  {
    dslName: 'MUSIC',
    internalType: 'music',
    description: 'Play background music',
    syntax: 'MUSIC <n> FROM <start> TO <end>',
    example: 'MUSIC 1 FROM 0 TO 20',
    assetRef: 'audio',
    audioRole: 'music',
  },
  {
    dslName: 'FLIP HORIZONTAL',
    internalType: 'flipHorizontal',
    description: 'Flip an asset horizontally',
    syntax: 'FLIP HORIZONTAL IMAGE <n> AT <time>',
    example: 'FLIP HORIZONTAL IMAGE 1 AT 3',
    assetRef: 'image',
  },
  {
    dslName: 'FLIP VERTICAL',
    internalType: 'flipVertical',
    description: 'Flip an asset vertically',
    syntax: 'FLIP VERTICAL IMAGE <n> AT <time>',
    example: 'FLIP VERTICAL IMAGE 1 AT 3',
    assetRef: 'image',
  },
  {
    dslName: 'CROP',
    internalType: 'crop',
    description: 'Crop an asset to a rectangle',
    syntax: 'CROP IMAGE <n> AT <x>,<y>,<w>,<h>',
    example: 'CROP IMAGE 1 AT 100,100,500,400',
    assetRef: 'image',
  },
  {
    dslName: 'WIPE',
    internalType: 'wipe',
    description: 'Wipe an asset in from a direction',
    syntax: 'WIPE IMAGE <n> FROM <direction> DURING <start>-<end>',
    example: 'WIPE IMAGE 2 FROM RIGHT DURING 5-6',
    assetRef: 'image',
  },
  {
    dslName: 'CUT',
    internalType: 'cut',
    description: 'Cut/hide an asset at a specific time',
    syntax: 'CUT IMAGE <n> AT <time>',
    example: 'CUT IMAGE 1 AT 5',
    assetRef: 'image',
  },
  {
    dslName: 'VOLUME',
    internalType: 'volume',
    description: 'Animate audio volume',
    syntax: 'VOLUME AUDIO <n> FROM <from> TO <to> DURING <start>-<end>',
    example: 'VOLUME AUDIO 1 FROM 0 TO 1 DURING 0-5',
    assetRef: 'audio',
  },
  {
    dslName: 'FADE AUDIO IN',
    internalType: 'fadeAudioIn',
    description: 'Fade in an audio asset',
    syntax: 'FADE AUDIO IN IMAGE <n> DURING <start>-<end>',
    example: 'FADE AUDIO IN AUDIO 1 DURING 0-3',
    assetRef: 'audio',
  },
  {
    dslName: 'FADE AUDIO OUT',
    internalType: 'fadeAudioOut',
    description: 'Fade out an audio asset',
    syntax: 'FADE AUDIO OUT IMAGE <n> DURING <start>-<end>',
    example: 'FADE AUDIO OUT IMAGE 1 DURING 7-10',
    assetRef: 'audio',
  },
  {
    dslName: 'AMBIENT',
    internalType: 'ambient',
    description: 'Play ambient background audio',
    syntax: 'AMBIENT MUSIC <n> FROM <start> TO <end>',
    example: 'AMBIENT MUSIC 1 FROM 0 TO 30',
    assetRef: 'audio',
    audioRole: 'music',
  },
  {
    dslName: 'CROSSFADE',
    internalType: 'crossfade',
    description: 'Crossfade between two assets',
    syntax: 'CROSSFADE IMAGE <n> TO IMAGE <m> DURING <start>-<end>',
    example: 'CROSSFADE IMAGE 1 TO IMAGE 2 DURING 5-7',
    assetRef: 'image',
  },
];

export const DSL_COMMAND_NAMES = new Set(
  COMMAND_REGISTRY.flatMap((c) => [c.dslName, ...(c.aliases ?? [])])
);
// CAMERA is matched as a single token by the parser switch
DSL_COMMAND_NAMES.add('CAMERA');
DSL_COMMAND_NAMES.add('FLIP');
DSL_COMMAND_NAMES.add('CROP');
DSL_COMMAND_NAMES.add('WIPE');
DSL_COMMAND_NAMES.add('CUT');
DSL_COMMAND_NAMES.add('VOLUME');
DSL_COMMAND_NAMES.add('AMBIENT');

export function getCommandDef(dslName: string): CommandDef | undefined {
  return COMMAND_REGISTRY.find(
    (c) =>
      c.dslName === dslName ||
      c.aliases?.includes(dslName)
  );
}
