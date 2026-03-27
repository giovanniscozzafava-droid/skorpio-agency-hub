// ============================================================
// SKORPIO — Synthetic Meme Audio Engine (Web Audio API only)
// No external files. Pure oscillators & noise. Have fun 🦂
// ONE SOUND AT A TIME: each new sound stops the previous one.
// ============================================================

let audioCtx: AudioContext | null = null;
let activeNodes: { stop: () => void }[] = [];

function stopAll() {
  for (const n of activeNodes) {
    try { n.stop(); } catch (_) {}
  }
  activeNodes = [];
}

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  // Resume if suspended (browser autoplay policy)
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

type OscType = OscillatorType;

// ── Primitivi ──────────────────────────────────────────────

function tone(
  freq: number,
  start: number,
  duration: number,
  type: OscType = 'sine',
  vol = 0.18,
  freqEnd?: number
) {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    const t0 = ctx.currentTime + start;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
    }
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
    activeNodes.push(osc);
  } catch (_) { /* silenzioso se non supportato */ }
}

function vibrato(
  freq: number,
  start: number,
  duration: number,
  vibratoRate = 8,
  vibratoDepth = 20,
  vol = 0.15
) {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime + start;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(vibratoRate, t0);
    lfoGain.gain.setValueAtTime(vibratoDepth, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    lfo.start(t0); lfo.stop(t0 + duration + 0.05);
    osc.start(t0); osc.stop(t0 + duration + 0.05);
    activeNodes.push(osc, lfo);
  } catch (_) {}
}

// Rumore bianco (burst percussivo)
function noise(start: number, duration: number, vol = 0.08) {
  try {
    const ctx = getCtx();
    const bufSize = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    src.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime + start;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  } catch (_) {}
}

// ── Suoni MEME ─────────────────────────────────────────────

