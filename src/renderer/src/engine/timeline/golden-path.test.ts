import { describe, test, expect } from 'vitest';
import { parseDsl } from '../commands/dsl/parser';
import { validateCommands } from '../commands/validator';
import { buildTimeline } from './builder';
import { resolveLayerState, resolveAudioVolume, resolveCameraState, isAudioActive, isTextActive } from './resolver';
import { Asset } from '../../../types/assets';
import { ProjectSettings } from '../../../types/project';

function makeAsset(id: string, logicalId: string, type: Asset['type'] = 'image', audioRole?: string): Asset {
  return {
    id,
    logicalId,
    filename: `${logicalId}.jpg`,
    type,
    mimeType: type === 'audio' ? 'audio/mpeg' : 'image/jpeg',
    audioRole: audioRole as any,
  };
}

const assets: Asset[] = [
  makeAsset('img1', 'image1', 'image'),
  makeAsset('img2', 'image2', 'image'),
  makeAsset('img3', 'image3', 'image'),
  makeAsset('img4', 'image4', 'image'),
  makeAsset('img5', 'image5', 'image'),
  makeAsset('vo1', 'voiceover1', 'audio', 'voiceover'),
  makeAsset('music1', 'music1', 'audio', 'music'),
  makeAsset('sfx1', 'sfx1', 'audio', 'sfx'),
  makeAsset('amb1', 'ambient1', 'audio', 'ambient'),
];

const settings: ProjectSettings = { width: 1920, height: 1080, fps: 30 };

function resolveAt(tl: ReturnType<typeof buildTimeline>, layerId: string, timeSec: number) {
  const layer = tl.layers[layerId];
  if (!layer) return null;
  const frame = Math.round(timeSec * settings.fps);
  return resolveLayerState(layer, frame);
}

