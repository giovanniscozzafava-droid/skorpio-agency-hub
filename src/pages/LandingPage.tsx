import React, { useState, useEffect } from 'react';
import { supabase } from '../integrations/supabase/client';
import { lovable } from '../integrations/lovable/index';
import { sounds } from '../lib/sounds';

type Mode = 'login' | 'signup' | 'forgot';

interface LandingPageProps {
  onAuthenticated: () => void;
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

  // Listen for auth state changes (es. dopo redirect Google)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        sounds.login();
        onAuthenticated();
      }
    });
    return () => subscription.unsubscribe();
  }, [onAuthenticated]);

  const reset = () => { setError(''); setSuccess(''); };

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    reset();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message === 'Invalid login credentials'
        ? 'Email o password errata. Controlla e riprova.'
        : error.message);
    } else {
      sounds.login();
      onAuthenticated();
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    reset();
    if (password !== confirmPassword) { setError('Le password non coincidono.'); return; }
    if (password.length < 8) { setError('La password deve essere di almeno 8 caratteri.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSuccess('Controlla la tua email per confermare l\'account, poi torna qui per accedere.');
      setMode('login');
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    reset();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSuccess('Controlla la tua email per il link di reset password.');
    }
  }

  async function handleGoogle() {
    reset();
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth('google', {
      redirect_uri: window.location.origin,
    });
    setLoading(false);
    if (result && 'error' in result && result.error) {
      setError('Errore con Google Sign-In. Riprova.');
    }
  }

  const inputClass = `
    w-full px-4 py-3 rounded-xl border outline-none text-sm transition-all
    bg-white/5 border-white/15 text-white placeholder-white/30
    focus:border-white/50 focus:bg-white/8
  `;

  const btnClass = `
    w-full py-3 rounded-xl font-bold text-sm transition-all duration-200
    disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]
  `;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'linear-gradient(135deg, hsl(222 47% 6%) 0%, hsl(222 47% 12%) 50%, hsl(240 40% 10%) 100%)',
      }}
    >
      {/* Decorative orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl opacity-10"
          style={{ background: 'hsl(var(--primary))' }} />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full blur-3xl opacity-8"
          style={{ background: 'hsl(280 60% 50%)' }} />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="text-6xl mb-3 select-none">🦂</div>
          <h1 className="text-4xl font-bold text-white tracking-tight">SKORPIO</h1>
          <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Fuyue Digital Agency — Gestionale Interno
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-6 backdrop-blur-xl animate-slide-up"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          }}
        >
          {/* Tab selector */}
          {mode !== 'forgot' && (
            <div
              className="flex rounded-xl p-1 mb-6"
              style={{ background: 'rgba(255,255,255,0.05)' }}
            >
              {(['login', 'signup'] as Mode[]).map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); reset(); }}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: mode === m ? 'hsl(var(--primary))' : 'transparent',
                    color: mode === m ? 'hsl(var(--primary-foreground))' : 'rgba(255,255,255,0.45)',
                  }}
                >
                  {m === 'login' ? 'Accedi' : 'Registrati'}
                </button>
              ))}
            </div>
          )}

          {/* Title forgot */}
          {mode === 'forgot' && (
            <div className="mb-5">
              <button
                onClick={() => { setMode('login'); reset(); }}
                className="flex items-center gap-1.5 text-xs mb-3"
                style={{ color: 'rgba(255,255,255,0.45)' }}
              >
                ← Torna al login
              </button>
              <h2 className="text-white font-bold text-lg">Reset Password</h2>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Inserisci la tua email e ti mandiamo un link.
              </p>
            </div>
          )}

          {/* Errors / Success */}
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

          {/* Form Login */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-3">
              <input
                type="email"
                className={inputClass}
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className={inputClass}
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-40 hover:opacity-80"
                  style={{ color: 'white' }}
                >
                  {showPw ? '🙈' : '👁️'}
                </button>
              </div>
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => { setMode('forgot'); reset(); }}
                  className="text-xs hover:opacity-80 transition-opacity"
                  style={{ color: 'rgba(255,255,255,0.4)' }}
                >
                  Password dimenticata?
                </button>
              </div>
              <button
                type="submit"
                disabled={loading}
                className={btnClass}
                style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
              >
                {loading ? '⏳ Accesso…' : '🔐 Accedi'}
              </button>
            </form>
          )}

          {/* Form Signup */}
          {mode === 'signup' && (
            <form onSubmit={handleSignup} className="space-y-3">
              <input
                type="email"
                className={inputClass}
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className={inputClass}
                  placeholder="Password (min. 8 caratteri)"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-40 hover:opacity-80"
                  style={{ color: 'white' }}
                >
                  {showPw ? '🙈' : '👁️'}
                </button>
              </div>
              <input
                type={showPw ? 'text' : 'password'}
                className={inputClass}
                placeholder="Conferma password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button
                type="submit"
                disabled={loading}
                className={btnClass}
                style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
              >
                {loading ? '⏳ Registrazione…' : '✨ Crea Account'}
              </button>
            </form>
          )}

          {/* Form Forgot */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-3">
              <input
                type="email"
                className={inputClass}
                placeholder="La tua email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
              <button
                type="submit"
                disabled={loading}
                className={btnClass}
                style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
              >
                {loading ? '⏳ Invio…' : '📧 Invia link reset'}
              </button>
            </form>
          )}

          {/* Divider */}
          {mode !== 'forgot' && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.10)' }} />
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>oppure</span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.10)' }} />
              </div>

              {/* Google */}
              <button
                onClick={handleGoogle}
                disabled={loading}
                className={`${btnClass} flex items-center justify-center gap-2.5`}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continua con Google
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center mt-6 text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
          v1.0 — {new Date().getFullYear()} Fuyue Digital Agency
        </p>
      </div>
    </div>
  );
}
