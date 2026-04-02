import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Cliente, Contenuto } from '../types';

interface PianoEditorialeModalProps {
  cliente: Cliente;
  onClose: () => void;
}

export function PianoEditorialeModal({ cliente, onClose }: PianoEditorialeModalProps) {
  const [loading, setLoading] = useState(true);
  const [contenuti, setContenuti] = useState<Contenuto[]>([]);
  const [settimane, setSettimane] = useState(4);
  const [generating, setGenerating] = useState(false);

  const oggi = new Date();
  const dataFine = new Date(oggi);
  dataFine.setDate(oggi.getDate() + settimane * 7);

  const oggiStr = oggi.toISOString().slice(0, 10);
  const fineStr = dataFine.toISOString().slice(0, 10);

  useEffect(() => {
    setLoading(true);
    const fine = new Date();
    fine.setDate(fine.getDate() + settimane * 7);

    supabase
      .from('contenuti')
      .select('*')
      .eq('cliente_id', cliente.id)
      .not('data_pubblicazione', 'is', null)
      .gte('data_pubblicazione', oggiStr)
      .lte('data_pubblicazione', fine.toISOString().slice(0, 10))
      .order('data_pubblicazione', { ascending: true })
      .then(({ data }) => {
        setContenuti((data as Contenuto[]) || []);
        setLoading(false);
      });
  }, [cliente.id, settimane]);

  const formatDate = (d: string) => {
    const date = new Date(d + 'T00:00:00');
    return date.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short' });
  };

  const FASE_LABELS: Record<string, string> = {
    'Idea': 'In ideazione',
    'Script': 'In scrittura',
    'Girato': 'Riprese completate',
    'Pre montato': 'In pre-montaggio',
    'Montato': 'In montaggio',
    'Uploadato': 'In caricamento',
    'Revisionato': 'In revisione',
    'Programmato': 'Programmato',
    'Pubblicato': 'Pubblicato',
  };

  const generatePDF = async () => {
    setGenerating(true);
    try {
    const { jsPDF } = await import('jspdf');
    const autoTableModule = await import('jspdf-autotable');
    const autoTable = autoTableModule.default;

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;

    // ─── HEADER ───
    // Linea decorativa top
    doc.setFillColor(139, 92, 246); // viola Fuyue
    doc.rect(0, 0, pageWidth, 3, 'F');

    // Titolo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(30, 30, 60);
    doc.text('Piano Editoriale', margin, 22);

    // Cliente
    doc.setFontSize(14);
    doc.setTextColor(139, 92, 246);
    doc.text(cliente.nome, margin, 32);

    // Periodo
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 120);
    const periodoStart = oggi.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
    const periodoEnd = dataFine.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
    doc.text(`Periodo: ${periodoStart} — ${periodoEnd}`, margin, 40);
    doc.text(`Contenuti programmati: ${contenuti.length}`, margin, 46);

    // Linea separatore
    doc.setDrawColor(220, 220, 230);
    doc.setLineWidth(0.3);
    doc.line(margin, 50, pageWidth - margin, 50);

    // ─── TABELLA ───
    if (contenuti.length > 0) {
      const tableData = contenuti.map((c, i) => [
        (i + 1).toString(),
        c.data_pubblicazione ? formatDate(c.data_pubblicazione) : '—',
        c.ora_pubblicazione ? c.ora_pubblicazione.slice(0, 5) : '—',
        c.titolo.length > 40 ? c.titolo.slice(0, 40) + '…' : c.titolo,
        c.tipo || 'Reel',
        c.canale || 'Instagram',
        FASE_LABELS[c.fase] || c.fase,
      ]);

      autoTable(doc, {
        startY: 55,
        margin: { left: margin, right: margin },
        head: [['#', 'Data', 'Ora', 'Contenuto', 'Formato', 'Canale', 'Stato']],
        body: tableData,
        headStyles: {
          fillColor: [139, 92, 246],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9,
          cellPadding: 3,
        },
        bodyStyles: {
          fontSize: 8.5,
          cellPadding: 2.5,
          textColor: [40, 40, 60],
        },
        alternateRowStyles: {
          fillColor: [248, 247, 255],
        },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 24 },
          2: { cellWidth: 14, halign: 'center' },
          3: { cellWidth: 'auto' },
          4: { cellWidth: 20 },
          5: { cellWidth: 22 },
          6: { cellWidth: 28 },
        },
      });
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(11);
      doc.setTextColor(150, 150, 160);
      doc.text('Nessun contenuto programmato per questo periodo.', margin, 65);
    }

    // ─── DETTAGLIO CONTENUTI ───
    if (contenuti.length > 0) {
      const lastY = (doc as any).lastAutoTable?.finalY || 100;
      let y = lastY + 12;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(30, 30, 60);
      doc.text('Dettaglio Contenuti', margin, y);
      y += 8;

      for (const c of contenuti) {
        if (y > 260) {
          doc.addPage();
          y = 20;
        }

        // Box contenuto
        doc.setFillColor(248, 247, 255);
        doc.roundedRect(margin, y - 3, pageWidth - margin * 2, c.hook ? 28 : 18, 2, 2, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(139, 92, 246);
        const dataLabel = c.data_pubblicazione ? formatDate(c.data_pubblicazione) : '';
        doc.text(`${dataLabel}${c.ora_pubblicazione ? ' ' + c.ora_pubblicazione.slice(0, 5) : ''}`, margin + 3, y + 3);

        doc.setTextColor(30, 30, 60);
        doc.setFontSize(9.5);
        doc.text(c.titolo.slice(0, 70), margin + 40, y + 3);

        if (c.hook) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 120);
          const hookText = c.hook.length > 90 ? c.hook.slice(0, 90) + '…' : c.hook;
          doc.text(`Hook: ${hookText}`, margin + 3, y + 11);
        }

        if (c.cta) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 120);
          doc.text(`CTA: ${c.cta.slice(0, 60)}`, margin + 3, y + (c.hook ? 19 : 11));
        }

        y += c.hook ? 32 : 22;
      }
    }

    // ─── FOOTER ───
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      const pageH = doc.internal.pageSize.getHeight();

      // Linea footer
      doc.setDrawColor(220, 220, 230);
      doc.setLineWidth(0.3);
      doc.line(margin, pageH - 18, pageWidth - margin, pageH - 18);

      // Testo footer
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(150, 150, 160);
      doc.text('Fuyue Digital Agency — Content Production & Social Media Marketing', margin, pageH - 12);
      doc.text('Catanzaro, Calabria | fuyue.it', margin, pageH - 8);

      doc.text(`Pagina ${i} di ${pageCount}`, pageWidth - margin - 25, pageH - 12);

      // Barra viola bottom
      doc.setFillColor(139, 92, 246);
      doc.rect(0, pageH - 3, pageWidth, 3, 'F');
    }

    // ─── SALVA ───
    const fileName = `Piano_Editoriale_${cliente.nome.replace(/[^a-zA-Z0-9]/g, '_')}_${oggiStr}.pdf`;
    doc.save(fileName);
    } catch (err: any) {
      console.error('[PianoEditoriale] Errore generazione PDF:', err);
      alert('Errore generazione PDF: ' + (err.message || err));
    }
    setGenerating(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden" style={{ background: 'hsl(var(--background))' }}>
        {/* Header */}
        <div className="p-5 border-b" style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                📋 Piano Editoriale
              </h2>
              <p className="text-sm mt-0.5" style={{ color: 'hsl(270 60% 55%)' }}>{cliente.nome}</p>
            </div>
            <button onClick={onClose} className="text-xl hover:opacity-60">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Periodo */}
          <div>
            <label className="text-xs font-medium" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
              Periodo
            </label>
            <div className="flex gap-2 mt-1">
              {[2, 4, 6, 8].map(n => (
                <button
                  key={n}
                  onClick={() => setSettimane(n)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: settimane === n ? 'hsl(270 60% 55%)' : 'hsl(var(--muted))',
                    color: settimane === n ? 'white' : 'hsl(var(--skorpio-text-secondary))',
                  }}
                >
                  {n} settimane
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          {loading ? (
            <div className="text-center py-6 text-sm text-muted-foreground">Caricamento...</div>
          ) : contenuti.length === 0 ? (
            <div className="rounded-xl p-4 text-center" style={{ background: 'hsl(38 92% 50% / 0.06)', border: '1px solid hsl(38 92% 50% / 0.2)' }}>
              <p className="text-sm" style={{ color: 'hsl(38 80% 35%)' }}>
                ⚠️ Nessun contenuto programmato per {cliente.nome} nelle prossime {settimane} settimane
              </p>
            </div>
          ) : (
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'hsl(var(--muted))' }}>
              <p className="text-xs font-medium" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                Anteprima ({contenuti.length} contenuti)
              </p>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {contenuti.map(c => (
                  <div key={c.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg" style={{ background: 'hsl(var(--background))' }}>
                    <span className="font-mono text-[10px] w-16 flex-shrink-0" style={{ color: 'hsl(270 60% 55%)' }}>
                      {c.data_pubblicazione ? formatDate(c.data_pubblicazione) : '—'}
                    </span>
                    <span className="flex-1 truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                      {c.titolo}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'hsl(270 60% 55% / 0.1)', color: 'hsl(270 60% 55%)' }}>
                      {c.fase}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t flex gap-2" style={{ borderColor: 'hsl(var(--border))' }}>
          <button
           onClick={() => { console.log('CLICK PDF', contenuti.length, generating); generatePDF(); }}
           disabled={false}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: contenuti.length > 0 ? 'hsl(270 60% 55%)' : 'hsl(var(--muted))',
              color: contenuti.length > 0 ? 'white' : 'hsl(var(--skorpio-text-tertiary))',
              opacity: generating ? 0.6 : 1,
            }}
          >
            {generating ? '⏳ Generazione...' : `📄 Scarica PDF (${contenuti.length} contenuti)`}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-sm font-medium border"
            style={{ borderColor: 'hsl(var(--border))' }}
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
}
