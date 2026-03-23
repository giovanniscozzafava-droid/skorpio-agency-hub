import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import type { Cliente, TeamMember } from '../types';

interface BrandRules {
  id?: string;
  cliente_id?: string;
  cliente_nome: string;
  identita: string;
  nome_brand: string;
  toni_voce: string;
  formati_preferiti: string;
  servizi_principali: string;
  pubblico_target: string;
  differenziatori: string;
  competitor: string;
  stile_visivo: string;
  hashtag_fissi: string;
  do_list: string;
  dont_list: string;
  territorio: string;
  personaggi: string;
  note: string;
}

interface ContenutoGenerato {
  titolo: string;
  formato: string;
  tono: string;
  hook: string;
  script: string;
  cta: string;
  hashtag: string[];
  note_produzione: string;
  _editing?: boolean;
  _saved?: boolean;
}

const FORMATI_CHIP = ['Reel', 'Carosello', 'Post singolo', 'Stories', 'TikTok'];
const TONI_CHIP = ['Comedy', 'Divulgativo', 'Storytelling', 'Promozionale', 'Emozionale', 'Trend'];
const QUANTITA_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];

const FORMATO_COLORI: Record<string, { bg: string; text: string }> = {
  'Reel': { bg: '#EDE9FE', text: '#7C3AED' },
  'Carosello': { bg: '#DBEAFE', text: '#1D4ED8' },
  'Post singolo': { bg: '#DCFCE7', text: '#16A34A' },
  'Stories': { bg: '#FCE7F3', text: '#BE185D' },
  'TikTok': { bg: '#FEE2E2', text: '#DC2626' },
};

const TONO_COLORI: Record<string, { bg: string; text: string }> = {
  'Comedy': { bg: '#FEF3C7', text: '#D97706' },
  'Divulgativo': { bg: '#CFFAFE', text: '#0E7490' },
  'Storytelling': { bg: '#EDE9FE', text: '#6D28D9' },
  'Promozionale': { bg: '#DBEAFE', text: '#1D4ED8' },
  'Emozionale': { bg: '#FCE7F3', text: '#BE185D' },
  'Trend': { bg: '#FFF7ED', text: '#EA580C' },
};

const EMPTY_BR: Omit<BrandRules, 'cliente_nome'> = {
  identita: '', nome_brand: '', toni_voce: '', formati_preferiti: '',
  servizi_principali: '', pubblico_target: '', differenziatori: '',
  competitor: '', stile_visivo: '', hashtag_fissi: '',
  do_list: '', dont_list: '', territorio: '', personaggi: '', note: '',
};

interface Props {
  clienti: Cliente[];
  team: TeamMember[];
}

