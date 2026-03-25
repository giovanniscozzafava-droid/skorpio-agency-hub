// ─── Abstract StorageService Interface ─────────────────────────────────────

export interface ClipMetadata {
  clipId: string;
  clientName: string;
  clipTitle: string;
  operatorName?: string;
}

export interface StorageResult {
  fileId: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
}

export interface StorageUsage {
  used: number;   // bytes
  total: number;  // bytes
  byClient?: Record<string, { used: number; fileCount: number }>;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface StorageService {
  /**
   * Upload a file to storage.
   * @param file - The File object to upload
   * @param metadata - Clip metadata for folder/name generation
   * @param onProgress - Optional progress callback
   */
  upload(
    file: File,
    metadata: ClipMetadata,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<StorageResult>;

  /**
   * Get a direct URL for viewing/downloading a file.
   */
  getFileUrl(fileId: string): Promise<string>;

  /**
   * Delete a file from storage.
   * @returns true if deleted successfully
   */
  deleteFile(fileId: string): Promise<boolean>;

  /**
   * Get current storage usage stats.
   */
  getStorageUsage(): Promise<StorageUsage>;
}

/**
 * Slugify a string for use in file names.
 * e.g. "Lettera alla me stessa" → "Lettera-alla-me-stessa"
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 50);
}

/**
 * Build a canonical file name for a clip.
 * e.g. "CLP012_Lettera-alla-me-stessa.mp4"
 */
export function buildClipFileName(clipId: string, title: string, ext: string): string {
  const slug = slugify(title || clipId);
  const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
  return `${clipId}_${slug}${cleanExt}`;
}
