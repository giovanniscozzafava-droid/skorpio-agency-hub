// Suono sintetico usando Web Audio API
let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', vol = 0.2) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    // silenzioso se non supportato
  }
}

export const sounds = {
  login: () => {
    playTone(523, 0.1); // C5
    setTimeout(() => playTone(659, 0.1), 100); // E5
    setTimeout(() => playTone(784, 0.2), 200); // G5
  },
  nuovoTask: () => {
    playTone(880, 0.15, 'sine', 0.15);
    setTimeout(() => playTone(1047, 0.2, 'sine', 0.12), 150);
  },
  taskCompletato: () => {
    playTone(784, 0.1);
    setTimeout(() => playTone(880, 0.1), 100);
    setTimeout(() => playTone(1047, 0.25), 200);
  },
  alert: () => {
    playTone(440, 0.15, 'square', 0.1);
    setTimeout(() => playTone(349, 0.2, 'square', 0.08), 200);
  },
  messaggio: () => {
    playTone(1047, 0.08, 'sine', 0.1);
    setTimeout(() => playTone(1319, 0.12, 'sine', 0.08), 80);
  },
};