describe('Golden Path: Documentary Pipeline', () => {
  test('full pipeline: commands -> validation -> timeline -> frame resolution', () => {
    const input = `SHOW IMAGE 1 FROM 0 TO 10
MOVE3D IMAGE 1 FROM 0,0,0 TO 100,0,400 DURING 0-10
ROTATE3D IMAGE 1 FROM 0,0,0 TO 10,20,0 DURING 2-8
SHOW IMAGE 2 FROM 10 TO 15
SLIDE IMAGE 2 FROM RIGHT DURING 10-11
TEXT "THE DOCUMENTARY TITLE" FROM 2 TO 5
MUSIC 1 FROM 0 TO 30 VOLUME 0.3
AMBIENT MUSIC 1 FROM 0 TO 30 VOLUME 0.2
SFX 1 AT 5 VOLUME 0.7
CAMERA MOVE FROM 0,0,1200 TO 0,0,800 DURING 0-15`;

    const parseResult = parseDsl(input, assets);
    expect(parseResult.errors).toHaveLength(0);
    expect(parseResult.commands.length).toBeGreaterThan(0);

    const validation = validateCommands(parseResult.commands, assets);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    const timeline = buildTimeline(parseResult.commands, assets, settings);
    expect(timeline.layers).toBeDefined();
    expect(timeline.audioTracks.length).toBeGreaterThan(0);
    expect(timeline.textLayers.length).toBeGreaterThan(0);
    expect(timeline.totalFrames).toBeGreaterThan(0);
    expect(timeline.camera).toBeDefined();

    const layerIds = Object.keys(timeline.layers);
    // We have 3 layers: img1 (show), img2 (show), img2 (slide creates new layer)
    expect(layerIds.length).toBe(3);
    expect(timeline.audioTracks.length).toBe(3);
    expect(timeline.textLayers.length).toBe(1);

    const layer1Id = layerIds.find(id => timeline.layers[id].assetId === 'img1')!;
    // Find the SLIDE layer for img2 (not the SHOW layer)
    const slideCmd = parseResult.commands.find(c => c.type === 'slide')!;
    const layer2Id = slideCmd.id;

    const at0 = resolveAt(timeline, layer1Id, 0);
    expect(at0).not.toBeNull();
    expect(at0?.opacity).toBe(1);
    expect(at0?.z).toBe(0);

    const at5 = resolveAt(timeline, layer1Id, 5);
    expect(at5).not.toBeNull();
    expect(at5?.z).toBeCloseTo(200, 0);
    expect(at5?.rotationX).toBeCloseTo(5, 1);

    const at10 = resolveAt(timeline, layer1Id, 10);
    expect(at10).not.toBeNull();
    expect(at10?.z).toBe(400);
    expect(at10?.rotationX).toBe(10);

    const at11 = resolveAt(timeline, layer2Id, 11);
    expect(at11).not.toBeNull();
    expect(at11?.x).toBeCloseTo(0, 0);

    const musicTrack = timeline.audioTracks.find(t => t.type === 'music')!;
    const ambientTrack = timeline.audioTracks.find(t => t.type === 'ambient')!;
    const sfxTrack = timeline.audioTracks.find(t => t.type === 'sfx')!;

    expect(isAudioActive(musicTrack, 150)).toBe(true);
    expect(resolveAudioVolume(musicTrack, 150)).toBe(0.3);

    expect(isAudioActive(ambientTrack, 150)).toBe(true);
    expect(resolveAudioVolume(ambientTrack, 150)).toBe(0.2);

    expect(isAudioActive(sfxTrack, 150)).toBe(true);
    expect(resolveAudioVolume(sfxTrack, 150)).toBe(0.7);

    const cam0 = resolveCameraState(timeline.camera, 0);
    expect(cam0.z).toBe(1200);

    const cam7 = resolveCameraState(timeline.camera, 7.5 * 30); // 7.5 seconds = 225 frames
    expect(cam7.z).toBe(1000);

    const cam15 = resolveCameraState(timeline.camera, 15 * 30); // 15 seconds = 450 frames
    expect(cam15.z).toBe(800);

    const textLayer = timeline.textLayers[0];
    expect(isTextActive(textLayer, 60)).toBe(true);     // t=2s
    expect(isTextActive(textLayer, 149)).toBe(true);   // t=4.97s (last active frame)
    expect(isTextActive(textLayer, 150)).toBe(false);  // t=5s (endFrame, exclusive)
    expect(isTextActive(textLayer, 180)).toBe(false);  // t=6s
    expect(textLayer.content).toBe('THE DOCUMENTARY TITLE');
  });

  test('pipeline handles overlapping commands correctly', () => {
    // Use a simpler test without conflicting SHOW commands
    const input = `SHOW IMAGE 1 FROM 0 TO 10
SHOW IMAGE 2 FROM 5 TO 15
MOVE IMAGE 1 FROM 0,0 TO 100,100 DURING 0-10
MOVE IMAGE 2 FROM 200,0 TO 100,100 DURING 5-15
CROSSFADE IMAGE 1 TO IMAGE 2 DURING 5-7`;

    const parseResult = parseDsl(input, assets);
    expect(parseResult.errors).toHaveLength(0);

    const validation = validateCommands(parseResult.commands, assets);
    expect(validation.valid).toBe(true);

    const timeline = buildTimeline(parseResult.commands, assets, settings);

    const layerIds = Object.keys(timeline.layers);
    // We have 3 layers: img1 (show), img2 (show), img2 (crossfade creates new layer)
    expect(layerIds.length).toBe(3);

    // Find the crossfade layer (it has the crossfade command id)
    const crossfadeCmd = parseResult.commands.find(c => c.type === 'crossfade')!;
    const crossfadeLayerId = crossfadeCmd.id;
    
    const layer1Id = layerIds.find(id => timeline.layers[id].assetId === 'img1')!;
    
    // At t=6 (during crossfade): both layers should be animating opacity
    const l1at6 = resolveAt(timeline, layer1Id, 6);
    const l2at6 = resolveAt(timeline, crossfadeLayerId, 6);

    expect(l1at6).not.toBeNull();
    expect(l2at6).not.toBeNull();

    // Layer 1 should be fading out (crossfade from)
    expect(l1at6!.opacity).toBeLessThan(1);
    expect(l1at6!.opacity).toBeGreaterThan(0);

    // Crossfade layer should be fading in (crossfade to)
    expect(l2at6!.opacity).toBeLessThan(1);
    expect(l2at6!.opacity).toBeGreaterThan(0);
  });
});