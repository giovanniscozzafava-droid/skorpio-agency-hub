// ─── Google Drive Storage Implementation ─────────────────────────────────────
// Uses Edge Functions as proxy to handle OAuth2 tokens server-side.

import type { StorageService, ClipMetadata, StorageResult, StorageUsage, UploadProgress } from './StorageService';
import { buildClipFileName } from './StorageService';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function invokeEdgeFunction(path: string, options: RequestInit = {}) {
  const url = `${SUPABASE_URL}/functions/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Edge function error ${res.status}: ${body}`);
  }
  return res.json();
}

export class GoogleDriveStorage implements StorageService {
  async upload(
    file: File,
    metadata: ClipMetadata,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<StorageResult> {
    const ext = file.name.split('.').pop() || 'mp4';
    const fileName = buildClipFileName(metadata.clipId, metadata.clipTitle, ext);

    // Step 1: Get resumable upload URL from edge function
    const { uploadUrl, folderId } = await invokeEdgeFunction('google-drive-upload-init', {
      method: 'POST',
      body: JSON.stringify({
        fileName,
        mimeType: file.type || 'video/mp4',
        fileSize: file.size,
        clientName: metadata.clientName,
      }),
    });

    // Step 2: Upload file in chunks using resumable upload protocol
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
    let uploadedBytes = 0;
    let fileId = '';

    while (uploadedBytes < file.size) {
      const chunk = file.slice(uploadedBytes, uploadedBytes + CHUNK_SIZE);
      const end = Math.min(uploadedBytes + CHUNK_SIZE - 1, file.size - 1);

      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${uploadedBytes}-${end}/${file.size}`,
          'Content-Type': file.type || 'video/mp4',
        },
        body: chunk,
      });

      if (res.status === 308) {
        // Incomplete — continue
        const range = res.headers.get('Range');
        if (range) {
          uploadedBytes = parseInt(range.split('-')[1]) + 1;
        } else {
          uploadedBytes += chunk.size;
        }
      } else if (res.status === 200 || res.status === 201) {
        const data = await res.json();
        fileId = data.id;
        uploadedBytes = file.size;
      } else {
        throw new Error(`Upload chunk failed: ${res.status}`);
      }

      onProgress?.({
        loaded: uploadedBytes,
        total: file.size,
        percent: Math.round((uploadedBytes / file.size) * 100),
      });
    }

    if (!fileId) {
      throw new Error('Upload completed but no file ID returned');
    }

    // Step 3: Get file URL
    const fileUrl = `https://drive.google.com/file/d/${fileId}/view`;

    return {
      fileId,
      fileUrl,
      fileName,
      fileSize: file.size,
      mimeType: file.type || 'video/mp4',
      uploadedAt: new Date().toISOString(),
    };
  }

  async getFileUrl(fileId: string): Promise<string> {
    return `https://drive.google.com/file/d/${fileId}/view`;
  }

  async deleteFile(fileId: string): Promise<boolean> {
    try {
      await invokeEdgeFunction('google-drive-delete', {
        method: 'POST',
        body: JSON.stringify({ fileId }),
      });
      return true;
    } catch (err) {
      console.error('[GoogleDriveStorage] deleteFile failed:', err);
      return false;
    }
  }

  async getStorageUsage(): Promise<StorageUsage> {
    try {
      const data = await invokeEdgeFunction('google-drive-usage', {
        method: 'GET',
      });
      return {
        used: data.used ?? 0,
        total: data.total ?? 0,
        byClient: data.byClient ?? {},
      };
    } catch (err) {
      console.error('[GoogleDriveStorage] getStorageUsage failed:', err);
      return { used: 0, total: 0 };
    }
  }

  // Exposed for folder ID info (used by upload-init)
  static _folderId: string | null = null;
}
