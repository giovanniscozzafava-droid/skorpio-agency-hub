import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../integrations/supabase/client';
import { lovable } from '../integrations/lovable/index';
import { sounds } from '../lib/sounds';

type Mode = 'login' | 'signup' | 'forgot';

interface LandingPageProps {
  onAuthenticated: () => void;
}

/* ── animated counter ── */
function Counter({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      let start = 0;
      const step = Math.ceil(target / 60);
      const t = setInterval(() => {
        start = Math.min(start + step, target);
        setVal(start);
        if (start >= target) clearInterval(t);
      }, 16);
    }, { threshold: 0.4 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [target]);
  return <span ref={ref}>{val.toLocaleString('it-IT')}{suffix}</span>;
}

/* ── feature card ── */
function FeatureCard({
  icon, title, desc, color,
}: { icon: string; title: string; desc: string; color: string }) {
  return (
    <div
      className="group relative rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: `radial-gradient(ellipse at top left, ${color}10, transparent 70%)` }}
      />
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center text-xl mb-4"
        style={{ background: `${color}18`, border: `1px solid ${color}30` }}
      >
        {icon}
      </div>
      <h3 className="text-white font-semibold text-base mb-2">{title}</h3>
      <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>{desc}</p>
    </div>
  );
}

/* ── testimonial ── */
function Testimonial({ text, name, role, color }: { text: string; name: string; role: string; color: string }) {
  return (
    <div
      className="rounded-2xl p-6"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="flex gap-1 mb-4">
        {[...Array(5)].map((_, i) => (
          <span key={i} style={{ color: '#F59E0B', fontSize: 14 }}>★</span>
        ))}
      </div>
      <p className="text-sm leading-relaxed mb-5 italic" style={{ color: 'rgba(255,255,255,0.6)' }}>
        "{text}"
      </p>
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {name.charAt(0)}
        </div>
        <div>
          <p className="text-white text-sm font-semibold">{name}</p>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{role}</p>
        </div>
      </div>
    </div>
  );
}

