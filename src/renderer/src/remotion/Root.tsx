import { Composition } from 'remotion';
import { DocuFlowComposition } from './DocuFlowComposition';
import { TimelineState } from '../types/timeline';

export const RemotionRoot: React.FC = () => {
  return null;
};

export function getCompositionProps(timeline: TimelineState, fps: number, width: number, height: number) {
  return {
    component: DocuFlowComposition,
    defaultProps: { timeline },
    durationInFrames: timeline.totalFrames,
    fps,
    width,
    height,
  };
}
