import React, { useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ClienteLogo } from './ClienteLogo';

const EXPORT_SIZE = 256;

interface LogoUploaderProps {
  clienteId: string;
  clienteNome: string;
  currentLogoUrl?: string | null;
  onSaved: (logoUrl: string) => void;
}

export function LogoUploader({ clienteId, clienteNome, currentLogoUrl, onSaved }: LogoUploaderProps) {
  const [editing, setEditing] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setImageEl(img);
        setImage(e.target?.result as string);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
        setEditing(true);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const handleMouseUp = () => setDragging(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    setDragging(true);
    setDragStart({ x: t.clientX - offset.x, y: t.clientY - offset.y });
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging) return;
    const t = e.touches[0];
    setOffset({ x: t.clientX - dragStart.x, y: t.clientY - dragStart.y });
  };

  const save = async () => {
    if (!imageEl || !canvasRef.current) return;
    setSaving(true);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    canvas.width = EXPORT_SIZE;
    canvas.height = EXPORT_SIZE;

    // White circle background
    ctx.beginPath();
    ctx.arc(EXPORT_SIZE / 2, EXPORT_SIZE / 2, EXPORT_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.clip();

    // Draw image
    const previewSize = 120;
    const scale = EXPORT_SIZE / previewSize;
    const imgAspect = imageEl.width / imageEl.height;
    let drawW: number, drawH: number;
    if (imgAspect > 1) {
      drawH = EXPORT_SIZE * zoom;
      drawW = drawH * imgAspect;
    } else {
      drawW = EXPORT_SIZE * zoom;
      drawH = drawW / imgAspect;
    }
    const drawX = (EXPORT_SIZE - drawW) / 2 + offset.x * scale;
    const drawY = (EXPORT_SIZE - drawH) / 2 + offset.y * scale;
    ctx.drawImage(imageEl, drawX, drawY, drawW, drawH);

    // Convert to base64 (JPEG per ridurre dimensione)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    // Save to DB
    const { error } = await supabase
      .from('clienti')
      .update({ logo_url: dataUrl })
      .eq('id', clienteId);

    if (error) {
      console.error('Errore salvataggio logo:', error);
    } else {
      onSaved(dataUrl);
    }

    setSaving(false);
    setEditing(false);
    setImage(null);
    setImageEl(null);
  };

  const removeLogo = async () => {
    setSaving(true);
    await supabase.from('clienti').update({ logo_url: null }).eq('id', clienteId);
    onSaved('');
    setSaving(false);
  };

  if (editing && image) {
    return (
      <div className="flex flex-col items-center gap-2 p-3 rounded-xl" style={{ background: 'hsl(var(--skorpio-surface))' }}>
        <p className="text-xs font-medium text-muted-foreground">Posiziona il logo nel cerchio</p>
        <div
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUp}
          className="rounded-full overflow-hidden cursor-grab active:cursor-grabbing relative"
          style={{ width: 120, height: 120, background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.15)' }}
        >
          <img
            src={image}
            alt="crop"
            draggable={false}
            className="absolute select-none pointer-events-none"
            style={{
              width: imageEl && imageEl.width > imageEl.height ? 'auto' : 120 * zoom,
              height: imageEl && imageEl.width > imageEl.height ? 120 * zoom : 'auto',
              minWidth: imageEl && imageEl.width > imageEl.height ? 120 * zoom : undefined,
              minHeight: imageEl && imageEl.width > imageEl.height ? undefined : 120 * zoom,
              left: '50%',
              top: '50%',
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
          />
        </div>
        <input
          type="range"
          min="0.3"
          max="3"
          step="0.05"
          value={zoom}
          onChange={e => setZoom(parseFloat(e.target.value))}
          className="w-full max-w-[160px]"
        />
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'hsl(142 70% 45%)', color: 'white', opacity: saving ? 0.5 : 1 }}
          >
            {saving ? '⏳…' : '✅ Salva'}
          </button>
          <button
            onClick={() => { setEditing(false); setImage(null); setImageEl(null); }}
            className="px-4 py-1.5 rounded-lg text-xs font-medium border border-border"
          >
            Annulla
          </button>
        </div>
        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div
        className="cursor-pointer hover:opacity-80 transition-opacity relative group"
        onClick={() => fileRef.current?.click()}
        title="Clicca per cambiare logo"
      >
        <ClienteLogo nome={clienteNome} logoUrl={currentLogoUrl} size={48} />
        <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          <span className="text-white text-sm">📷</span>
        </div>
      </div>
      {currentLogoUrl && (
        <button
          onClick={removeLogo}
          className="text-[10px] text-muted-foreground hover:text-red-500 transition-colors"
          title="Rimuovi logo"
        >
          ✕
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  );
}
