/**
 * Test per UploadContext
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import type { LogRipresa } from '../types';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    })),
  },
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => (k in store ? store[k] : null),
    setItem: (k: string, v: string): void => { store[k] = String(v); },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
    key: (i: number): string | null => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-anon-key');

import { UploadProvider, useUpload } from './UploadContext';

const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(UploadProvider, null, children);

function makeFakeFile(name: string, sizeBytes: number, type = 'video/mp4'): File {
  const blob = new Blob([], { type });
  const f = new File([blob], name, { type });
  Object.defineProperty(f, 'size', { value: sizeBytes, writable: false });
  return f;
}

function makeClip(overrides: Partial<LogRipresa> = {}): LogRipresa {
  return {
    id: 'clip-uuid-1',
    id_clip: 'C7876',
    contenuto_id: 'clp-uuid-1',
    id_contenuto_display: 'CLP0001',
    cliente_id: null,
    cliente_nome: 'Saturday',
    titolo: 'Test Clip',
    stato: 'Da girare',
    formato: '9:16',
    operatore: '',
    riga: null,
    file_id: null,
    file_url: null,
    file_name: null,
    file_size: null,
    file_mime_type: null,
    file_uploaded_at: null,
    file_deleted_at: null,
    exported_file_id: null,
    exported_file_url: null,
    exported_file_name: null,
    exported_file_size: null,
    exported_file_mime_type: null,
    exported_file_uploaded_at: null,
    raw_files_count: 0,
    raw_files_size: 0,
    created_at: '2026-04-16T00:00:00Z',
    updated_at: '2026-04-16T00:00:00Z',
    ...overrides,
  };
}

function setupFetchToFailInit() {
  mockFetch.mockImplementation(() =>
    Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'init failed' }),
    } as Response)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  setupFetchToFailInit();
  localStorageMock.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useUpload guard', () => {
  it('fuori da Provider throw', () => {
    expect(() => renderHook(() => useUpload())).toThrow(/must be inside UploadProvider/i);
  });

  it('dentro Provider stato pulito', () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    expect(result.current.queue).toEqual([]);
    expect(result.current.activeCount).toBe(0);
    expect(result.current.queuedCount).toBe(0);
  });
});

describe('enqueue', () => {
  it('0 file queue vuota', () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    act(() => {
      result.current.enqueue([], 'clip', makeClip(), null, 'team-1', () => {});
    });
    expect(result.current.queue).toHaveLength(0);
  });

  it('1 file con metadati', () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    const clip = makeClip({ id_clip: 'C9999', cliente_nome: 'Kalea' });
    const file = makeFakeFile('video.mp4', 10000);
    act(() => {
      result.current.enqueue([file], 'clip', clip, null, 'team-1', () => {});
    });
    expect(result.current.queue).toHaveLength(1);
    const item = result.current.queue[0];
    expect(item.status).toBe('queued');
    expect(item.fileName).toBe('video.mp4');
    expect(item.fileSize).toBe(10000);
    expect(item.clipCode).toBe('C9999');
    expect(item.clienteNome).toBe('Kalea');
  });

  it('3 file id univoci', () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    const files = [
      makeFakeFile('a.mp4', 1000),
      makeFakeFile('b.mp4', 2000),
      makeFakeFile('c.mp4', 3000),
    ];
    act(() => {
      result.current.enqueue(files, 'clip', makeClip(), null, 'team-1', () => {});
    });
    expect(result.current.queue).toHaveLength(3);
    const ids = result.current.queue.map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('enqueue cumulativo', () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    act(() => {
      result.current.enqueue([makeFakeFile('primo.mp4', 100)], 'clip', makeClip(), null, 'team-1', () => {});
    });
    act(() => {
      result.current.enqueue([makeFakeFile('secondo.mp4', 200)], 'clip', makeClip(), null, 'team-1', () => {});
    });
    expect(result.current.queue).toHaveLength(2);
    expect(result.current.queue[0].fileName).toBe('primo.mp4');
    expect(result.current.queue[1].fileName).toBe('secondo.mp4');
  });

  it('zona file_esportato', () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    act(() => {
      result.current.enqueue([makeFakeFile('export.mp4', 5000)], 'file_esportato', makeClip(), null, 'team-1', () => {});
    });
    expect(result.current.queue[0].zone).toBe('file_esportato');
  });
});

describe('file oversize', () => {
  it('5GB+1 fail con messaggio oversize', async () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    const file = makeFakeFile('big.mov', 5 * 1024 * 1024 * 1024 + 1);
    act(() => {
      result.current.enqueue([file], 'clip', makeClip(), null, 'team-1', () => {});
    });
    await waitFor(() => expect(result.current.queue[0].status).toBe('failed'));
    expect(result.current.queue[0].errorMsg).toMatch(/troppo grande/i);
  });

  it('esatto 5GB accettato', async () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    const file = makeFakeFile('limit.mov', 5 * 1024 * 1024 * 1024);
    act(() => {
      result.current.enqueue([file], 'clip', makeClip(), null, 'team-1', () => {});
    });
    await waitFor(() => expect(result.current.queue[0].status).toBe('failed'));
    expect(result.current.queue[0].errorMsg).not.toMatch(/troppo grande/i);
  });
});

describe('edge init failure', () => {
  it('errore propagato', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Google Drive quota exceeded' }),
      } as Response)
    );
    const { result } = renderHook(() => useUpload(), { wrapper });
    act(() => {
      result.current.enqueue([makeFakeFile('n.mp4', 1024)], 'clip', makeClip(), null, 'team-1', () => {});
    });
    await waitFor(() => expect(result.current.queue[0].status).toBe('failed'));
    expect(result.current.queue[0].errorMsg).toBe('Google Drive quota exceeded');
  });

  it('401 senza body', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      } as Response)
    );
    const { result } = renderHook(() => useUpload(), { wrapper });
    act(() => {
      result.current.enqueue([makeFakeFile('n.mp4', 1024)], 'clip', makeClip(), null, 'team-1', () => {});
    });
    await waitFor(() => expect(result.current.queue[0].status).toBe('failed'));
    expect(result.current.queue[0].errorMsg).toMatch(/401/);
  });
});

describe('pause resume cancel retry', () => {
  it('pause queued to paused', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useUpload(), { wrapper });
    act(() => {
      result.current.enqueue([makeFakeFile('v.mp4', 1024)], 'clip', makeClip(), null, 'team-1', () => {});
    });
    const id = result.current.queue[0].id;
    act(() => { result.current.pause(id); });
    expect(result.current.queue[0].status).toBe('paused');
  });

  it('resume paused to queued', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useUpload(), { wrapper });
    act(() => {
      result.current.enqueue([makeFakeFile('v.mp4', 1024)], 'clip', makeClip(), null, 'team-1', () => {});
    });
    const id = result.current.queue[0].id;
    act(() => { result.current.pause(id); });
    act(() => { result.current.resume(id); });
    expect(result.current.queue[0].status).toBe('queued');
  });

  it('cancel rimuove', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useUpload(), { wrapper });
    act(() => {
      result.current.enqueue([makeFakeFile('v.mp4', 1024)], 'clip', makeClip(), null, 'team-1', () => {});
    });
    const id = result.current.queue[0].id;
    act(() => { result.current.cancel(id); });
    expect(result.current.queue).toHaveLength(0);
  });

  it('retry resetta', async () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    act(() => {
      result.current.enqueue([makeFakeFile('v.mp4', 1024)], 'clip', makeClip(), null, 'team-1', () => {});
    });
    await waitFor(() => expect(result.current.queue[0].status).toBe('failed'));
    const id = result.current.queue[0].id;
    mockFetch.mockImplementation(() => new Promise(() => {}));
    act(() => { result.current.retry(id); });
    const item = result.current.queue[0];
    expect(item.status).toBe('queued');
    expect(item.percent).toBe(0);
    expect(item.errorMsg).toBeUndefined();
  });
});

describe('clearCompleted', () => {
  it('non rimuove failed', async () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    act(() => {
      result.current.enqueue(
        [makeFakeFile('a.mp4', 100), makeFakeFile('b.mp4', 200), makeFakeFile('c.mp4', 300)],
        'clip', makeClip(), null, 'team-1', () => {}
      );
    });
    await waitFor(() => {
      expect(result.current.queue.filter(u => u.status === 'failed').length).toBeGreaterThanOrEqual(2);
    });
    const before = result.current.queue.length;
    act(() => { result.current.clearCompleted(); });
    expect(result.current.queue.length).toBe(before);
  });
});

describe('MAX_CONCURRENT', () => {
  it('5 file solo 2 uploading', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useUpload(), { wrapper });
    const files = Array.from({ length: 5 }, (_, i) => makeFakeFile(`f-${i}.mp4`, 1024));
    act(() => {
      result.current.enqueue(files, 'clip', makeClip(), null, 'team-1', () => {});
    });
    await waitFor(() => expect(result.current.activeCount).toBe(2), { timeout: 2000 });
    expect(result.current.queuedCount).toBe(3);
  });
});

describe('derived counts', () => {
  it('queue vuota zero', () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    expect(result.current.activeCount).toBe(0);
    expect(result.current.queuedCount).toBe(0);
  });

  it('3 file 2 uploading 1 queued', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useUpload(), { wrapper });
    act(() => {
      result.current.enqueue(
        [makeFakeFile('a.mp4', 100), makeFakeFile('b.mp4', 200), makeFakeFile('c.mp4', 300)],
        'clip', makeClip(), null, 'team-1', () => {}
      );
    });
    await waitFor(() => expect(result.current.activeCount).toBe(2), { timeout: 2000 });
    expect(result.current.queuedCount).toBe(1);
  });
});
