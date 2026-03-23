import React, { useState, useEffect } from 'react';
import { supabase } from '../integrations/supabase/client';

export function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [validToken, setValidToken] = useState(false);

  useEffect(() => {
    // Supabase redirecta con #access_token & type=recovery nell'hash
    const hash = window.location.hash;
    if (hash.includes('type=recovery') || hash.includes('access_token')) {
      setValidToken(true);
    }
    // Auth state change handler for recovery
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setValidToken(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Le password non coincidono.');
      return;
    }
    if (password.length < 8) {
      setError('La password deve essere di almeno 8 caratteri.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
      setTimeout(() => {
        window.location.href = '/';
      }, 2500);
    }
  }

  const inputClass = `
    w-full px-4 py-3 rounded-xl border outline-none text-sm transition-all
    bg-white/5 border-white/15 text-white placeholder-white/30
    focus:border-white/50
  `;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, hsl(222 47% 6%) 0%, hsl(222 47% 12%) 100%)' }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🦂</div>
          <h1 className="text-3xl font-bold text-white">SKORPIO</h1>
        </div>

        <div
          className="rounded-2xl p-6"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <h2 className="text-white font-bold text-lg mb-1">Nuova Password</h2>
          <p className="text-xs mb-5" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Scegli una nuova password per il tuo account.
          </p>

          {!validToken && !success && (
            <div className="px-3 py-2.5 rounded-xl text-xs"
              style={{ background: 'hsl(40 84% 60% / 0.15)', color: 'hsl(40 84% 70%)', border: '1px solid hsl(40 84% 60% / 0.3)' }}>
              ⚠️ Link non valido o scaduto. Richiedi un nuovo reset dalla pagina di login.
            </div>
          )}

          {success && (
            <div className="px-3 py-2.5 rounded-xl text-xs"
              style={{ background: 'hsl(142 71% 45% / 0.15)', color: 'hsl(142 71% 55%)', border: '1px solid hsl(142 71% 45% / 0.3)' }}>
              ✅ Password aggiornata! Reindirizzamento in corso…
            </div>
          )}

          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-xl text-xs"
              style={{ background: 'hsl(0 84% 60% / 0.15)', color: 'hsl(0 84% 70%)', border: '1px solid hsl(0 84% 60% / 0.3)' }}>
              ⚠️ {error}
            </div>
          )}

          {validToken && !success && (
            <form onSubmit={handleReset} className="space-y-3 mt-4">
              <input
                type="password"
                className={inputClass}
                placeholder="Nuova password (min. 8 caratteri)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <input
                type="password"
                className={inputClass}
                placeholder="Conferma nuova password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50"
                style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}
              >
                {loading ? '⏳ Aggiornamento…' : '🔐 Aggiorna Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