export function LandingPage({ onAuthenticated }: LandingPageProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const authRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) { sounds.login(); onAuthenticated(); }
    });
    return () => subscription.unsubscribe();
  }, [onAuthenticated]);

  const reset = () => { setError(''); setSuccess(''); };

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); reset(); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'Email o password errata.' : error.message);
    else { sounds.login(); onAuthenticated(); }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault(); reset();
    if (password !== confirmPassword) { setError('Le password non coincidono.'); return; }
    if (password.length < 8) { setError('Password di almeno 8 caratteri.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setLoading(false);
    if (error) setError(error.message);
    else { setSuccess('Controlla la tua email per confermare l\'account.'); setMode('login'); }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault(); reset(); setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    setLoading(false);
    if (error) setError(error.message);
    else setSuccess('Link di reset inviato. Controlla la tua email.');
  }

  async function handleGoogle() {
    reset(); setLoading(true);
    const result = await lovable.auth.signInWithOAuth('google', { redirect_uri: window.location.origin });
    setLoading(false);
    if (result && 'error' in result && result.error) setError('Errore con Google Sign-In.');
  }

  const scrollToAuth = () => {
    authRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const inp = `w-full px-4 py-3 rounded-xl border outline-none text-sm transition-all bg-white/5 border-white/15 text-white placeholder-white/30 focus:border-white/50 focus:bg-white/8`;
  const btn = `w-full py-3 rounded-xl font-bold text-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]`;

  const features = [
    { icon: '📋', title: 'Kanban Avanzato', desc: 'Board realtime con drag & drop, priorità, scadenze e notifiche push per ogni membro del team.', color: '#3B82F6' },
    { icon: '📅', title: 'Calendario Integrato', desc: 'Tutti i task con scadenza finiscono automaticamente nel calendario. Nessun appuntamento perso.', color: '#8B5CF6' },
    { icon: '🎬', title: 'Gestione Contenuti', desc: 'Pipeline completa: idea → script → riprese → montaggio → pubblicazione con tracciamento fasi.', color: '#EC4899' },
    { icon: '🤖', title: 'Creative Engine AI', desc: 'Genera script, hook e caption personalizzati per ogni cliente in pochi secondi con AI avanzata.', color: '#10B981' },
    { icon: '💬', title: 'Chat Realtime', desc: 'Messaggi istantanei con emoji reaction, creazione task da messaggi e notifiche sonore.', color: '#F59E0B' },
    { icon: '📊', title: 'Dashboard Clienti', desc: 'Monitora pacchetti, quote reel/grafiche, stato abbonamenti e tutto il CRM in un solo posto.', color: '#EF4444' },
  ];

  const stats = [
    { value: 1200, suffix: '+', label: 'Task completati' },
    { value: 48, suffix: '', label: 'Clienti gestiti' },
    { value: 99, suffix: '%', label: 'Uptime garantito' },
    { value: 6, suffix: 'x', label: 'Produttività media' },
  ];

  const testimonials = [
    { text: 'Skorpio ha rivoluzionato il nostro flusso di lavoro. Adesso ogni contenuto ha una timeline precisa e nessuno si perde più un task.', name: 'Giovanni', role: 'Creative Director', color: '#3B82F6' },
    { text: 'Il Creative Engine AI ci fa risparmiare ore ogni settimana. Gli script vengono fuori già ottimizzati per il cliente.', name: 'Martina', role: 'Social Media Manager', color: '#EC4899' },
    { text: 'La chat con task integrati è una bomba. Prima usavamo 3 app diverse, ora tutto è in Skorpio.', name: 'Luca', role: 'Video Editor', color: '#10B981' },
  ];

  return (
    <div className="min-h-screen text-white" style={{ background: '#050914' }}>

      {/* ── NAVBAR ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          background: scrolled ? 'rgba(5,9,20,0.92)' : 'transparent',
          backdropFilter: scrolled ? 'blur(20px)' : 'none',
          borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : 'none',
        }}
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl select-none">🦂</span>
            <span className="text-xl font-extrabold tracking-tight">SKORPIO</span>
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full ml-1"
              style={{ background: 'hsl(217 91% 60% / 0.2)', color: 'hsl(217 91% 70%)' }}
            >
              v2.0
            </span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#stats" className="hover:text-white transition-colors">Statistiche</a>
            <a href="#team" className="hover:text-white transition-colors">Team</a>
          </div>
          <button
            onClick={scrollToAuth}
            className="px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-200 hover:scale-105"
            style={{ background: 'hsl(217 91% 60%)', color: 'white' }}
          >
            Accedi →
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative min-h-screen flex items-center justify-center px-6 pt-16 overflow-hidden">
        {/* Background mesh */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div
            className="absolute rounded-full blur-[140px] opacity-20"
            style={{ width: 700, height: 700, top: '-10%', left: '-15%', background: 'hsl(217 91% 60%)' }}
          />
          <div
            className="absolute rounded-full blur-[100px] opacity-10"
            style={{ width: 500, height: 500, bottom: '5%', right: '-10%', background: 'hsl(280 70% 60%)' }}
          />
          <div
            className="absolute rounded-full blur-[80px] opacity-8"
            style={{ width: 300, height: 300, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'hsl(45 93% 47%)' }}
          />
          {/* Grid overlay */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`,
              backgroundSize: '60px 60px',
            }}
          />
        </div>

        <div className="relative max-w-7xl mx-auto w-full grid lg:grid-cols-2 gap-16 items-center py-24">
          {/* Left — copy */}
          <div className="space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold"
              style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', color: '#93C5FD' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Fuyue Digital Agency — Gestionale Interno
            </div>

            {/* Headline */}
            <div>
              <h1 className="text-5xl lg:text-7xl font-black leading-[1.05] tracking-tight">
                <span className="block">Il cervello</span>
                <span className="block">della tua</span>
                <span
                  className="block"
                  style={{
                    background: 'linear-gradient(135deg, hsl(217 91% 65%), hsl(280 70% 65%))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  agenzia.
                </span>
              </h1>
              <p className="mt-6 text-lg lg:text-xl leading-relaxed max-w-lg" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Kanban, calendario, clienti, contenuti, AI e chat — tutto in un'unica piattaforma pensata per i team creativi che vogliono muoversi veloci.
              </p>
            </div>

            {/* CTA row */}
            <div className="flex flex-wrap gap-4">
              <button
                onClick={scrollToAuth}
                className="flex items-center gap-2.5 px-7 py-4 rounded-xl font-bold text-base transition-all duration-200 hover:scale-105 hover:shadow-lg"
                style={{
                  background: 'linear-gradient(135deg, hsl(217 91% 60%), hsl(217 91% 50%))',
                  color: 'white',
                  boxShadow: '0 0 40px hsl(217 91% 60% / 0.35)',
                }}
              >
                🚀 Accedi ora
              </button>
              <a
                href="#features"
                className="flex items-center gap-2 px-7 py-4 rounded-xl font-semibold text-base transition-all duration-200 hover:bg-white/8"
                style={{ border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)' }}
              >
                Scopri le feature ↓
              </a>
            </div>

            {/* Social proof strip */}
            <div className="flex items-center gap-6 pt-2">
              <div className="flex -space-x-2.5">
                {['#3B82F6', '#EC4899', '#10B981', '#F59E0B', '#8B5CF6'].map((c, i) => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: c, borderColor: '#050914' }}>
                    {['G', 'M', 'L', 'A', 'S'][i]}
                  </div>
                ))}
              </div>
              <div>
                <div className="flex gap-0.5 mb-0.5">
                  {[...Array(5)].map((_, i) => <span key={i} style={{ color: '#F59E0B', fontSize: 12 }}>★</span>)}
                </div>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Usato ogni giorno dal team Fuyue</p>
              </div>
            </div>
          </div>

          {/* Right — Auth form */}
          <div ref={authRef} className="w-full max-w-md mx-auto lg:mx-0 lg:ml-auto">
            {/* Glow */}
            <div
              className="absolute inset-0 rounded-3xl blur-3xl opacity-20 pointer-events-none"
              style={{ background: 'hsl(217 91% 60%)', transform: 'scale(0.8)' }}
            />
            <div
              className="relative rounded-3xl p-8"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                backdropFilter: 'blur(24px)',
                boxShadow: '0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)',
              }}
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="text-3xl select-none">🦂</div>
                <div>
                  <h2 className="text-lg font-extrabold text-white tracking-tight">SKORPIO</h2>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Portale Accesso Team</p>
                </div>
              </div>

              {/* Tabs */}
              {mode !== 'forgot' && (
                <div className="flex rounded-xl p-1 mb-6" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  {(['login', 'signup'] as Mode[]).map(m => (
                    <button key={m} onClick={() => { setMode(m); reset(); }}
                      className="flex-1 py-2 rounded-lg text-xs font-bold transition-all duration-200"
                      style={{
                        background: mode === m ? 'hsl(217 91% 60%)' : 'transparent',
                        color: mode === m ? 'white' : 'rgba(255,255,255,0.4)',
                      }}>
                      {m === 'login' ? 'Accedi' : 'Registrati'}
                    </button>
                  ))}
                </div>
              )}

              {mode === 'forgot' && (
                <div className="mb-5">
                  <button onClick={() => { setMode('login'); reset(); }}
                    className="flex items-center gap-1.5 text-xs mb-3 hover:opacity-80 transition-opacity"
                    style={{ color: 'rgba(255,255,255,0.45)' }}>
                    ← Torna al login
                  </button>
                  <h3 className="text-white font-bold text-base">Reset Password</h3>
                  <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Inserisci la tua email per ricevere il link.
                  </p>
                </div>
              )}

              {error && (
                <div className="mb-4 px-3 py-2.5 rounded-xl text-xs font-medium"
                  style={{ background: 'hsl(0 84% 60% / 0.15)', color: 'hsl(0 84% 70%)', border: '1px solid hsl(0 84% 60% / 0.3)' }}>
                  ⚠️ {error}
                </div>
              )}
              {success && (
                <div className="mb-4 px-3 py-2.5 rounded-xl text-xs font-medium"
                  style={{ background: 'hsl(142 71% 45% / 0.15)', color: 'hsl(142 71% 55%)', border: '1px solid hsl(142 71% 45% / 0.3)' }}>
                  ✅ {success}
                </div>
              )}

              {mode === 'login' && (
                <form onSubmit={handleLogin} className="space-y-3">
                  <input type="email" className={inp} placeholder="Email" value={email}
                    onChange={e => setEmail(e.target.value)} required autoComplete="email" />
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} className={inp}
                      placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
                      required autoComplete="current-password" />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-40 hover:opacity-80" style={{ color: 'white' }}>
                      {showPw ? '🙈' : '👁️'}
                    </button>
                  </div>
                  <div className="text-right">
                    <button type="button" onClick={() => { setMode('forgot'); reset(); }}
                      className="text-xs hover:opacity-80 transition-opacity" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      Password dimenticata?
                    </button>
                  </div>
                  <button type="submit" disabled={loading} className={`${btn} mt-2`}
                    style={{ background: 'hsl(217 91% 60%)', color: 'white' }}>
                    {loading ? '⏳ Accesso…' : '🔐 Accedi'}
                  </button>
                </form>
              )}

              {mode === 'signup' && (
                <form onSubmit={handleSignup} className="space-y-3">
                  <input type="email" className={inp} placeholder="Email" value={email}
                    onChange={e => setEmail(e.target.value)} required autoComplete="email" />
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} className={inp}
                      placeholder="Password (min. 8 caratteri)" value={password}
                      onChange={e => setPassword(e.target.value)} required autoComplete="new-password" />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-40 hover:opacity-80" style={{ color: 'white' }}>
                      {showPw ? '🙈' : '👁️'}
                    </button>
                  </div>
                  <input type={showPw ? 'text' : 'password'} className={inp}
                    placeholder="Conferma password" value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
                  <button type="submit" disabled={loading} className={`${btn} mt-2`}
                    style={{ background: 'hsl(217 91% 60%)', color: 'white' }}>
                    {loading ? '⏳ Registrazione…' : '✨ Crea Account'}
                  </button>
                </form>
              )}

              {mode === 'forgot' && (
                <form onSubmit={handleForgot} className="space-y-3">
                  <input type="email" className={inp} placeholder="La tua email" value={email}
                    onChange={e => setEmail(e.target.value)} required autoComplete="email" />
                  <button type="submit" disabled={loading} className={`${btn} mt-2`}
                    style={{ background: 'hsl(217 91% 60%)', color: 'white' }}>
                    {loading ? '⏳ Invio…' : '📧 Invia link reset'}
                  </button>
                </form>
              )}

              {mode !== 'forgot' && (
                <>
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>oppure</span>
                    <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                  </div>
                  <button onClick={handleGoogle} disabled={loading}
                    className={`${btn} flex items-center justify-center gap-2.5`}
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'white', border: '1px solid rgba(255,255,255,0.12)' }}>
                    <svg width="17" height="17" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continua con Google
                  </button>
                </>
              )}

              {/* Security badge */}
              <div className="flex items-center justify-center gap-1.5 mt-5 text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
                <svg width="11" height="11" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
                </svg>
                Accesso protetto da crittografia end-to-end
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce">
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>Scopri di più</span>
          <div className="w-5 h-8 rounded-full flex items-start justify-center pt-1.5"
            style={{ border: '1px solid rgba(255,255,255,0.15)' }}>
            <div className="w-1 h-2 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '0.2s' }} />
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section id="stats" className="py-20 px-6 relative">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, rgba(59,130,246,0.04), transparent)' }} />
        <div className="max-w-5xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-8">
          {stats.map((s, i) => (
            <div key={i} className="text-center">
              <div className="text-4xl lg:text-5xl font-black mb-2"
                style={{ background: 'linear-gradient(135deg, #fff, rgba(255,255,255,0.6))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                <Counter target={s.value} suffix={s.suffix} />
              </div>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold mb-5"
              style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', color: '#C4B5FD' }}>
              ⚡ Feature principali
            </div>
            <h2 className="text-4xl lg:text-5xl font-black mb-4">
              Tutto quello di cui<br />
              <span style={{ background: 'linear-gradient(135deg, hsl(217 91% 65%), hsl(280 70% 65%))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                un'agenzia ha bisogno.
              </span>
            </h2>
            <p className="text-lg max-w-xl mx-auto" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Niente fogli Excel, niente app separate. Tutto in una piattaforma costruita per chi crea contenuti.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f, i) => <FeatureCard key={i} {...f} />)}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-24 px-6 relative">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(59,130,246,0.06) 0%, transparent 70%)' }} />
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold mb-5"
              style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#6EE7B7' }}>
              🗺️ Come funziona
            </div>
            <h2 className="text-4xl font-black mb-4">Semplice da usare.<br />Potente per crescere.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8 relative">
            {/* connecting line */}
            <div className="hidden md:block absolute top-10 left-[16.67%] right-[16.67%] h-px"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.4), rgba(139,92,246,0.4), transparent)' }} />
            {[
              { n: '01', icon: '🔐', title: 'Accedi', desc: 'Login con email/password o Google. Il sistema ti riconosce automaticamente come membro del team.' },
              { n: '02', icon: '📋', title: 'Organizza', desc: 'Crea task, assegna ai colleghi, imposta priorità e scadenze. Il calendario si aggiorna da solo.' },
              { n: '03', icon: '🚀', title: 'Pubblica', desc: 'Usa l\'AI per generare script e caption, traccia le riprese, e pubblica contenuti di qualità.' },
            ].map((s, i) => (
              <div key={i} className="relative flex flex-col items-center text-center p-8 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-xl mb-4 relative z-10"
                  style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }}
                >
                  {s.icon}
                </div>
                <span className="absolute top-6 right-6 text-xs font-black opacity-15">{s.n}</span>
                <h3 className="text-white font-bold text-lg mb-2">{s.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section id="team" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold mb-5"
              style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#FCD34D' }}>
              💬 Il team dice
            </div>
            <h2 className="text-4xl font-black">Chi lo usa ogni giorno.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {testimonials.map((t, i) => <Testimonial key={i} {...t} />)}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto relative">
          <div
            className="rounded-3xl p-12 text-center relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15))',
              border: '1px solid rgba(59,130,246,0.25)',
            }}
          >
            <div className="absolute inset-0 rounded-3xl"
              style={{ background: 'radial-gradient(ellipse at center, rgba(59,130,246,0.1) 0%, transparent 70%)' }} />
            <div className="relative">
              <div className="text-5xl mb-6 select-none">🦂</div>
              <h2 className="text-4xl lg:text-5xl font-black mb-4">Pronto a salire a bordo?</h2>
              <p className="text-lg mb-8 max-w-xl mx-auto" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Accedi con le tue credenziali o crea un nuovo account. Il tuo profilo team ti aspetta.
              </p>
              <button
                onClick={scrollToAuth}
                className="inline-flex items-center gap-2.5 px-8 py-4 rounded-xl font-bold text-base transition-all duration-200 hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, hsl(217 91% 60%), hsl(217 91% 50%))',
                  color: 'white',
                  boxShadow: '0 0 50px hsl(217 91% 60% / 0.4)',
                }}
              >
                🚀 Entra in Skorpio
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="py-8 px-6 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🦂</span>
            <span className="font-bold text-white">SKORPIO</span>
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>by Fuyue Digital Agency</span>
          </div>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
            © {new Date().getFullYear()} Fuyue Digital Agency — Tutti i diritti riservati
          </p>
        </div>
      </footer>
    </div>
  );
}
