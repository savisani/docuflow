import { Command } from '../engine/commands/types';
import { Project } from '../types/project';

export const DEMO_COMMANDS: Command[] = [
  {
    id: 'show-img1',
    type: 'show',
    asset: 'image1',
    start: 0,
    duration: 5,
  },
  {
    id: 'scale-img1',
    type: 'scale',
    target: 'show-img1',
    start: 0,
    duration: 5,
    from: 1,
    to: 1.15,
    easing: 'easeInOut',
  },
  {
    id: 'rotate-img1',
    type: 'rotate',
    target: 'show-img1',
    start: 3,
    duration: 2,
    from: 0,
    to: 180,
    easing: 'easeInOut',
  },
  {
    id: 'replace-img1',
    type: 'replace',
    target: 'show-img1',
    asset: 'image2',
    start: 5,
  },
  {
    id: 'scale-img2',
    type: 'scale',
    target: 'show-img1',
    start: 5,
    duration: 4,
    from: 1,
    to: 1.2,
    easing: 'easeOut',
  },
  {
    id: 'show-img3',
    type: 'show',
    asset: 'image3',
    start: 9,
    duration: 3,
  },
  {
    id: 'sfx-whoosh',
    type: 'sfx',
    asset: 'sfx1',
    start: 9,
    volume: 0.7,
  },
];

export const DEMO_3D_COMMANDS: Command[] = [
  {
    id: 'center-img',
    type: 'show',
    asset: 'image1',
    start: 0,
    duration: 10,
  },
  {
    id: 'right-img',
    type: 'show',
    asset: 'image2',
    start: 0,
    duration: 10,
  },
  {
    id: 'set-right-pos',
    type: 'move',
    target: 'right-img',
    start: 0,
    duration: 0.1,
    from: { x: 0, y: 0 },
    to: { x: 300, y: 0 },
  },
  {
    id: 'left-img',
    type: 'show',
    asset: 'image3',
    start: 0,
    duration: 10,
  },
  {
    id: 'set-left-pos',
    type: 'move',
    target: 'left-img',
    start: 0,
    duration: 0.1,
    from: { x: 0, y: 0 },
    to: { x: -300, y: 0 },
  },
  {
    id: 'title-text',
    type: 'text',
    content: '2.5D Position Test: Center / Right(+300) / Left(-300)',
    start: 0,
    duration: 10,
    x: 960,
    y: 50,
    fontSize: 36,
    color: '#FFFFFF',
  },
];

export const DEMO_3D_PROJECT: Project = {
  version: 1,
  settings: {
    width: 1920,
    height: 1080,
    fps: 30,
  },
  assets: [],
  commands: DEMO_3D_COMMANDS,
};

export const DEMO_PROJECT: Project = {
  version: 1,
  settings: {
    width: 1920,
    height: 1080,
    fps: 30,
  },
  assets: [],
  commands: DEMO_COMMANDS,
};
