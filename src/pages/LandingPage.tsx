import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../integrations/supabase/client';
import { lovable } from '../integrations/lovable/index';
import { sounds } from '../lib/sounds';
import fuyueLogo from '@/assets/fuyue-logo-white.svg';

type Mode = 'login' | 'signup' | 'forgot';

interface LandingPageProps {
  onAuthenticated: () => void;
}

/* ─────────────────────────────────────────
   SVG Icons
───────────────────────────────────────── */
const IconKanban = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="7" rx="1"/>
  </svg>
);
const IconCalendar = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);
const IconFilm = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>
  </svg>
);
const IconAI = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
  </svg>
);
const IconChat = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
  </svg>
);
const IconUsers = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
  </svg>
);
const IconShield = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const IconArrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
);
const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const IconEye = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
);
const IconEyeOff = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

/* ─────────────────────────────────────────
   Animated counter
───────────────────────────────────────── */
function Counter({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      let start = 0;
      const step = Math.max(1, Math.ceil(target / 50));
      const t = setInterval(() => {
        start = Math.min(start + step, target);
        setVal(start);
        if (start >= target) clearInterval(t);
      }, 20);
    }, { threshold: 0.5 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [target]);
  return <span ref={ref}>{val.toLocaleString('it-IT')}{suffix}</span>;
}

/* ─────────────────────────────────────────
   useStaggerReveal — Intersection Observer hook
───────────────────────────────────────── */
function useStaggerReveal(count: number, options?: { threshold?: number; delay?: number }) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const [visible, setVisible] = useState<boolean[]>(Array(count).fill(false));

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = refs.current.indexOf(entry.target as HTMLDivElement);
            if (idx !== -1) {
              setTimeout(() => {
                setVisible(prev => {
                  const next = [...prev];
                  next[idx] = true;
                  return next;
                });
              }, idx * (options?.delay ?? 80));
            }
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: options?.threshold ?? 0.15 }
    );

    refs.current.forEach(el => { if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [count, options?.delay, options?.threshold]);

  return { refs, visible };
}