export const sounds = {

  // 🦂 LOGIN — "Ta-da!" orchestrale + confetti
  // Scala do maggiore ascendente con accordo finale
  login: () => {
    // Scala ascendente C4-E4-G4-C5 stile "fanfara da videogioco"
    const notes = [261, 329, 392, 523, 659, 784, 1047];
    notes.forEach((f, i) => {
      tone(f, i * 0.07, 0.18, 'triangle', 0.20);
      tone(f * 2, i * 0.07, 0.12, 'sine', 0.06); // armonica
    });
    // Accordo finale esplosivo
    tone(523, 0.55, 0.5, 'triangle', 0.18);
    tone(659, 0.55, 0.5, 'triangle', 0.15);
    tone(784, 0.55, 0.5, 'triangle', 0.12);
    tone(1047, 0.55, 0.4, 'sine', 0.10);
    // Rumorino di confetti
    noise(0.52, 0.25, 0.06);
    noise(0.60, 0.15, 0.04);
    noise(0.68, 0.12, 0.03);
  },

  // 📥 NUOVO TASK — "Ding! Missione ricevuta" (stile Metal Gear !)
  // Il classico "!" di Metal Gear Solid
  nuovoTask: () => {
    // Stinger corto con portamento verso l'alto
    tone(200, 0, 0.04, 'square', 0.15);
    tone(200, 0.04, 0.01, 'square', 0.20);
    tone(800, 0.05, 0.25, 'square', 0.18, 900);
    // Echo morbido
    tone(800, 0.10, 0.20, 'sine', 0.08, 900);
    // Nota chiusura
    tone(450, 0.30, 0.15, 'triangle', 0.10);
  },

  // ✅ TASK COMPLETATO — "Level Up!" stile 8-bit Nintendo
  taskCompletato: () => {
    // Sequenza "Super Mario livello completato"
    const seq = [
      [523, 0.00, 0.10, 'square', 0.18],
      [523, 0.12, 0.10, 'square', 0.18],
      [523, 0.24, 0.10, 'square', 0.18],
      [415, 0.22, 0.10, 'square', 0.12], // nota bassa di contrasto
      [523, 0.34, 0.10, 'square', 0.18],
      [659, 0.44, 0.10, 'square', 0.20],
      [784, 0.54, 0.35, 'square', 0.22],
    ] as [number, number, number, OscType, number][];
    seq.forEach(([f, s, d, t, v]) => tone(f, s, d, t, v));
    // Arpeggio accordo finale
    tone(523, 0.90, 0.25, 'triangle', 0.12);
    tone(659, 0.93, 0.22, 'triangle', 0.10);
    tone(784, 0.96, 0.20, 'triangle', 0.09);
    tone(1047, 0.99, 0.30, 'sine', 0.08);
  },

  // ⚠️ ALERT SCADENZA — "Uh oh!" + sirena comica
  // Stile Benny Hill / allarme cartone animato
  alert: () => {
    // Sirena bitonale oscillante (wee-woo)
    for (let i = 0; i < 3; i++) {
      tone(880, i * 0.18, 0.09, 'sawtooth', 0.12);
      tone(660, i * 0.18 + 0.09, 0.09, 'sawtooth', 0.10);
    }
    // "Uh oh" basso
    tone(220, 0.60, 0.10, 'square', 0.15);
    tone(165, 0.72, 0.20, 'square', 0.18, 110);
    // Rumorino percussivo finale
    noise(0.70, 0.08, 0.05);
  },

  // 💬 MESSAGGIO — "Bloop" carino stile chat
  messaggio: () => {
    tone(1200, 0, 0.05, 'sine', 0.10);
    tone(1500, 0.06, 0.12, 'sine', 0.08);
    tone(1200, 0.12, 0.08, 'sine', 0.05);
  },

  // 📲 CHAT URGENTE — Triplice "ding" invasivo stile telefono che squilla
  chatUrgente: () => {
    // 3 ding ravvicinati e forti, come una notifica telefonica insistente
    for (let i = 0; i < 3; i++) {
      tone(1400, i * 0.22,        0.04, 'sine', 0.28);
      tone(1800, i * 0.22 + 0.05, 0.09, 'sine', 0.22);
      tone(1400, i * 0.22 + 0.15, 0.06, 'sine', 0.18);
    }
    // Vibrazione finale — impulso basso
    tone(120, 0.70, 0.08, 'sawtooth', 0.20);
    tone(90,  0.79, 0.12, 'sawtooth', 0.18, 60);
    noise(0.70, 0.12, 0.10);
  },

  // 🗑️ ELIMINA — "Womp womp" tromboni tristi (meme trombone)
  elimina: () => {
    // Womp womp discendente
    tone(440, 0.00, 0.18, 'sawtooth', 0.15, 220);
    tone(349, 0.20, 0.18, 'sawtooth', 0.13, 174);
    tone(277, 0.40, 0.18, 'sawtooth', 0.11, 138);
    tone(220, 0.60, 0.30, 'sawtooth', 0.10, 110);
    // Rumore di sconfitta
    noise(0.60, 0.15, 0.04);
  },

  // 💾 SALVATAGGIO — "Floppy disk ka-chunk" stile retro
  salva: () => {
    // Click meccanico
    noise(0, 0.02, 0.12);
    // Bip di conferma
    tone(880, 0.03, 0.08, 'square', 0.10);
    tone(1047, 0.13, 0.12, 'square', 0.08);
    tone(1319, 0.23, 0.15, 'sine', 0.07);
  },

  // 🚫 ERRORE — "Buzzer" stile quiz sbagliato
  errore: () => {
    tone(200, 0.00, 0.12, 'sawtooth', 0.18);
    tone(160, 0.14, 0.18, 'sawtooth', 0.15, 80);
    noise(0.00, 0.08, 0.06);
    noise(0.15, 0.10, 0.04);
  },

  // 🎯 DRAG DROP — "Pop" soddisfacente
  drop: () => {
    tone(600, 0, 0.04, 'sine', 0.15, 200);
    tone(800, 0.04, 0.10, 'triangle', 0.10);
    noise(0, 0.03, 0.08);
  },

  // 🌟 AI GENERA — "Powering up" sci-fi (per Creative Engine)
  aiGenera: () => {
    // Sweep verso l'alto stile computer che si avvia
    tone(80, 0.00, 0.60, 'sawtooth', 0.08, 800);
    tone(160, 0.10, 0.50, 'sine', 0.06, 1200);
    tone(320, 0.20, 0.40, 'triangle', 0.05, 1600);
    // Bip finale di conferma
    vibrato(1047, 0.65, 0.30, 12, 30, 0.12);
    tone(1319, 0.80, 0.25, 'sine', 0.08);
    tone(1568, 0.95, 0.30, 'sine', 0.07);
  },

};
