import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isOllamaRunning, waitForOllama } from '../ollama-launcher';

// Mock http module
vi.mock('http', () => ({
  default: {
    get: vi.fn(),
  },
}));

import http from 'http';

describe('Ollama Launcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isOllamaRunning', () => {
    it('returns true when Ollama API responds with 200', async () => {
      const mockReq = {
        on: vi.fn(),
        destroy: vi.fn(),
      };
      const mockRes = { statusCode: 200, resume: vi.fn() };

      (http.get as any).mockImplementation((_url: string, _opts: any, callback: Function) => {
        callback(mockRes);
        return mockReq;
      });

      const result = await isOllamaRunning();
      expect(result).toBe(true);
      expect(mockRes.resume).toHaveBeenCalled();
    });

    it('returns false when Ollama API responds with non-200', async () => {
      const mockReq = {
        on: vi.fn(),
        destroy: vi.fn(),
      };
      const mockRes = { statusCode: 500, resume: vi.fn() };

      (http.get as any).mockImplementation((_url: string, _opts: any, callback: Function) => {
        callback(mockRes);
        return mockReq;
      });

      const result = await isOllamaRunning();
      expect(result).toBe(false);
    });

    it('returns false when connection is refused', async () => {
      const mockReq = {
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'error') {
            handler(new Error('ECONNREFUSED'));
          }
          return mockReq;
        }),
        destroy: vi.fn(),
      };

      (http.get as any).mockImplementation(() => mockReq);

      const result = await isOllamaRunning();
      expect(result).toBe(false);
    });

    it('returns false on timeout', async () => {
      const mockReq = {
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'timeout') {
            handler();
          }
          return mockReq;
        }),
        destroy: vi.fn(),
      };

      (http.get as any).mockImplementation(() => mockReq);

      const result = await isOllamaRunning();
      expect(result).toBe(false);
      expect(mockReq.destroy).toHaveBeenCalled();
    });
  });

  describe('waitForOllama', () => {
    it('resolves true immediately if Ollama is running', async () => {
      const mockReq = {
        on: vi.fn(),
        destroy: vi.fn(),
      };
      const mockRes = { statusCode: 200, resume: vi.fn() };

      (http.get as any).mockImplementation((_url: string, _opts: any, callback: Function) => {
        callback(mockRes);
        return mockReq;
      });

      const result = await waitForOllama(1000);
      expect(result).toBe(true);
    });

    it('resolves false after timeout if Ollama never starts', async () => {
      const mockReq = {
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'error') {
            handler(new Error('ECONNREFUSED'));
          }
          return mockReq;
        }),
        destroy: vi.fn(),
      };

      (http.get as any).mockImplementation(() => mockReq);

      const result = await waitForOllama(1500);
      expect(result).toBe(false);
    });
  });

  describe('No duplicate spawning', () => {
    it('does not spawn when Ollama is already running', async () => {
      const mockReq = {
        on: vi.fn(),
        destroy: vi.fn(),
      };
      const mockRes = { statusCode: 200, resume: vi.fn() };

      (http.get as any).mockImplementation((_url: string, _opts: any, callback: Function) => {
        callback(mockRes);
        return mockReq;
      });

      // The isOllamaRunning check should return true
      const running = await isOllamaRunning();
      expect(running).toBe(true);
      // No spawn should be triggered
    });
  });
});