/* ─────────────────────────────────────────
   Feature row item
───────────────────────────────────────── */
interface FeatureProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  tag?: string;
  visible?: boolean;
  refCallback?: (el: HTMLDivElement | null) => void;
}
function FeatureItem({ icon, title, desc, tag, visible = true, refCallback }: FeatureProps) {
  return (
    <div
      ref={refCallback}
      className="group flex items-start gap-5 py-7 border-b last:border-b-0 transition-all duration-200 hover:pl-1"
      style={{
        borderColor: 'rgba(255,255,255,0.06)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(22px)',
        transition: 'opacity 0.55s ease, transform 0.55s ease',
      }}
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 group-hover:scale-105"
        style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', color: '#93C5FD' }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 mb-1.5">
          <h3 className="text-white font-semibold text-[15px]">{title}</h3>
          {tag && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wide"
              style={{ background: 'rgba(16,185,129,0.15)', color: '#6EE7B7', border: '1px solid rgba(16,185,129,0.25)' }}>
              {tag}
            </span>
          )}
        </div>
        <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>{desc}</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   Stat block
───────────────────────────────────────── */
function StatBlock({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  return (
    <div className="text-center py-6 px-4">
      <div className="text-4xl font-black text-white mb-1 tabular-nums">
        <Counter target={value} suffix={suffix} />
      </div>
      <div className="text-xs uppercase tracking-widest font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</div>
    </div>
  );
}

/* ─────────────────────────────────────────
   Main component
───────────────────────────────────────── */
export function LandingPage({ onAuthenticated }: LandingPageProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [heroVisible, setHeroVisible] = useState(false);
  const authRef = useRef<HTMLDivElement>(null);

  // Hero entrance on mount
  useEffect(() => {
    const t = requestAnimationFrame(() => setHeroVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const features = [
    { icon: <IconKanban />, title: 'Kanban Board Realtime', desc: 'Drag & drop con aggiornamenti istantanei per tutto il team. Badge "NUOVO" e notifiche sonore per ogni cambio di stato.' },
    { icon: <IconCalendar />, title: 'Calendario Automatico', desc: 'Ogni task con scadenza viene sincronizzato automaticamente nel calendario. Nessun doppio inserimento, zero dispersione.' },
    { icon: <IconFilm />, title: 'Pipeline Contenuti', desc: 'Traccia ogni contenuto dalla fase Idea fino alla Pubblicazione. Script, riprese, montaggio, revisione: tutto in un posto.', tag: 'Video' },
    { icon: <IconAI />, title: 'Creative Engine AI', desc: 'Genera script, hook e caption personalizzati per cliente in secondi. Basato sui Brand Rules dell\'agenzia.', tag: 'AI' },
    { icon: <IconChat />, title: 'Chat con Emoji Reaction', desc: 'Messaggistica interna con reaction, creazione task da messaggi e notifiche sonore in realtime.' },
    { icon: <IconUsers />, title: 'CRM Clienti', desc: 'Pacchetti, quote reel e grafiche, stato abbonamenti, contatti. Tutto il portafoglio clienti sotto controllo.' },
  ];

  // Stagger reveal for feature items
  const { refs: featureRefs, visible: featureVisible } = useStaggerReveal(features.length, { delay: 100 });

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) { sounds.login(); onAuthenticated(); }
    });
    return () => subscription.unsubscribe();
  }, [onAuthenticated]);

  const reset = () => { setError(''); setSuccess(''); };

  async function onLogin(e: React.FormEvent) {
    e.preventDefault(); reset(); setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'Email o password non corretti.' : error.message);
    else { sounds.login(); onAuthenticated(); }
  }

  async function onSignup(e: React.FormEvent) {
    e.preventDefault(); reset();
    if (password !== confirmPw) { setError('Le password non coincidono.'); return; }
    if (password.length < 8) { setError('Password di almeno 8 caratteri.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setLoading(false);
    if (error) setError(error.message);
    else { setSuccess('Controlla la tua email per confermare l\'account.'); setMode('login'); }
  }

  async function onForgot(e: React.FormEvent) {
    e.preventDefault(); reset(); setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    setLoading(false);
    if (error) setError(error.message);
    else setSuccess('Link di reset inviato alla tua email.');
  }

  async function onGoogle() {
    reset(); setLoading(true);
    const res = await lovable.auth.signInWithOAuth('google', { redirect_uri: window.location.origin });
    setLoading(false);
    if (res && 'error' in res && res.error) setError('Errore con Google Sign-In. Riprova.');
  }

  const scrollToAuth = () => authRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  /* ── shared styles ── */
  const INP = [
    'w-full px-4 py-3 rounded-xl text-sm outline-none transition-all',
    'bg-white/5 border border-white/10 text-white placeholder-white/25',
    'focus:border-blue-400/60 focus:bg-white/7',
  ].join(' ');
  const BTN_PRIMARY = [
    'w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200',
    'disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]',
    'flex items-center justify-center gap-2',
  ].join(' ');

  /* ────────────────────────────────────
     RENDER
  ──────────────────────────────────── */
  return (
    <div className="min-h-screen" style={{ background: '#07080f', color: 'white', fontFamily: "'Inter', sans-serif" }}>

      {/* ════ NAVBAR ════ */}
      <header
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-500"
        style={{
          background: scrolled ? 'rgba(7,8,15,0.88)' : 'transparent',
          backdropFilter: scrolled ? 'blur(20px) saturate(180%)' : 'none',
          borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : 'none',
        }}
      >
        <div className="max-w-6xl mx-auto px-6 h-[62px] flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <span className="text-2xl">🦂</span>
            <span className="font-bold text-[17px] tracking-tight">SKORPIO</span>
            <span className="text-xs hidden sm:block" style={{ color: 'rgba(255,255,255,0.2)' }}>by</span>
            <img src={fuyueLogo} alt="Fuyue" className="hidden sm:block h-4 w-auto opacity-50" />
          </div>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-7 text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <a href="#features" className="hover:text-white transition-colors">Funzionalità</a>
            <a href="#metrics" className="hover:text-white transition-colors">Metriche</a>
            <a href="#about" className="hover:text-white transition-colors">Chi siamo</a>
          </nav>

          {/* CTA */}
          <button
            onClick={scrollToAuth}
            className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105"
            style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)', color: '#93C5FD' }}
          >
            Accedi <IconArrow />
          </button>
        </div>
      </header>

      {/* ════ HERO ════ */}
      <section className="relative min-h-screen flex items-center px-6 pt-[62px] overflow-hidden">

        {/* Background geometry */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Large primary glow */}
          <div className="absolute" style={{
            width: 900, height: 900, top: '-20%', left: '-20%',
            background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)',
          }} />
          {/* Right accent */}
          <div className="absolute" style={{
            width: 600, height: 600, bottom: '-10%', right: '-15%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)',
          }} />
          {/* Grid */}
          <div className="absolute inset-0" style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 50%, black 40%, transparent 100%)',
          }} />
          {/* Horizontal line accent */}
          <div className="absolute left-0 right-0" style={{
            top: '58%', height: '1px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(59,130,246,0.25) 20%, rgba(99,102,241,0.25) 80%, transparent 100%)',
          }} />
        </div>

        <div className="relative max-w-6xl mx-auto w-full grid lg:grid-cols-[1fr_420px] gap-12 xl:gap-20 items-center py-20 lg:py-32">

          {/* ── Left: Copy ── */}
          <div className="space-y-8 max-w-xl">
            {/* Eyebrow */}
            <div className="flex items-center gap-2.5" style={{
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? 'translateY(0)' : 'translateY(28px)',
              transition: 'opacity 0.7s ease 0.05s, transform 0.7s ease 0.05s',
            }}>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide uppercase"
                style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: '#93C5FD' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
                Fuyue Digital Agency
              </div>
              <div className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold tracking-wide uppercase"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}>
                v2.0
              </div>
            </div>

            {/* Headline */}
            <div style={{
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? 'translateY(0)' : 'translateY(36px)',
              transition: 'opacity 0.75s ease 0.18s, transform 0.75s ease 0.18s',
            }}>
              <h1 className="font-black leading-[1.04] tracking-tight" style={{ fontSize: 'clamp(44px,5.5vw,72px)' }}>
                <span className="block" style={{ color: 'rgba(255,255,255,0.92)' }}>Il sistema operativo</span>
                <span className="block" style={{ color: 'rgba(255,255,255,0.92)' }}>della tua</span>
                <span className="block relative inline-block">
                  <span style={{
                    background: 'linear-gradient(130deg, #60A5FA 0%, #818CF8 50%, #A78BFA 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}>
                    agenzia creativa.
                  </span>
                </span>
              </h1>
              <p className="mt-6 text-[17px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Kanban, calendar, contenuti, AI e team chat — tutto integrato in un'unica piattaforma costruita per chi produce contenuti ogni giorno.
              </p>
            </div>

            {/* CTA */}
            <div className="flex flex-wrap items-center gap-4 pt-1" style={{
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? 'translateY(0)' : 'translateY(24px)',
              transition: 'opacity 0.7s ease 0.36s, transform 0.7s ease 0.36s',
            }}>
              <button
                onClick={scrollToAuth}
                className="flex items-center gap-2.5 px-7 py-3.5 rounded-xl font-semibold text-[15px] transition-all duration-200 hover:brightness-110 hover:shadow-lg"
                style={{
                  background: 'linear-gradient(135deg, #3B82F6, #6366F1)',
                  color: 'white',
                  boxShadow: '0 0 32px rgba(59,130,246,0.35)',
                }}
              >
                Accedi alla piattaforma
                <IconArrow />
              </button>
              <a
                href="#features"
                className="flex items-center gap-2 text-[14px] font-medium transition-colors hover:text-white"
                style={{ color: 'rgba(255,255,255,0.45)' }}
              >
                Scopri le funzionalità <IconChevronDown />
              </a>
            </div>

            {/* Trust row */}
            <div className="flex items-center gap-6 pt-2" style={{
              opacity: heroVisible ? 1 : 0,
              transform: heroVisible ? 'translateY(0)' : 'translateY(16px)',
              transition: 'opacity 0.65s ease 0.52s, transform 0.65s ease 0.52s',
            }}>
              <div className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>
                <IconShield />
                End-to-end encrypted
              </div>
              <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.1)' }} />
              <div className="text-[12px] font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Realtime sync
              </div>
              <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.1)' }} />
              <div className="text-[12px] font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>
                99% uptime
              </div>
            </div>
          </div>

          {/* ── Right: Auth card ── */}
          <div ref={authRef} className="w-full">
            <div
              className="relative rounded-2xl overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.09)',
                backdropFilter: 'blur(32px)',
                boxShadow: '0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset',
              }}
            >
              {/* Top stripe */}
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, #3B82F6, #6366F1, #8B5CF6)' }} />

              <div className="p-7">
                {/* Header */}
                <div className="mb-6">
                  <div className="flex items-center gap-2.5 mb-1">
                    <div className="w-6 h-6">
                      <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
                        <rect width="32" height="32" rx="8" fill="rgba(59,130,246,0.15)" stroke="rgba(59,130,246,0.4)" strokeWidth="1"/>
                        <path d="M8 10 L16 8 L24 10 L22 18 L16 24 L10 18 Z" stroke="#93C5FD" strokeWidth="1.5" fill="none"/>
                        <circle cx="16" cy="16" r="2.5" fill="#3B82F6"/>
                      </svg>
                    </div>
                    <span className="font-bold text-white text-[15px] tracking-tight">SKORPIO</span>
                  </div>
                  <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {mode === 'login' ? 'Accedi al tuo account' : mode === 'signup' ? 'Crea un nuovo account' : 'Recupera la password'}
                  </p>
                </div>

                {/* Mode tabs */}
                {mode !== 'forgot' && (
                  <div className="flex rounded-lg p-0.5 mb-5 gap-0.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    {(['login', 'signup'] as Mode[]).map(m => (
                      <button
                        key={m}
                        onClick={() => { setMode(m); reset(); }}
                        className="flex-1 py-2 rounded-md text-[12px] font-semibold transition-all duration-200"
                        style={{
                          background: mode === m ? 'rgba(59,130,246,0.2)' : 'transparent',
                          color: mode === m ? '#93C5FD' : 'rgba(255,255,255,0.35)',
                          border: mode === m ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
                        }}
                      >
                        {m === 'login' ? 'Accedi' : 'Registrati'}
                      </button>
                    ))}
                  </div>
                )}

                {mode === 'forgot' && (
                  <button
                    onClick={() => { setMode('login'); reset(); }}
                    className="flex items-center gap-1.5 text-[12px] mb-4 hover:text-white transition-colors"
                    style={{ color: 'rgba(255,255,255,0.4)' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                    Torna al login
                  </button>
                )}

                {/* Alerts */}
                {error && (
                  <div className="mb-4 px-3.5 py-3 rounded-lg text-[12px] font-medium flex items-start gap-2"
                    style={{ background: 'rgba(239,68,68,0.1)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.25)' }}>
                    <svg className="flex-shrink-0 mt-0.5" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    {error}
                  </div>
                )}
                {success && (
                  <div className="mb-4 px-3.5 py-3 rounded-lg text-[12px] font-medium flex items-start gap-2"
                    style={{ background: 'rgba(16,185,129,0.1)', color: '#6EE7B7', border: '1px solid rgba(16,185,129,0.25)' }}>
                    <IconCheck />
                    {success}
                  </div>
                )}

                {/* ── Login form ── */}
                {mode === 'login' && (
                  <form onSubmit={onLogin} className="space-y-3">
                    <input type="email" className={INP} placeholder="Email" value={email}
                      onChange={e => setEmail(e.target.value)} required autoComplete="email" />
                    <div className="relative">
                      <input type={showPw ? 'text' : 'password'} className={INP} placeholder="Password"
                        value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
                      <button type="button" onClick={() => setShowPw(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-80"
                        style={{ color: 'rgba(255,255,255,0.3)' }}>
                        {showPw ? <IconEyeOff /> : <IconEye />}
                      </button>
                    </div>
                    <div className="flex justify-end">
                      <button type="button" onClick={() => { setMode('forgot'); reset(); }}
                        className="text-[11px] hover:text-white transition-colors" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        Password dimenticata?
                      </button>
                    </div>
                    <button type="submit" disabled={loading} className={BTN_PRIMARY}
                      style={{ background: 'linear-gradient(135deg,#3B82F6,#6366F1)', color: 'white', boxShadow: '0 0 24px rgba(59,130,246,0.3)' }}>
                      {loading
                        ? <><svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" /></svg> Accesso in corso…</>
                        : 'Accedi'}
                    </button>
                  </form>
                )}

                {/* ── Signup form ── */}
                {mode === 'signup' && (
                  <form onSubmit={onSignup} className="space-y-3">
                    <input type="email" className={INP} placeholder="Email" value={email}
                      onChange={e => setEmail(e.target.value)} required autoComplete="email" />
                    <div className="relative">
                      <input type={showPw ? 'text' : 'password'} className={INP} placeholder="Password (min. 8 caratteri)"
                        value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" />
                      <button type="button" onClick={() => setShowPw(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-80"
                        style={{ color: 'rgba(255,255,255,0.3)' }}>
                        {showPw ? <IconEyeOff /> : <IconEye />}
                      </button>
                    </div>
                    <input type={showPw ? 'text' : 'password'} className={INP} placeholder="Conferma password"
                      value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required autoComplete="new-password" />
                    <button type="submit" disabled={loading} className={BTN_PRIMARY}
                      style={{ background: 'linear-gradient(135deg,#3B82F6,#6366F1)', color: 'white', boxShadow: '0 0 24px rgba(59,130,246,0.3)' }}>
                      {loading ? 'Registrazione…' : 'Crea account'}
                    </button>
                  </form>
                )}

                {/* ── Forgot form ── */}
                {mode === 'forgot' && (
                  <form onSubmit={onForgot} className="space-y-3">
                    <p className="text-[12px] mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      Inserisci la tua email e ti invieremo un link per reimpostare la password.
                    </p>
                    <input type="email" className={INP} placeholder="La tua email" value={email}
                      onChange={e => setEmail(e.target.value)} required autoComplete="email" />
                    <button type="submit" disabled={loading} className={BTN_PRIMARY}
                      style={{ background: 'linear-gradient(135deg,#3B82F6,#6366F1)', color: 'white' }}>
                      {loading ? 'Invio in corso…' : 'Invia link di reset'}
                    </button>
                  </form>
                )}

                {/* Divider + Google */}
                {mode !== 'forgot' && (
                  <>
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
                      <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.2)' }}>oppure continua con</span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />
                    </div>
                    <button
                      onClick={onGoogle} disabled={loading}
                      className={`${BTN_PRIMARY} border`}
                      style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.75)', borderColor: 'rgba(255,255,255,0.1)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      Google
                    </button>
                  </>
                )}

                {/* Security note */}
                <div className="flex items-center justify-center gap-1.5 mt-5 text-[11px]" style={{ color: 'rgba(255,255,255,0.18)' }}>
                  <IconShield />
                  Accesso protetto · Dati crittografati
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════ METRICS ════ */}
      <section id="metrics" className="relative py-4">
        <div className="max-w-5xl mx-auto px-6">
          <div
            className="grid grid-cols-2 md:grid-cols-4 rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            {[
              { v: 1200, s: '+', l: 'Task completati' },
              { v: 48, s: '', l: 'Clienti attivi' },
              { v: 99, s: '%', l: 'Uptime' },
              { v: 6, s: '×', l: 'Produttività' },
            ].map((m, i) => <StatBlock key={i} value={m.v} suffix={m.s} label={m.l} />)}
          </div>
        </div>
      </section>

      {/* ════ FEATURES ════ */}
      <section id="features" className="py-28 px-6 relative">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 60% 40% at 50% 50%, rgba(59,130,246,0.04) 0%, transparent 100%)' }} />
        <div className="max-w-6xl mx-auto relative">
          {/* Section header */}
          <div className="max-w-xl mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide uppercase mb-5"
              style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: '#A5B4FC' }}>
              Funzionalità
            </div>
            <h2 className="text-3xl md:text-4xl font-black leading-tight mb-4" style={{ color: 'rgba(255,255,255,0.9)' }}>
              Tutto ciò di cui<br />un'agenzia ha bisogno.
            </h2>
            <p className="text-[15px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Progettato per team che producono contenuti quotidianamente. Zero fogli di calcolo, zero dispersione, zero strumenti separati.
            </p>
          </div>

          {/* Two-column feature list */}
          <div className="grid md:grid-cols-2 gap-x-16">
            <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              {features.slice(0, 3).map((f, i) => (
                <FeatureItem key={i} {...f}
                  visible={featureVisible[i]}
                  refCallback={el => { featureRefs.current[i] = el; }}
                />
              ))}
            </div>
            <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              {features.slice(3).map((f, i) => (
                <FeatureItem key={i + 3} {...f}
                  visible={featureVisible[i + 3]}
                  refCallback={el => { featureRefs.current[i + 3] = el; }}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ════ HOW IT WORKS ════ */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide uppercase mb-5"
              style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#6EE7B7' }}>
              Come funziona
            </div>
            <h2 className="text-3xl md:text-4xl font-black" style={{ color: 'rgba(255,255,255,0.9)' }}>
              In tre passi.
            </h2>
          </div>

          <div className="relative grid md:grid-cols-3 gap-6">
            {/* Connector line */}
            <div className="hidden md:block absolute top-[38px] left-[calc(16.67%+24px)] right-[calc(16.67%+24px)] h-px"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.35), rgba(99,102,241,0.35), transparent)' }} />
            {[
              {
                n: '01', title: 'Accedi',
                desc: 'Login sicuro con email/password o Google. Il sistema rileva automaticamente il tuo profilo team dall\'email.',
              },
              {
                n: '02', title: 'Organizza',
                desc: 'Crea task, assegna colleghi, imposta priorità e scadenze. Il calendario si sincronizza in automatico.',
              },
              {
                n: '03', title: 'Pubblica',
                desc: 'Usa l\'AI per generare script e caption, traccia il workflow di produzione e pubblica contenuti di qualità.',
              },
            ].map((s, i) => (
              <div key={i} className="relative p-7 rounded-2xl text-center"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="relative mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-5"
                  style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)' }}>
                  <span className="text-[13px] font-black" style={{ color: '#93C5FD' }}>{s.n}</span>
                </div>
                <h3 className="text-white font-bold text-[16px] mb-2">{s.title}</h3>
                <p className="text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════ ABOUT / TEAM ════ */}
      <section id="about" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div
            className="relative rounded-3xl overflow-hidden p-10 md:p-14"
            style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(99,102,241,0.06) 50%, rgba(139,92,246,0.06) 100%)',
              border: '1px solid rgba(59,130,246,0.18)',
            }}
          >
            {/* Background decoration */}
            <div className="absolute top-0 right-0 w-80 h-80 pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)', transform: 'translate(30%,-30%)' }} />

            <div className="relative grid md:grid-cols-2 gap-10 items-center">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide uppercase mb-6"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.45)' }}>
                  Il team
                </div>
                <h2 className="text-3xl md:text-4xl font-black leading-tight mb-5" style={{ color: 'rgba(255,255,255,0.9)' }}>
                  Costruito<br />dal team.<br />Per il team.
                </h2>
                <p className="text-[14px] leading-relaxed mb-6" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Skorpio nasce dall'esigenza reale di Fuyue Digital Agency: gestire clienti, contenuti e task senza dispersioni. Ogni funzionalità è stata pensata e testata dal team che lo usa ogni giorno.
                </p>
                <button
                  onClick={scrollToAuth}
                  className="flex items-center gap-2.5 px-6 py-3 rounded-xl font-semibold text-[14px] transition-all duration-200 hover:scale-105"
                  style={{
                    background: 'linear-gradient(135deg, #3B82F6, #6366F1)',
                    color: 'white',
                    boxShadow: '0 0 28px rgba(59,130,246,0.3)',
                  }}
                >
                  Entra nella piattaforma
                  <IconArrow />
                </button>
              </div>

              {/* Checklist */}
              <div className="space-y-3">
                {[
                  'Task → calendario automatico',
                  'Auto-riconoscimento profilo dal login',
                  'Chat realtime con reaction emoji',
                  'Creative Engine AI per ogni cliente',
                  'Kanban con drag & drop e suoni',
                  'CRM clienti con quote e pacchetti',
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#6EE7B7' }}>
                      <IconCheck />
                    </div>
                    <span className="text-[13px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════ FOOTER ════ */}
      <footer className="py-8 px-6" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-lg">🦂</span>
            <span className="font-bold text-white text-[14px]">SKORPIO</span>
            <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
            <img src={fuyueLogo} alt="Fuyue Digital Agency" className="h-4 w-auto opacity-40" />
          </div>
          <div className="flex items-center gap-6 text-[11px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
            <span>© {new Date().getFullYear()} Fuyue Digital Agency</span>
            <span>Tutti i diritti riservati</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
