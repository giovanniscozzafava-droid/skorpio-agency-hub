// ─── Storage Factory ─────────────────────────────────────────────────────────
// Returns the active StorageService driver based on STORAGE_DRIVER env var.
// Currently supported: 'google-drive'
// Future: 'cloudflare-r2', 's3'

import type { StorageService } from './StorageService';
import { GoogleDriveStorage } from './GoogleDriveStorage';

export type StorageDriver = 'google-drive';

let _instance: StorageService | null = null;

export function getStorageService(driver?: StorageDriver): StorageService {
  const activeDriver: StorageDriver =
    driver ||
    (import.meta.env.VITE_STORAGE_DRIVER as StorageDriver) ||
    'google-drive';

  if (!_instance) {
    switch (activeDriver) {
      case 'google-drive':
        _instance = new GoogleDriveStorage();
        break;
      default:
        throw new Error(`Unsupported storage driver: ${activeDriver}`);
    }
  }

  return _instance;
}

// Reset instance (useful for testing / driver switching)
export function resetStorageService(): void {
  _instance = null;
}

export type { StorageService, ClipMetadata, StorageResult, StorageUsage, UploadProgress } from './StorageService';
