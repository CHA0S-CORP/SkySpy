/**
 * Optional alert chime for the local notification sink. Uses the Web Audio API
 * (a short two-note ping) so there's no binary asset to bundle/serve. Priority
 * shapes the tone: emergency/critical get a more urgent, slightly louder chirp.
 */

let audioCtx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

const TONES = {
  emergency: [880, 1320],
  critical: [784, 1175],
  warning: [659, 988],
  info: [523, 784],
};

/**
 * Play a short alert chime. No-op if Web Audio is unavailable or blocked.
 * @param {string} [priority] - info | warning | critical | emergency
 */
export function playAlertSound(priority = 'info') {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    // Browsers suspend the context until a user gesture; resume best-effort.
    if (ctx.state === 'suspended') ctx.resume();
    const [f1, f2] = TONES[priority] || TONES.info;
    const gain = ctx.createGain();
    const peak = priority === 'emergency' || priority === 'critical' ? 0.16 : 0.1;
    gain.connect(ctx.destination);
    const now = ctx.currentTime;

    [f1, f2].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const start = now + i * 0.14;
      const stop = start + 0.13;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, stop);
      osc.connect(g);
      g.connect(gain);
      osc.start(start);
      osc.stop(stop + 0.02);
    });
  } catch {
    // best-effort; never throw from a notification side effect
  }
}
