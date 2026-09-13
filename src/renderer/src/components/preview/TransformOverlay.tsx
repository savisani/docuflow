import React, { useCallback, useRef, useState } from 'react';
import { useDocuFlowStore } from '../../app/store';
import { resolveLayerState } from '../../engine/timeline/resolver';
import { LayerState } from '../../types/timeline';

interface TransformOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  displayScale: number;
  offsetX: number;
  offsetY: number;
  compositionWidth: number;
  compositionHeight: number;
  currentFrame: number;
  fps: number;
}

type DragMode = 'move' | 'resize';
type HandlePosition = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'body';

interface DragState {
  mode: DragMode;
  handle: HandlePosition;
  startMouseX: number;
  startMouseY: number;
  startCompX: number;
  startCompY: number;
  startScale: number;
  origW: number;
  origH: number;
  elW: number;
  elH: number;
  anchorX: number;
  anchorY: number;
  handleDirX: number;
  handleDirY: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 10;

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function findLayerForCommand(
  timeline: { layers: Record<string, LayerState> } | null,
  commandId: string
): LayerState | null {
  if (!timeline) return null;
  const direct = timeline.layers[commandId];
  if (direct) return direct;
  for (const layer of Object.values(timeline.layers)) {
    if (layer.assetSegments.some((seg) => seg.commandId === commandId)) {
      return layer;
    }
  }
  return null;
}

export const TransformOverlay: React.FC<TransformOverlayProps> = ({
  containerRef,
  displayScale,
  offsetX,
  offsetY,
  compositionWidth,
  compositionHeight,
  currentFrame,
  fps,
}) => {
  const selectedCommandId = useDocuFlowStore((s) => s.selectedCommandId);
  const timeline = useDocuFlowStore((s) => s.timeline);
  const updateCommand = useDocuFlowStore((s) => s.updateCommand);
  const beginBatch = useDocuFlowStore((s) => s.beginBatch);
  const endBatch = useDocuFlowStore((s) => s.endBatch);

  const selectedCommand = useDocuFlowStore((s) =>
    s.commands.find((c) => c.id === s.selectedCommandId)
  );

  const layer = findLayerForCommand(timeline, selectedCommandId || '');
  const isVisual = selectedCommand?.type === 'show' && layer &&
    (layer.assetType === 'image' || layer.assetType === 'video');

  const resolved = isVisual && layer
    ? resolveLayerState(layer, currentFrame)
    : null;

  const assets = useDocuFlowStore((s) => s.assets);
  const asset = isVisual && selectedCommand
    ? assets.find(
        (a) => a.logicalId === (selectedCommand as any).asset || a.id === (selectedCommand as any).asset
      )
    : null;

  const naturalW = asset?.width || 0;
  const naturalH = asset?.height || 0;
  const aspectRatio = naturalW > 0 && naturalH > 0 ? naturalW / naturalH : compositionWidth / compositionHeight;

  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const displayScaleRef = useRef(displayScale);
  const naturalWRef = useRef(naturalW);
  const naturalHRef = useRef(naturalH);
  const aspectRatioRef = useRef(aspectRatio);
  const compositionWRef = useRef(compositionWidth);
  const compositionHRef = useRef(compositionHeight);

  displayScaleRef.current = displayScale;
  naturalWRef.current = naturalW;
  naturalHRef.current = naturalH;
  aspectRatioRef.current = aspectRatio;
  compositionWRef.current = compositionWidth;
  compositionHRef.current = compositionHeight;

  const handleDeselect = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      useDocuFlowStore.getState().selectCommand(null);
    }
  }, []);

  const cleanupRef = useRef<(() => void) | null>(null);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const ds = dragRef.current;
    if (!ds || !selectedCommand) return;

    const dScale = displayScaleRef.current;
    const nW = naturalWRef.current;
    const nH = naturalHRef.current;
    const aRatio = aspectRatioRef.current;
    const cW = compositionWRef.current;
    const cH = compositionHRef.current;

    const dxScreen = e.clientX - ds.startMouseX;
    const dyScreen = e.clientY - ds.startMouseY;
    const dxComp = dxScreen / dScale;
    const dyComp = dyScreen / dScale;

    if (ds.mode === 'move') {
      const newX = ds.startCompX + dxComp;
      const newY = ds.startCompY + dyComp;
      updateCommand(selectedCommand.id, { x: newX, y: newY } as any);
      return;
    }

    if (ds.mode === 'resize') {
      const origW = ds.origW;
      const origH = ds.origH;
      const origScale = ds.startScale;

      const isCorner = ds.handle === 'nw' || ds.handle === 'ne' || ds.handle === 'sw' || ds.handle === 'se';

      let newScale: number;

      if (isCorner) {
        const elW = ds.elW;
        const elH = ds.elH;
        const diagLenSq = elW * elW + elH * elH;
        if (diagLenSq > 0) {
          const delta = (dxComp * ds.handleDirX * elW + dyComp * ds.handleDirY * elH) / diagLenSq;
          newScale = clamp(origScale + delta, MIN_SCALE, MAX_SCALE);
        } else {
          newScale = origScale;
        }
      } else {
        let newW: number;
        let newH: number;

        if (ds.handle === 'e') {
          newW = Math.max(20, origW + dxComp);
          newH = newW / aRatio;
        } else if (ds.handle === 'w') {
          newW = Math.max(20, origW - dxComp);
          newH = newW / aRatio;
        } else if (ds.handle === 's') {
          newH = Math.max(20, origH + dyComp);
          newW = newH * aRatio;
        } else {
          newH = Math.max(20, origH - dyComp);
          newW = newH * aRatio;
        }

        newScale = nW > 0
          ? clamp(newW / nW, MIN_SCALE, MAX_SCALE)
          : clamp(newW / (cW * 0.5), MIN_SCALE, MAX_SCALE);
      }

      let newX: number;
      let newY: number;

      const elW = ds.elW;
      const elH = ds.elH;

      const anchorOnLeft = ds.handle === 'se' || ds.handle === 'ne' || ds.handle === 'e';
      const anchorOnTop = ds.handle === 'se' || ds.handle === 'sw' || ds.handle === 's';
      newX = anchorOnLeft
        ? ds.anchorX + elW / 2
        : ds.anchorX - elW * (newScale - 0.5);
      newY = anchorOnTop
        ? ds.anchorY + elH / 2
        : ds.anchorY - elH * (newScale - 0.5);

      updateCommand(selectedCommand.id, { x: newX, y: newY, scale: newScale } as any);
    }
  }, [selectedCommand, updateCommand]);

  const handleMouseUp = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    dragRef.current = null;
    setDragging(false);
    endBatch();
  }, [endBatch]);

  const onHandleMouseDown = useCallback((e: React.MouseEvent, handle: HandlePosition, mode: DragMode) => {
    e.stopPropagation();
    e.preventDefault();

    const currentResolved = isVisual && layer
      ? resolveLayerState(layer, currentFrame)
      : null;
    if (!currentResolved) return;

    const elW = naturalW > 0 ? naturalW : compositionWidth * 0.5;
    const elH = naturalW > 0 ? naturalH : elW / aspectRatio;
    const cw = elW * currentResolved.scale;
    const ch = elH * currentResolved.scale;

    let handleDirX = 0;
    let handleDirY = 0;

    if (handle === 'se' || handle === 'ne' || handle === 'e') handleDirX = 1;
    if (handle === 'nw' || handle === 'sw' || handle === 'w') handleDirX = -1;
    if (handle === 'se' || handle === 'sw' || handle === 's') handleDirY = 1;
    if (handle === 'nw' || handle === 'ne' || handle === 'n') handleDirY = -1;

    const anchorOnLeft = handle === 'se' || handle === 'ne' || handle === 'e';
    const anchorOnTop = handle === 'se' || handle === 'sw' || handle === 's';
    const anchorX = anchorOnLeft
      ? currentResolved.x - elW / 2
      : currentResolved.x + elW * (currentResolved.scale - 0.5);
    const anchorY = anchorOnTop
      ? currentResolved.y - elH / 2
      : currentResolved.y + elH * (currentResolved.scale - 0.5);

    dragRef.current = {
      mode,
      handle,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startCompX: currentResolved.x,
      startCompY: currentResolved.y,
      startScale: currentResolved.scale,
      origW: cw,
      origH: ch,
      elW,
      elH,
      anchorX,
      anchorY,
      handleDirX,
      handleDirY,
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    cleanupRef.current = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    beginBatch();
    setDragging(true);
  }, [isVisual, layer, currentFrame, naturalW, naturalH, compositionWidth, compositionHeight, aspectRatio, handleMouseMove, handleMouseUp, beginBatch]);

  if (!isVisual || !resolved) return null;

  const elementW = naturalW > 0 ? naturalW : compositionWidth * 0.5;
  const elementH = naturalW > 0 ? naturalH : elementW / aspectRatio;
  const scaledW = elementW * resolved.scale;
  const scaledH = elementH * resolved.scale;

  // Box position in containerRef coords (absolute within the full container)
  const boxLeft = offsetX + ((compositionWidth / 2) + resolved.x - elementW / 2) * displayScale;
  const boxTop = offsetY + ((compositionHeight / 2) + resolved.y - elementH / 2) * displayScale;
  const boxWidth = scaledW * displayScale;
  const boxHeight = scaledH * displayScale;

  if (boxWidth < 1 || boxHeight < 1) return null;

  const handles: { pos: HandlePosition; style: React.CSSProperties }[] = [
    { pos: 'nw', style: { left: -5, top: -5, cursor: 'nwse-resize' } },
    { pos: 'ne', style: { right: -5, top: -5, cursor: 'nesw-resize' } },
    { pos: 'sw', style: { left: -5, bottom: -5, cursor: 'nesw-resize' } },
    { pos: 'se', style: { right: -5, bottom: -5, cursor: 'nwse-resize' } },
    { pos: 'n', style: { left: '50%', top: -5, transform: 'translateX(-50%)', cursor: 'ns-resize' } },
    { pos: 's', style: { left: '50%', bottom: -5, transform: 'translateX(-50%)', cursor: 'ns-resize' } },
    { pos: 'w', style: { left: -5, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
    { pos: 'e', style: { right: -5, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
  ];

  return (
    <div
      onClick={handleDeselect}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        zIndex: 20,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: boxLeft,
          top: boxTop,
          width: boxWidth,
          height: boxHeight,
          border: '2px solid #3b82f6',
          cursor: dragging
            ? dragRef.current?.mode === 'move' ? 'grabbing' : 'default'
            : 'grab',
          pointerEvents: 'auto',
          boxSizing: 'border-box',
        }}
        onMouseDown={(e) => onHandleMouseDown(e, 'body', 'move')}
      >
        {handles.map(({ pos, style }) => (
          <div
            key={pos}
            style={{
              position: 'absolute',
              width: 10,
              height: 10,
              background: '#3b82f6',
              border: '1.5px solid #ffffff',
              borderRadius: 2,
              boxSizing: 'border-box',
              pointerEvents: 'auto',
              zIndex: 21,
              ...style,
            }}
            onMouseDown={(e) => onHandleMouseDown(e, pos, 'resize')}
          />
        ))}
      </div>
    </div>
  );
};
