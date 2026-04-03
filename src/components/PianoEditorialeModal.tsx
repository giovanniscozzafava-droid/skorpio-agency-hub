import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Cliente, Contenuto } from '../types';

interface PianoEditorialeModalProps {
  cliente: Cliente;
  onClose: () => void;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

const FASE_LABELS: Record<string, string> = {
  'Idea': 'In ideazione', 'Script': 'In scrittura', 'Girato': 'Riprese fatte',
  'Pre montato': 'Pre-montaggio', 'Montato': 'In montaggio', 'Uploadato': 'Caricato',
  'Revisionato': 'In revisione', 'Programmato': 'Programmato', 'Pubblicato': 'Pubblicato',
};

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short' });
}

export function PianoEditorialeModal({ cliente, onClose }: PianoEditorialeModalProps) {
  const [loading, setLoading] = useState(true);
  const [contenuti, setContenuti] = useState<Contenuto[]>([]);
  const [settimane, setSettimane] = useState(4);
  const [generating, setGenerating] = useState(false);
  const oggi = new Date();
  const oggiStr = oggi.toISOString().slice(0, 10);

  useEffect(() => {
    setLoading(true);
    const fine = new Date();
    fine.setDate(fine.getDate() + settimane * 7);
    supabase.from('contenuti').select('*').eq('cliente_id', cliente.id)
      .not('data_pubblicazione', 'is', null)
      .gte('data_pubblicazione', oggiStr)
      .lte('data_pubblicazione', fine.toISOString().slice(0, 10))
      .order('data_pubblicazione', { ascending: true })
      .then(({ data }) => { setContenuti((data as Contenuto[]) || []); setLoading(false); });
  }, [cliente.id, settimane]);

  const generatePDF = async () => {
    setGenerating(true);
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
      const { jsPDF } = (window as any).jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pw = doc.internal.pageSize.getWidth();
      const m = 15;
      doc.setFillColor(139, 92, 246); doc.rect(0, 0, pw, 3, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(30, 30, 60);
      doc.text('Piano Editoriale', m, 22);
      doc.setFontSize(14); doc.setTextColor(139, 92, 246); doc.text(cliente.nome, m, 32);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100, 100, 120);
      const dataFine = new Date(); dataFine.setDate(dataFine.getDate() + settimane * 7);
      const p1 = oggi.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
      const p2 = dataFine.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
      doc.text('Periodo: ' + p1 + ' \u2014 ' + p2, m, 40);
      doc.text('Contenuti programmati: ' + contenuti.length, m, 46);
      doc.setDrawColor(220, 220, 230); doc.line(m, 50, pw - m, 50);
      const rows = contenuti.map((c, i) => [
        String(i + 1),
        c.data_pubblicazione ? formatDate(c.data_pubblicazione) : '\u2014',
        c.ora_pubblicazione ? c.ora_pubblicazione.slice(0, 5) : '\u2014',
        c.titolo.length > 40 ? c.titolo.slice(0, 40) + '\u2026' : c.titolo,
        c.tipo || 'Reel', c.canale || 'Instagram', FASE_LABELS[c.fase] || c.fase,
      ]);
      doc.autoTable({
        startY: 55, margin: { left: m, right: m },
        head: [['#', 'Data', 'Ora', 'Contenuto', 'Formato', 'Canale', 'Stato']],
        body: rows,
        headStyles: { fillColor: [139, 92, 246], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 8.5, textColor: [40, 40, 60] },
        alternateRowStyles: { fillColor: [248, 247, 255] },
        columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 24 }, 2: { cellWidth: 14, halign: 'center' }, 4: { cellWidth: 20 }, 5: { cellWidth: 22 }, 6: { cellWidth: 28 } },
      });
      let y = doc.lastAutoTable.finalY + 12;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(30, 30, 60);
      doc.text('Dettaglio Contenuti', m, y); y += 8;
      for (const c of contenuti) {
        if (y > 260) { doc.addPage(); y = 20; }
        doc.setFillColor(248, 247, 255);
        doc.roundedRect(m, y - 3, pw - m * 2, c.hook ? 28 : 18, 2, 2, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(139, 92, 246);
        doc.text((c.data_pubblicazione ? formatDate(c.data_pubblicazione) : '') + ' ' + (c.ora_pubblicazione ? c.ora_pubblicazione.slice(0, 5) : ''), m + 3, y + 3);
        doc.setTextColor(30, 30, 60); doc.setFontSize(9.5); doc.text(c.titolo.slice(0, 70), m + 40, y + 3);
        if (c.hook) { doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100, 100, 120); doc.text('Hook: ' + (c.hook.length > 90 ? c.hook.slice(0, 90) + '...' : c.hook), m + 3, y + 11); }
        if (c.cta) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 100, 120); doc.text('CTA: ' + c.cta.slice(0, 60), m + 3, y + (c.hook ? 19 : 11)); }
        y += c.hook ? 32 : 22;
      }
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i); const ph = doc.internal.pageSize.getHeight();
        doc.setDrawColor(220, 220, 230); doc.line(m, ph - 18, pw - m, ph - 18);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(150, 150, 160);
        doc.text('Fuyue Digital Agency \u2014 Content Production & Social Media Marketing', m, ph - 12);
        doc.text('Catanzaro, Calabria | fuyue.it', m, ph - 8);
        doc.text('Pagina ' + i + ' di ' + pages, pw - m - 25, ph - 12);
        doc.setFillColor(139, 92, 246); doc.rect(0, ph - 3, pw, 3, 'F');
      }
      doc.save('Piano_Editoriale_' + cliente.nome.replace(/[^a-zA-Z0-9]/g, '_') + '_' + oggiStr + '.pdf');
    } catch (err: any) {
      console.error('[PianoEditoriale] Errore:', err);
      alert('Errore generazione PDF: ' + (err.message || err));
    }
    setGenerating(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden" style={{ background: 'hsl(var(--background))' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>📋 Piano Editoriale</h2>
              <p className="text-sm mt-0.5" style={{ color: 'hsl(270 60% 55%)' }}>{cliente.nome}</p>
            </div>
            <button onClick={onClose} className="text-xl hover:opacity-60 cursor-pointer">✕</button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Periodo</label>
            <div className="flex gap-2 mt-1">
              {[2, 4, 6, 8].map(n => (
                <button key={n} onClick={() => setSettimane(n)} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer"
                  style={{ background: settimane === n ? 'hsl(270 60% 55%)' : 'hsl(var(--muted))', color: settimane === n ? 'white' : 'hsl(var(--skorpio-text-secondary))' }}>
                  {n} sett.
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="text-center py-6 text-sm text-muted-foreground">Caricamento...</div>
          ) : contenuti.length === 0 ? (
            <div className="rounded-xl p-4 text-center" style={{ background: 'hsl(38 92% 50% / 0.06)', border: '1px solid hsl(38 92% 50% / 0.2)' }}>
              <p className="text-sm" style={{ color: 'hsl(38 80% 35%)' }}>⚠️ Nessun contenuto programmato nelle prossime {settimane} settimane</p>
            </div>
          ) : (
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'hsl(var(--muted))' }}>
              <p className="text-xs font-medium" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Anteprima ({contenuti.length} contenuti)</p>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {contenuti.map(c => (
                  <div key={c.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg" style={{ background: 'hsl(var(--background))' }}>
                    <span className="font-mono text-[10px] w-16 flex-shrink-0" style={{ color: 'hsl(270 60% 55%)' }}>{c.data_pubblicazione ? formatDate(c.data_pubblicazione) : '\u2014'}</span>
                    <span className="flex-1 truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{c.titolo}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'hsl(270 60% 55% / 0.1)', color: 'hsl(270 60% 55%)' }}>{c.fase}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="p-5 border-t flex gap-2" style={{ borderColor: 'hsl(var(--border))' }}>
          <button onClick={generatePDF} disabled={generating || contenuti.length === 0}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer"
            style={{ background: contenuti.length > 0 ? 'hsl(270 60% 55%)' : 'hsl(var(--muted))', color: contenuti.length > 0 ? 'white' : 'hsl(var(--skorpio-text-tertiary))', opacity: generating ? 0.6 : 1, cursor: "pointer", position: "relative", zIndex: 10 }}>
            {generating ? '⏳ Generazione...' : '📄 Scarica PDF (' + contenuti.length + ' contenuti)'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-medium border cursor-pointer" style={{ borderColor: 'hsl(var(--border))' }}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}