export function CreativeEngineTab({ clienti, team }: Props) {
  const { addToast } = useApp();

  // Configurazione
  const [clienteId, setClienteId] = useState('');
  const [periodo, setPeriodo] = useState('');
  const [formatiSel, setFormatiSel] = useState<string[]>(['Reel']);
  const [toniSel, setToniSel] = useState<string[]>(['Divulgativo']);
  const [quantita, setQuantita] = useState(3);

  // Brand Rules
  const [brandRules, setBrandRules] = useState<BrandRules | null>(null);
  const [showBRModal, setShowBRModal] = useState(false);
  const [brForm, setBrForm] = useState<BrandRules>({ cliente_nome: '', ...EMPTY_BR });
  const [savingBR, setSavingBR] = useState(false);

  // Generazione
  const [loading, setLoading] = useState(false);
  const [risultati, setRisultati] = useState<ContenutoGenerato[]>([]);
  const [stats, setStats] = useState<{ input: number; output: number; costo: number } | null>(null);

  // Editing singolo contenuto
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<ContenutoGenerato>>({});

  const clienteSelezionato = clienti.find(c => c.id === clienteId);

  useEffect(() => {
    if (clienteId) loadBrandRules(clienteId);
    else setBrandRules(null);
  }, [clienteId]);

  const loadBrandRules = async (id: string) => {
    const { data } = await supabase
      .from('brand_rules')
      .select('*')
      .eq('cliente_id', id)
      .maybeSingle();
    setBrandRules(data as BrandRules | null);
  };

  const toggleChip = (val: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(val) ? list.filter(v => v !== val) : [...list, val]);
  };

  const openBRModal = () => {
    const cliente = clienteSelezionato;
    if (!cliente) return;
    setBrForm({
      ...(brandRules ? { ...brandRules } : { ...EMPTY_BR }),
      cliente_nome: brandRules?.cliente_nome || cliente.nome,
      cliente_id: cliente.id,
    });
    setShowBRModal(true);
  };

  const saveBrandRules = async () => {
    if (!clienteId) return;
    setSavingBR(true);
    const payload = { ...brForm, cliente_id: clienteId, cliente_nome: clienteSelezionato?.nome || brForm.cliente_nome, updated_at: new Date().toISOString() };
    if (brandRules?.id) {
      await supabase.from('brand_rules').update(payload).eq('id', brandRules.id);
    } else {
      await supabase.from('brand_rules').insert(payload);
    }
    await loadBrandRules(clienteId);
    setSavingBR(false);
    setShowBRModal(false);
    addToast('✅ Brand Rules salvate!', 'success');
  };

  const genera = async () => {
    if (!clienteId || formatiSel.length === 0 || toniSel.length === 0) return;
    setLoading(true);
    setRisultati([]);
    setStats(null);
    try {
      const { data, error } = await supabase.functions.invoke('generate-content', {
        body: {
          clienteId,
          clienteNome: clienteSelezionato?.nome,
          periodo,
          formati: formatiSel,
          toni: toniSel,
          quantita,
          brandRules,
        },
      });
      if (error) throw new Error(error.message);
      if (data.error) {
        addToast(`❌ ${data.error}`, 'error');
        return;
      }
      setRisultati(data.contenuti || []);
      setStats(data.tokens);
      addToast(`✨ ${data.contenuti?.length || 0} contenuti generati!`, 'success');
    } catch (e: any) {
      addToast(`❌ Errore: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const salvaCLP = async (c: ContenutoGenerato, idx: number) => {
    if (!clienteId) return;
    const cliente = clienteSelezionato!;
    const { data: newCLP, error } = await supabase
      .from('contenuti')
      .insert({
        id_display: await generaIdDisplay(),
        titolo: c.titolo,
        cliente_id: clienteId,
        cliente_nome: cliente.nome,
        tipo: mapFormato(c.formato),
        fase: 'Idea',
        hook: c.hook,
        script: c.script,
        cta: c.cta,
        hashtag: c.hashtag.map(h => h.startsWith('#') ? h : `#${h}`).join(' '),
        note: c.note_produzione,
        generato_da_ai: true,
      })
      .select()
      .single();

    if (error) { addToast(`❌ Errore salvataggio: ${error.message}`, 'error'); return; }
    setRisultati(prev => prev.map((r, i) => i === idx ? { ...r, _saved: true } : r));
    addToast(`✅ ${newCLP.id_display} salvato in Contenuti!`, 'success');
  };

  const salvaTutti = async () => {
    const nonSalvati = risultati.filter(r => !r._saved);
    for (let i = 0; i < nonSalvati.length; i++) {
      const idx = risultati.indexOf(nonSalvati[i]);
      await salvaCLP(nonSalvati[i], idx);
      await new Promise(r => setTimeout(r, 200));
    }
    addToast(`✅ ${nonSalvati.length} contenuti salvati!`, 'success');
  };

  const aiCounterRef = React.useRef<number | null>(null);

  const generaIdDisplay = async (): Promise<string> => {
    const clientePrefix = clienteSelezionato?.nome?.toUpperCase().replace(/\s+/g, '-').slice(0, 8) || 'AI';
    // Se abbiamo già un contatore locale (batch save), incrementiamo senza riqueryare
    if (aiCounterRef.current !== null) {
      aiCounterRef.current += 1;
      return `${clientePrefix}-AI-${String(aiCounterRef.current).padStart(3, '0')}`;
    }
    // Prima volta: leggi il massimo corrente dal DB
    const { data } = await supabase
      .from('contenuti')
      .select('id_display')
      .ilike('id_display', '%-AI-%')
      .order('id_display', { ascending: false })
      .limit(50);

    let maxNum = 0;
    (data || []).forEach((row: { id_display: string }) => {
      const match = row.id_display.match(/(\d+)$/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
    });
    aiCounterRef.current = maxNum + 1;
    return `${clientePrefix}-AI-${String(aiCounterRef.current).padStart(3, '0')}`;
  };

  const mapFormato = (f: string): string => {
    const map: Record<string, string> = {
      'Reel': 'Reel', 'Carosello': 'Carosello', 'Post singolo': 'Post',
      'Stories': 'Story', 'TikTok': 'Video',
    };
    return map[f] || 'Altro';
  };

  const startEdit = (idx: number) => {
    setEditIdx(idx);
    setEditForm({ ...risultati[idx] });
  };

  const saveEdit = (idx: number) => {
    setRisultati(prev => prev.map((r, i) => i === idx ? { ...r, ...editForm } : r));
    setEditIdx(null);
  };

  return (
    <div className="flex h-[calc(100vh-100px)] overflow-hidden">
      {/* ─── Pannello Configurazione ─── */}
      <div className="w-[320px] flex-shrink-0 border-r flex flex-col overflow-y-auto"
        style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
        
        {/* Header */}
        <div className="px-4 py-4 border-b flex-shrink-0" style={{ borderColor: 'hsl(var(--border))' }}>
          <div className="flex items-center gap-2">
            <span className="text-xl">🤖</span>
            <div>
              <h2 className="font-bold text-sm" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>Creative Engine</h2>
              <p className="text-xs" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>Genera contenuti con AI</p>
            </div>
          </div>
        </div>

        <div className="flex-1 px-4 py-4 space-y-5">
          {/* Cliente */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
              Cliente *
            </label>
            <select
              className="sk-select text-sm w-full"
              value={clienteId}
              onChange={e => setClienteId(e.target.value)}
            >
              <option value="">Seleziona cliente…</option>
              {clienti.filter(c => c.stato === 'Attivo').map(c => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>

            {/* Brand Rules status */}
            {clienteId && (
              <div className="mt-2 flex items-center justify-between">
                {brandRules ? (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: '#DCFCE7', color: '#16A34A' }}>
                    ✅ Brand rules caricate
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: '#FEF3C7', color: '#D97706' }}>
                    ⚠️ Nessuna brand rule
                  </span>
                )}
                <button
                  onClick={openBRModal}
                  className="text-xs font-medium hover:underline"
                  style={{ color: '#3B82F6' }}>
                  🎨 Gestisci
                </button>
              </div>
            )}
          </div>

          {/* Periodo */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
              Periodo / Tema
            </label>
            <input
              type="text"
              className="sk-input text-sm w-full"
              placeholder="es: Marzo 2026, San Valentino, Estate…"
              value={periodo}
              onChange={e => setPeriodo(e.target.value)}
            />
          </div>

          {/* Formati */}
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
              Formati
            </label>
            <div className="flex flex-wrap gap-1.5">
              {FORMATI_CHIP.map(f => {
                const sel = formatiSel.includes(f);
                const col = FORMATO_COLORI[f] || { bg: '#F1F5F9', text: '#64748B' };
                return (
                  <button
                    key={f}
                    onClick={() => toggleChip(f, formatiSel, setFormatiSel)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium transition-all border"
                    style={sel
                      ? { background: col.text, color: 'white', borderColor: col.text }
                      : { background: col.bg, color: col.text, borderColor: col.text + '60' }
                    }
                  >
                    {f}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Toni */}
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
              Toni di voce
            </label>
            <div className="flex flex-wrap gap-1.5">
              {TONI_CHIP.map(t => {
                const sel = toniSel.includes(t);
                const col = TONO_COLORI[t] || { bg: '#F1F5F9', text: '#64748B' };
                return (
                  <button
                    key={t}
                    onClick={() => toggleChip(t, toniSel, setToniSel)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium transition-all border"
                    style={sel
                      ? { background: col.text, color: 'white', borderColor: col.text }
                      : { background: col.bg, color: col.text, borderColor: col.text + '60' }
                    }
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quantità */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
              Quantità contenuti
            </label>
            <select
              className="sk-select text-sm w-full"
              value={quantita}
              onChange={e => setQuantita(Number(e.target.value))}
            >
              {QUANTITA_OPTIONS.map(n => (
                <option key={n} value={n}>{n} contenuti</option>
              ))}
            </select>
          </div>
        </div>

        {/* CTA Genera */}
        <div className="px-4 py-4 border-t flex-shrink-0 space-y-2" style={{ borderColor: 'hsl(var(--border))' }}>
          <button
            onClick={genera}
            disabled={!clienteId || loading || formatiSel.length === 0 || toniSel.length === 0}
            className="w-full py-3 px-4 rounded-lg text-sm font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: (!clienteId || loading)
                ? '#94A3B8'
                : 'linear-gradient(135deg, #8B5CF6, #3B82F6)',
              boxShadow: (!clienteId || loading) ? 'none' : '0 4px 15px rgba(139,92,246,0.4)',
            }}
          >
            {loading ? '⏳ Generando…' : '✨ Genera con AI'}
          </button>

          {/* Stats bar */}
          {stats && (
            <div className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg"
              style={{ background: 'hsl(210 20% 97%)', color: 'hsl(var(--skorpio-text-secondary))' }}>
              <span>📊 {stats.input.toLocaleString()} in</span>
              <span className="opacity-40">/</span>
              <span>{stats.output.toLocaleString()} out</span>
              <span className="opacity-40 ml-auto">💰</span>
              <span>~€{stats.costo.toFixed(4)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ─── Area Risultati ─── */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'hsl(var(--skorpio-bg))' }}>
        {/* Risultati header */}
        {risultati.length > 0 && (
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b"
            style={{ background: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}>
            <span className="text-sm font-semibold" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
              {risultati.length} contenuti generati
              {clienteSelezionato && (
                <span className="ml-2 font-normal text-xs" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                  per {clienteSelezionato.nome}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={salvaTutti}
                className="sk-btn-primary text-xs py-1.5 px-3"
                disabled={risultati.every(r => r._saved)}
              >
                💾 Salva tutti in CLP
              </button>
              <button
                onClick={() => { setRisultati([]); setStats(null); }}
                className="text-xs px-3 py-1.5 rounded border font-medium transition-colors"
                style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--skorpio-text-secondary))' }}
              >
                🗑️ Pulisci
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-purple-200 border-t-purple-600 animate-spin" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-sm" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                  L'AI sta creando i contenuti…
                </p>
                <p className="text-xs mt-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
                  Analisi brand rules, calendario marketing, trend
                </p>
              </div>
            </div>
          ) : risultati.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
              <div className="text-6xl">✨</div>
              <div>
                <p className="font-semibold text-base" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                  Pronto a generare
                </p>
                <p className="text-sm mt-1" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
                  Seleziona un cliente, scegli i formati e i toni, poi clicca "Genera con AI"
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {['brand rules', 'calendario marketing 2026', 'formati selezionati', 'toni di voce'].map(h => (
                  <span key={h} className="text-xs px-2.5 py-1 rounded-full"
                    style={{ background: '#EDE9FE', color: '#7C3AED' }}>
                    {h}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
              {risultati.map((c, idx) => (
                <RisultatoCard
                  key={idx}
                  contenuto={c}
                  idx={idx}
                  editIdx={editIdx}
                  editForm={editForm}
                  setEditForm={setEditForm}
                  onEdit={() => startEdit(idx)}
                  onSaveEdit={() => saveEdit(idx)}
                  onCancelEdit={() => setEditIdx(null)}
                  onSalvaCLP={() => salvaCLP(c, idx)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Brand Rules Modal ─── */}
      {showBRModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => e.target === e.currentTarget && setShowBRModal(false)}>
          <div className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col mx-4"
            style={{ border: '1px solid hsl(var(--border))' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
              style={{ borderColor: 'hsl(var(--border))' }}>
              <h3 className="font-bold text-base" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
                🎨 Brand Rules — {clienteSelezionato?.nome}
              </h3>
              <button onClick={() => setShowBRModal(false)}
                className="text-lg w-7 h-7 flex items-center justify-center rounded hover:bg-muted"
                style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {[
                { key: 'identita', label: '🏷️ Identità brand', placeholder: 'Chi è questo brand? Cosa rappresenta?' },
                { key: 'nome_brand', label: '📛 Nome brand ufficiale', placeholder: 'Come si chiama il brand?' },
                { key: 'toni_voce', label: '🗣️ Toni di voce', placeholder: 'Come parla il brand? Formale, ironico, empatico...' },
                { key: 'servizi_principali', label: '💼 Servizi principali', placeholder: 'Cosa offre? Trattamenti, servizi, prodotti...' },
                { key: 'pubblico_target', label: '🎯 Pubblico target', placeholder: 'Chi sono i clienti ideali? Età, interessi...' },
                { key: 'differenziatori', label: '⭐ Differenziatori', placeholder: 'Cosa lo rende unico rispetto ai competitor?' },
                { key: 'competitor', label: '🥊 Competitor', placeholder: 'Chi sono i principali competitor?' },
                { key: 'stile_visivo', label: '🎨 Stile visivo', placeholder: 'Palette colori, estetica, mood delle immagini...' },
                { key: 'hashtag_fissi', label: '#️⃣ Hashtag fissi', placeholder: '#hashtag sempre presenti nei post' },
                { key: 'do_list', label: '✅ Da fare sempre', placeholder: 'Cosa includere sempre nei contenuti?' },
                { key: 'dont_list', label: '❌ Da evitare sempre', placeholder: 'Cosa NON dire o mostrare mai?' },
                { key: 'territorio', label: '📍 Territorio', placeholder: 'Dove opera? Città, regione, nazionale...' },
                { key: 'personaggi', label: '👤 Personaggi / figure', placeholder: 'C\'è un volto del brand? Una mascotte?' },
                { key: 'note', label: '📝 Note aggiuntive', placeholder: 'Qualsiasi altra info utile all\'AI...' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>{label}</label>
                  <textarea
                    rows={2}
                    className="sk-input text-xs w-full resize-none"
                    placeholder={placeholder}
                    value={(brForm as any)[key] || ''}
                    onChange={e => setBrForm(prev => ({ ...prev, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end px-5 py-4 border-t flex-shrink-0"
              style={{ borderColor: 'hsl(var(--border))' }}>
              <button onClick={() => setShowBRModal(false)}
                className="text-sm px-4 py-2 rounded border font-medium"
                style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--skorpio-text-secondary))' }}>
                Annulla
              </button>
              <button
                onClick={saveBrandRules}
                disabled={savingBR}
                className="sk-btn-primary text-sm"
              >
                {savingBR ? '⏳ Salvataggio…' : '💾 Salva Brand Rules'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Card singolo risultato ───────────────────────────────────────────────
interface CardProps {
  contenuto: ContenutoGenerato;
  idx: number;
  editIdx: number | null;
  editForm: Partial<ContenutoGenerato>;
  setEditForm: (f: Partial<ContenutoGenerato>) => void;
  onEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onSalvaCLP: () => void;
}

function RisultatoCard({ contenuto: c, idx, editIdx, editForm, setEditForm, onEdit, onSaveEdit, onCancelEdit, onSalvaCLP }: CardProps) {
  const isEditing = editIdx === idx;
  const data = isEditing ? editForm : c;

  const fmtCol = FORMATO_COLORI[c.formato] || { bg: '#F1F5F9', text: '#64748B' };
  const tonoCol = TONO_COLORI[c.tono] || { bg: '#F1F5F9', text: '#64748B' };

  return (
    <div className="rounded-xl border overflow-hidden flex flex-col transition-shadow hover:shadow-md"
      style={{
        background: 'hsl(var(--card))',
        borderColor: c._saved ? '#BBF7D0' : 'hsl(var(--border))',
        boxShadow: c._saved ? '0 0 0 1px #BBF7D0' : '0 1px 3px rgba(0,0,0,.06)',
      }}>
      
      {/* Card Header */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="px-2 py-0.5 rounded-full text-xs font-bold"
          style={{ background: fmtCol.bg, color: fmtCol.text }}>
          {c.formato}
        </span>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
          style={{ background: tonoCol.bg, color: tonoCol.text }}>
          {c.tono}
        </span>
        {c._saved && (
          <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ background: '#DCFCE7', color: '#16A34A' }}>
            ✅ Salvato
          </span>
        )}
      </div>

      {/* Titolo */}
      <div className="px-4 pb-2">
        {isEditing ? (
          <input
            className="sk-input text-sm font-semibold w-full"
            value={editForm.titolo || ''}
            onChange={e => setEditForm({ ...editForm, titolo: e.target.value })}
          />
        ) : (
          <h3 className="font-semibold text-sm" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>
            {c.titolo}
          </h3>
        )}
      </div>

      {/* Hook */}
      <div className="mx-4 mb-3 p-3 rounded-lg" style={{ background: 'hsl(214 100% 98%)' }}>
        <div className="text-xs font-semibold mb-1" style={{ color: '#3B82F6' }}>🎣 Hook</div>
        {isEditing ? (
          <textarea
            rows={2}
            className="sk-input text-xs w-full resize-none"
            value={editForm.hook || ''}
            onChange={e => setEditForm({ ...editForm, hook: e.target.value })}
          />
        ) : (
          <p className="text-xs leading-relaxed" style={{ color: 'hsl(var(--skorpio-text-primary))' }}>{c.hook}</p>
        )}
      </div>

      {/* Script */}
      <div className="px-4 mb-3">
        <div className="text-xs font-semibold mb-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>📝 Script</div>
        {isEditing ? (
          <textarea
            rows={4}
            className="sk-input text-xs w-full resize-none"
            value={editForm.script || ''}
            onChange={e => setEditForm({ ...editForm, script: e.target.value })}
          />
        ) : (
          <p className="text-xs leading-relaxed" style={{ color: 'hsl(var(--skorpio-text-secondary))' }}>
            {c.script}
          </p>
        )}
      </div>

      {/* Note produzione */}
      {(c.note_produzione || isEditing) && (
        <div className="px-4 mb-3">
          <div className="text-xs font-semibold mb-1" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>🎬 Note produzione</div>
          {isEditing ? (
            <textarea
              rows={2}
              className="sk-input text-xs w-full resize-none"
              value={editForm.note_produzione || ''}
              onChange={e => setEditForm({ ...editForm, note_produzione: e.target.value })}
            />
          ) : (
            <p className="text-xs italic" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>{c.note_produzione}</p>
          )}
        </div>
      )}

      {/* Footer: hashtag + CTA + actions */}
      <div className="px-4 pt-2 pb-3 mt-auto border-t" style={{ borderColor: 'hsl(var(--border))' }}>
        {/* Hashtag */}
        <div className="flex flex-wrap gap-1 mb-2">
          {(isEditing ? (editForm.hashtag || []) : (c.hashtag || [])).slice(0, 6).map((h, i) => (
            <span key={i} className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: '#EFF6FF', color: '#3B82F6' }}>
              {h.startsWith('#') ? h : `#${h}`}
            </span>
          ))}
          {(c.hashtag || []).length > 6 && !isEditing && (
            <span className="text-xs" style={{ color: 'hsl(var(--skorpio-text-tertiary))' }}>
              +{c.hashtag.length - 6}
            </span>
          )}
        </div>

        {/* CTA */}
        {(c.cta || (isEditing && editForm.cta)) && (
          <div className="mb-3 flex items-center gap-1.5">
            {isEditing ? (
              <input
                className="sk-input text-xs flex-1"
                value={editForm.cta || ''}
                placeholder="CTA…"
                onChange={e => setEditForm({ ...editForm, cta: e.target.value })}
              />
            ) : (
              <span className="text-xs px-2 py-0.5 rounded font-medium"
                style={{ background: '#FEF3C7', color: '#D97706' }}>
                👉 {c.cta}
              </span>
            )}
          </div>
        )}

        {/* Azioni */}
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <button onClick={onSaveEdit}
                className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-white"
                style={{ background: '#22C55E' }}>
                ✓ Applica modifiche
              </button>
              <button onClick={onCancelEdit}
                className="text-xs px-3 py-1.5 rounded-lg border font-medium"
                style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--skorpio-text-secondary))' }}>
                Annulla
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onSalvaCLP}
                disabled={c._saved}
                className="flex-1 text-xs py-1.5 rounded-lg font-semibold text-white transition-all disabled:opacity-50"
                style={{ background: c._saved ? '#94A3B8' : 'linear-gradient(135deg, #3B82F6, #2563EB)' }}>
                {c._saved ? '✅ Salvato' : '💾 Salva CLP'}
              </button>
              <button
                onClick={onEdit}
                className="text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors hover:bg-muted"
                style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--skorpio-text-secondary))' }}>
                ✏️
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
