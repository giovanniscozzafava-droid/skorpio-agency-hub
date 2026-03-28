import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import type { Contenuto, FaseCLP, TeamMember, Cliente } from '../types';
import { parseLocalDate } from '../lib/dateUtils';
import { CLPDetailPanel } from './CLPDetailPanel';
import { NuovoCLPModal } from './NuovoCLPModal';
import { cambiaFaseCLP } from '../services/faseService';
import { FASE_CONFIG } from '../config/faseConfig';

const FASI: FaseCLP[] = ['Idea', 'Script', 'Girato', 'Pre montato', 'Montato', 'Uploadato', 'Revisionato', 'Programmato', 'Pubblicato', 'Scartata'];

// [UNIFIED - old] FASE_CONFIG duplicato rimosso — ora importato da config/faseConfig.ts

const CANALI = ['Instagram', 'Facebook', 'Instagram/Facebook', 'TikTok', 'LinkedIn', 'YouTube', 'Altro'];
const TIPI = ['Reel', 'Post', 'Carosello', 'Story', 'Video', 'Short', 'Altro'];

interface ContentTabProps {
  team: TeamMember[];
  clienti: Cliente[];
}

export function ContenutiTab({ team, clienti }: ContentTabProps) {
  const { addToast, utente } = useApp();
  const [contenuti, setContenuti] = useState<Contenuto[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroFase, setFiltroFase] = useState<string>('');
  const [filtroCliente, setFiltroCliente] = useState<string>('');
  const [ricerca, setRicerca] = useState('');
  const [selected, setSelected] = useState<Contenuto | null>(null);
  const [showNuovo, setShowNuovo] = useState(false);

  useEffect(() => {
    loadContenuti();
  }, []);

  const loadContenuti = async () => {
    const { data } = await supabase
      .from('contenuti')
      .select('*')
      .order('created_at', { ascending: false });
    setContenuti(data || []);
    setLoading(false);
  };

  const filtered = contenuti.filter(c => {
    if (filtroFase && c.fase !== filtroFase) return false;
    if (filtroCliente && c.cliente_id !== filtroCliente) return false;
    if (ricerca) {
      const q = ricerca.toLowerCase();
      if (!c.titolo.toLowerCase().includes(q) &&
          !c.id_display.toLowerCase().includes(q) &&
          !c.cliente_nome.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const handleUpdate = (updated: Contenuto) => {
    setContenuti(prev => prev.map(c => c.id === updated.id ? updated : c));
    setSelected(updated);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Eliminare questo contenuto e le clip collegate?')) return;
    await supabase.from('log_riprese').delete().eq('contenuto_id', id);
    await supabase.from('contenuti').delete().eq('id', id);
    setContenuti(prev => prev.filter(c => c.id !== id));
    setSelected(null);
    addToast('Contenuto eliminato', 'info');
  };

  // [OLD - replaced by FaseService]
  // const handleFaseChange_OLD = async (contenuto: Contenuto, nuovaFase: FaseCLP) => {
  //   const { data, error } = await supabase
  //     .from('contenuti').update({ fase: nuovaFase }).eq('id', contenuto.id).select().single();
  //   if (!error && data) {
  //     if (nuovaFase === 'Pubblicato' && contenuto.fase !== 'Pubblicato' && contenuto.tipo === 'Reel' && contenuto.cliente_id) {
  //       const cliente = clienti.find(c => c.id === contenuto.cliente_id);
  //       if (cliente) {
  //         const nuoviReel = cliente.reel_fatti + 1;
  //         await supabase.from('clienti').update({ reel_fatti: nuoviReel }).eq('id', cliente.id);
  //       }
  //     }
  //     if (nuovaFase === 'Montato' && contenuto.fase !== 'Montato' && !contenuto.link_drive) {
  //       // ... logica Drive folder ...
  //     }
  //     handleUpdate(data as Contenuto);
  //     addToast(`Fase → ${nuovaFase}`, 'success');
  //   }
  // };

  // ── NUOVO: usa FaseService centralizzato ──
  const handleFaseChange = async (contenuto: Contenuto, nuovaFase: FaseCLP) => {
    console.log('[Step2a]');
    console.log('[ContenutiTab] handleFaseChange via FaseService', { id: contenuto.id, oldFase: contenuto.fase, nuovaFase });
    const result = await cambiaFaseCLP({
      contenutoId: contenuto.id,
      nuovaFase,
      source: 'contenuti',
      userId: utente?.id || 'unknown',
    });

    if (!result.success) {
      addToast('Errore cambio fase: ' + result.errors.join(', '), 'error');
      return;
    }

    // Ricarica il contenuto aggiornato
    const { data: fresh } = await supabase
      .from('contenuti').select('*').eq('id', contenuto.id).single();
    if (fresh) {
      handleUpdate(fresh as Contenuto);
    }

    // Feedback specifico
    if (result.reelIncremented) {
      const cliente = clienti.find(c => c.id === contenuto.cliente_id);
      if (cliente) {
        const nuoviReel = cliente.reel_fatti + 1;
        const emoji = nuoviReel <= cliente.reel_quota ? '🟢' : '🔴';
        addToast(`${emoji} Reel pubblicato! ${nuoviReel}/${cliente.reel_quota} per ${cliente.nome}`, nuoviReel > cliente.reel_quota ? 'warn' : 'success');
      }
    }
    if (result.driveFolder) {
      addToast(`📁 Cartella Drive creata! → ${contenuto.id_display}`, 'success');
    }
    if (result.taskCreated) {
      addToast(`📋 Task workflow creato`, 'info');
    }

    addToast(`Fase → ${nuovaFase}`, 'success');
  };

  const contatoreFasi = FASI.reduce((acc, f) => {
    acc[f] = contenuti.filter(c => c.fase === f).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="flex flex-col h-[calc(100vh-100px)]">
      {/* Toolbar */}
      <div className="flex-shrink-0 px-4 py-3 border-b bg-card flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📹</span>
          <h2 className="font-bold text-base" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
            Contenuti CLP
          </h2>
        </div>

        {/* Filtro fase */}
        <select
          className="sk-select text-sm"
          style={{ width: 160 }}
          value={filtroFase}
          onChange={e => setFiltroFase(e.target.value)}
        >
          <option value="">Tutte le fasi</option>
          {FASI.map(f => (
            <option key={f} value={f}>{f} ({contatoreFasi[f] || 0})</option>
          ))}
        </select>

        {/* Filtro cliente */}
        <select
          className="sk-select text-sm"
          style={{ width: 180 }}
          value={filtroCliente}
          onChange={e => setFiltroCliente(e.target.value)}
        >
          <option value="">Tutti i clienti</option>
          {clienti.map(c => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>

        {/* Ricerca */}
        <input
          type="text"
          className="sk-input text-sm"
          style={{ width: 200 }}
          placeholder="🔍 Cerca titolo, ID, cliente…"
          value={ricerca}
          onChange={e => setRicerca(e.target.value)}
        />

        <span className="text-xs ml-auto" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
          {filtered.length} / {contenuti.length} contenuti
        </span>

        <button
          onClick={() => setShowNuovo(true)}
          className="sk-btn-primary text-sm flex-shrink-0"
        >
          + Nuovo CLP
        </button>
      </div>

      {/* Contatori fasi — pill bar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 overflow-x-auto border-b"
        style={{ background: 'hsl(210 20% 98%)' }}>
        <button
          onClick={() => setFiltroFase('')}
          className="stat-pill text-xs flex-shrink-0 cursor-pointer transition-all"
          style={{
            background: !filtroFase ? '#1E293B' : 'hsl(210 40% 94%)',
            color: !filtroFase ? 'white' : 'hsl(var(--skorpio-text-secondary))',
          }}
        >
          Tutti ({contenuti.length})
        </button>
        {FASI.map(f => {
          const cfg = FASE_CONFIG[f];
          const cnt = contatoreFasi[f] || 0;
          const active = filtroFase === f;
          return (
            <button
              key={f}
              onClick={() => setFiltroFase(filtroFase === f ? '' : f)}
              className="stat-pill text-xs flex-shrink-0 cursor-pointer transition-all"
              style={{
                background: active ? cfg.text : cfg.bg,
                color: active ? 'white' : cfg.text,
                border: `1px solid ${cfg.border}`,
              }}
            >
              {f} {cnt > 0 && <span className="ml-1 font-bold">{cnt}</span>}
            </button>
          );
        })}
      </div>

      {/* Tabella */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="sk-spinner" style={{ color: '#3B82F6' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <div className="text-3xl mb-2">📭</div>
            <p className="text-sm">Nessun contenuto trovato</p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10"
              style={{ background: 'hsl(210 40% 97%)', borderBottom: '1px solid hsl(var(--border))' }}>
              <tr>
                {['ID', 'Cliente', 'Titolo', 'Tipo', 'Canale', 'Fase', 'Ripresa', 'Pubblicaz.', 'Ora', 'Riprese →', 'Montaggio →'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold px-3 py-2.5"
                    style={{ color: 'hsl(var(--skorpio-text-tertiary))', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const faseCfg = FASE_CONFIG[c.fase];
                const member = team.find(m => m.nome === c.assegnato_riprese);
                const memberM = team.find(m => m.nome === c.assegnato_montaggio);
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className="cursor-pointer transition-colors hover:bg-blue-50/40 border-b"
                    style={{
                      background: selected?.id === c.id ? 'hsl(214 100% 98%)' : i % 2 === 0 ? 'white' : 'hsl(210 20% 99%)',
                      borderColor: 'hsl(var(--border))',
                    }}
                  >
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs font-medium" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                        {c.id_display}
                        {c.generato_da_ai && <span className="ml-1 text-xs">🤖</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs truncate block max-w-[120px]" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                        {c.cliente_nome || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-xs block max-w-[200px] truncate" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                        {c.titolo}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                        {c.tipo || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                        {c.canale || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="fase-badge whitespace-nowrap"
                        style={{ background: faseCfg.bg, color: faseCfg.text, border: `1px solid ${faseCfg.border}` }}
                      >
                        {c.fase}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                        {c.data_ripresa ? parseLocalDate(c.data_ripresa).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                        {c.data_pubblicazione ? parseLocalDate(c.data_pubblicazione).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs font-mono" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                        {c.ora_pubblicazione ? c.ora_pubblicazione.slice(0, 5) : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {c.assegnato_riprese ? (
                        <div className="flex items-center gap-1">
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                            style={{ backgroundColor: member?.colore || '#64748B', fontSize: 8 }}
                          >
                            {c.assegnato_riprese.charAt(0)}
                          </div>
                          <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                            {c.assegnato_riprese}
                          </span>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {c.assegnato_montaggio ? (
                        <div className="flex items-center gap-1">
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                            style={{ backgroundColor: memberM?.colore || '#64748B', fontSize: 8 }}
                          >
                            {c.assegnato_montaggio.charAt(0)}
                          </div>
                          <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                            {c.assegnato_montaggio}
                          </span>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Panel */}
      {selected && (
        <CLPDetailPanel
          contenuto={selected}
          team={team}
          clienti={clienti}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onFaseChange={handleFaseChange}
        />
      )}

      {/* Nuovo CLP Modal */}
      {showNuovo && (
        <NuovoCLPModal
          team={team}
          clienti={clienti}
          onClose={() => setShowNuovo(false)}
          onCreated={(c) => {
            setContenuti(prev => [c, ...prev]);
            addToast(`✅ ${c.id_display} creato`, 'success');
          }}
        />
      )}
    </div>
  );
}
