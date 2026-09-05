/**
 * Audio Worker Entry Point
 *
 * Runs in a Web Worker context. Has zero access to:
 * - React, Zustand, DOM, Canvas, AudioContext
 * - Electron, Node.js APIs
 * - Application global state
 *
 * Receives typed messages, performs pure computation, returns typed results.
 * Errors are serialized using the DocuFlow error system.
 */

import { extractPeaks, isValidChannelData } from './audioTasks';
import { normalizeError } from '../../../../core/errors';
import { serializeError } from '../../../../core/errors';
import type { WorkerRequest, WorkerResponse } from '../core/types';

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case 'extract-peaks': {
        const { channelData, numBars } = msg.payload;

        if (!isValidChannelData(channelData)) {
          const err = normalizeError(
            'Invalid channel data: expected non-empty Float32Array',
            'VALIDATION'
          );
          const response: WorkerResponse = {
            requestId: msg.requestId,
            type: 'error',
            error: serializeError(err),
          };
          self.postMessage(response);
          return;
        }

        if (typeof numBars !== 'number' || numBars <= 0 || !Number.isInteger(numBars)) {
          const err = normalizeError(
            `Invalid numBars: expected positive integer, got ${numBars}`,
            'VALIDATION'
          );
          const response: WorkerResponse = {
            requestId: msg.requestId,
            type: 'error',
            error: serializeError(err),
          };
          self.postMessage(response);
          return;
        }

        const result = extractPeaks({ channelData, numBars });

        const response: WorkerResponse = {
          requestId: msg.requestId,
          type: 'success',
          result,
        };
        self.postMessage(response);
        break;
      }

      default: {
        const err = normalizeError(
          `Unknown worker message type: ${(msg as any).type}`,
          'WORKER'
        );
        const response: WorkerResponse = {
          requestId: msg.requestId,
          type: 'error',
          error: serializeError(err),
        };
        self.postMessage(response);
      }
    }
  } catch (err) {
    const normalized = normalizeError(err, 'WORKER');
    const response: WorkerResponse = {
      requestId: msg.requestId,
      type: 'error',
      error: serializeError(normalized),
    };
    self.postMessage(response);
  }
};
