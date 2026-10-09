let context: AudioContext | null = null;
let muted = false;
export function setMuted(value: boolean) { muted = value; }
export function sound(kind: 'click' | 'dash' | 'plate' | 'loop' | 'core' | 'win' | 'hit') {
  if (muted) return;
  try {
    context ||= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const notes: Record<typeof kind, number[]> = { click: [440], dash: [280, 620], plate: [380, 560], loop: [180, 280, 420], core: [510, 710, 940], win: [440, 550, 660, 880], hit: [180, 95] };
    notes[kind].forEach((freq, i) => {
      const oscillator = context!.createOscillator(); const gain = context!.createGain();
      const t = context!.currentTime + i * .075;
      oscillator.type = kind === 'hit' ? 'sawtooth' : kind === 'win' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(freq, t);
      if (kind === 'dash') oscillator.frequency.exponentialRampToValueAtTime(freq * 1.5, t + .12);
      gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(.045, t + .01); gain.gain.exponentialRampToValueAtTime(.0001, t + .2);
      oscillator.connect(gain); gain.connect(context!.destination); oscillator.start(t); oscillator.stop(t + .21);
    });
  } catch { /* Audio permission is optional. */ }
}
