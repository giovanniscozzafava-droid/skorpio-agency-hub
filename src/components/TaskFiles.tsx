import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface TaskFile {
  id: string;
  task_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  created_at: string;
}

interface Props {
  taskId: string;
  userName: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function getFileIcon(mime: string, name: string): string {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('word') || name.endsWith('.docx') || name.endsWith('.doc')) return '📄';
  if (mime.includes('sheet') || mime.includes('excel') || name.endsWith('.xlsx')) return '📊';
  if (mime.includes('presentation') || name.endsWith('.pptx')) return '📑';
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('archive')) return '📦';
  if (mime.includes('audio') || name.endsWith('.mp3') || name.endsWith('.wav')) return '🎵';
  if (name.endsWith('.psd') || name.endsWith('.ai') || name.endsWith('.eps')) return '🎨';
  return '📎';
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ora';
  if (mins < 60) return mins + ' min fa';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h fa';
  const days = Math.floor(hrs / 24);
  return days + 'g fa';
}

export function TaskFiles({ taskId, userName }: Props) {
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('task_files')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });
    setFiles((data as TaskFile[]) || []);
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const uploadFiles = async (fileList: FileList | File[]) => {
    setUploading(true);
    const arr = Array.from(fileList);
    let done = 0;

    for (const file of arr) {
      const ext = file.name.split('.').pop() || '';
      const path = `${taskId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      const { error: uploadErr } = await supabase.storage
        .from('task-files')
        .upload(path, file, { upsert: false });

      if (uploadErr) {
        console.error('Upload error:', uploadErr);
        continue;
      }

      await supabase.from('task_files').insert({
        task_id: taskId,
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
        uploaded_by: userName,
      });

      done++;
      setProgress(Math.round(done / arr.length * 100));
    }

    setUploading(false);
    setProgress(0);
    await load();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  const downloadFile = async (file: TaskFile) => {
    const { data } = await supabase.storage
      .from('task-files')
      .createSignedUrl(file.file_path, 3600);
    if (data?.signedUrl) {
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = file.file_name;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const deleteFile = async (file: TaskFile) => {
    await supabase.storage.from('task-files').remove([file.file_path]);
    await supabase.from('task_files').delete().eq('id', file.id);
    setFiles(prev => prev.filter(f => f.id !== file.id));
  };

  const getPreviewUrl = (file: TaskFile) => {
    if (!file.mime_type.startsWith('image/')) return null;
    const { data } = supabase.storage.from('task-files').getPublicUrl(file.file_path);
    return data?.publicUrl || null;
  };

  return (
    <div>
      <p className="text-xs font-medium mb-2" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
        ALLEGATI {files.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }}>{files.length}</span>}
      </p>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-all"
        style={{
          borderColor: dragging ? 'hsl(var(--primary))' : 'hsl(var(--border))',
          background: dragging ? 'hsl(var(--primary) / 0.05)' : 'transparent',
        }}>
        {uploading ? (
          <div>
            <p className="text-xs font-medium" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>Caricamento... {progress}%</p>
            <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: 'hsl(var(--border))' }}>
              <div className="h-full rounded-full transition-all" style={{ width: progress + '%', background: 'hsl(var(--primary))' }} />
            </div>
          </div>
        ) : (
          <div>
            <span className="text-xl">📎</span>
            <p className="text-xs mt-1" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
              Trascina file qui o <span style={{ color: 'hsl(var(--primary))' }}>sfoglia</span>
            </p>
          </div>
        )}
        <input ref={inputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {files.map(f => {
            const preview = getPreviewUrl(f);
            return (
              <div key={f.id} className="flex items-center gap-2 rounded-lg p-2 group transition-colors"
                style={{ background: 'hsl(var(--muted))' }}>

                {/* Preview or icon */}
                {preview ? (
                  <img src={preview} alt="" className="w-9 h-9 rounded-md object-cover flex-shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-md flex items-center justify-center text-lg flex-shrink-0"
                    style={{ background: 'hsl(var(--background))' }}>
                    {getFileIcon(f.mime_type, f.file_name)}
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                    {f.file_name}
                  </p>
                  <p className="text-[10px]" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                    {formatSize(f.file_size)} · {f.uploaded_by} · {timeAgo(f.created_at)}
                  </p>
                </div>

                {/* Actions */}
                <button onClick={() => downloadFile(f)} className="text-xs px-2 py-1 rounded-md cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
                  style={{ background: 'hsl(var(--primary) / 0.1)', color: 'hsl(var(--primary))' }} title="Scarica">
                  ↓
                </button>
                <button onClick={() => deleteFile(f)} className="text-xs px-2 py-1 rounded-md cursor-pointer opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
                  style={{ background: 'hsl(0 80% 55% / 0.1)', color: 'hsl(0 70% 45%)' }} title="Elimina">
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
