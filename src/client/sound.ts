// Sound effects, synthesised with Web Audio — no audio files to download.

import { useSyncExternalStore } from 'react';
import type { Cue } from './cues.ts';

export type Effect = Cue | { name: 'select' } | { name: 'chat' };

const MUTE_KEY = 'kolo.muted';

let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Storage blocked: the choice lasts until the tab is closed.
  }
  for (const l of listeners) l();
}

/** [muted, setMuted] — shared by every component that shows the switch. */
export function useMuted(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => muted,
  );
  return [value, setMuted];
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let hiss: AudioBuffer | null = null;

// Browsers keep audio silent until the person touches the page, so the audio context is
// only created (and woken, if the browser put it to sleep) on a touch.
if (typeof window !== 'undefined' && typeof AudioContext !== 'undefined') {
  const wake = () => {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  };
  window.addEventListener('pointerdown', wake, { capture: true });
  window.addEventListener('keydown', wake, { capture: true });
}

interface Tone {
  /** Seconds after the effect starts. */
  at: number;
  freq: number;
  /** Glide to this pitch over the length of the note. */
  to?: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
  attack?: number;
}

function tone(c: AudioContext, t0: number, n: Tone) {
  const t = t0 + n.at;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = n.type ?? 'sine';
  osc.frequency.setValueAtTime(n.freq, t);
  if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t + n.dur);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(n.gain, t + (n.attack ?? 0.004));
  env.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
  osc.connect(env).connect(master!);
  osc.start(t);
  osc.stop(t + n.dur + 0.02);
}

interface Noise {
  at: number;
  dur: number;
  gain: number;
  /** Band centre, Hz. */
  freq: number;
  to?: number;
  q?: number;
  attack?: number;
}

function noise(c: AudioContext, t0: number, n: Noise) {
  if (!hiss) {
    hiss = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = hiss.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = t0 + n.at;
  const src = c.createBufferSource();
  src.buffer = hiss;
  src.loop = true;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = n.q ?? 1.2;
  band.frequency.setValueAtTime(n.freq, t);
  if (n.to) band.frequency.exponentialRampToValueAtTime(n.to, t + n.dur);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(n.gain, t + (n.attack ?? 0.004));
  env.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
  src.connect(band).connect(env).connect(master!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + n.dur + 0.02);
}

/** A piece set down on the board: a short woody knock. */
function knock(c: AudioContext, t0: number, at: number, pitch: number, gain = 0.5) {
  tone(c, t0, { at, freq: 250 * pitch, to: 120 * pitch, dur: 0.11, gain });
  tone(c, t0, { at, freq: 720 * pitch, to: 380 * pitch, dur: 0.045, gain: gain * 0.35, type: 'triangle' });
  noise(c, t0, { at, freq: 2100, dur: 0.035, gain: gain * 0.3, q: 0.8 });
}

/** A struck bell: a few inharmonic partials with a long tail. */
function bell(c: AudioContext, t0: number, at: number, freq: number, gain: number, dur = 0.7) {
  tone(c, t0, { at, freq, dur, gain });
  tone(c, t0, { at, freq: freq * 2.01, dur: dur * 0.6, gain: gain * 0.4 });
  tone(c, t0, { at, freq: freq * 3.02, dur: dur * 0.3, gain: gain * 0.18 });
}

// The two sides sound a little apart, so a move is recognised by ear.
const voice = (by: 0 | 1) => (by === 0 ? 1 : 1.19);

/** The ring's slide on the board takes this long (see `.ring` in styles.css). */
const SLIDE = 0.3;

/** Schedules one effect; returns how long to wait before the next one in a sequence. */
function schedule(c: AudioContext, t0: number, e: Effect): number {
  switch (e.name) {
    case 'select':
      tone(c, t0, { at: 0, freq: 1250, to: 950, dur: 0.05, gain: 0.1, type: 'triangle' });
      return 0.05;

    case 'place':
      knock(c, t0, 0, voice(e.by));
      return 0.15;

    case 'move': {
      noise(c, t0, { at: 0, freq: 500, to: 1500, dur: SLIDE, gain: 0.1, q: 1.6, attack: 0.08 });
      // One tick per marker that turns over, spread along the slide.
      const flips = Math.min(e.flips, 8);
      for (let i = 0; i < flips; i++) {
        const at = (SLIDE * (i + 1)) / (flips + 1);
        tone(c, t0, { at, freq: 1500 + 130 * i, dur: 0.05, gain: 0.13, type: 'triangle' });
        noise(c, t0, { at, freq: 3600, dur: 0.02, gain: 0.07 });
      }
      knock(c, t0, SLIDE, voice(e.by));
      return SLIDE + 0.16;
    }

    case 'row':
      bell(c, t0, 0, 659.3, 0.2, 0.45);
      bell(c, t0, 0.11, 987.8, 0.2, 0.6);
      return 0.35;

    case 'rowOut':
      // Five markers lifted one after another.
      [523.3, 587.3, 659.3, 784, 880].forEach((freq, i) => {
        const at = i * 0.055;
        tone(c, t0, { at, freq, dur: 0.14, gain: 0.2, type: 'triangle' });
        noise(c, t0, { at, freq: 2600, dur: 0.025, gain: 0.08 });
      });
      return 0.4;

    case 'ringOut':
      noise(c, t0, { at: 0, freq: 1400, to: 500, dur: 0.22, gain: 0.08, q: 1.4, attack: 0.03 });
      bell(c, t0, 0.02, 784 * voice(e.by), 0.26, 0.9);
      return 0.6;

    case 'start':
      bell(c, t0, 0, 523.3, 0.18, 0.4);
      bell(c, t0, 0.13, 784, 0.2, 0.7);
      return 0.5;

    case 'win':
      [523.3, 659.3, 784, 1046.5].forEach((freq, i) => bell(c, t0, i * 0.12, freq, 0.2, i === 3 ? 1.2 : 0.5));
      return 1;

    case 'lose':
      [392, 311.1, 261.6].forEach((freq, i) =>
        tone(c, t0, { at: i * 0.2, freq, dur: i === 2 ? 0.9 : 0.4, gain: 0.2, type: 'triangle', attack: 0.02 }),
      );
      return 1;

    case 'draw':
      bell(c, t0, 0, 587.3, 0.18, 0.5);
      bell(c, t0, 0.22, 587.3, 0.18, 0.9);
      return 1;

    case 'chat':
      tone(c, t0, { at: 0, freq: 880, dur: 0.09, gain: 0.12 });
      tone(c, t0, { at: 0.07, freq: 1174.7, dur: 0.16, gain: 0.12 });
      return 0.25;
  }
}

/** Plays the effects one after another. Silent when muted or before the first touch of the page. */
export function play(...effects: Effect[]) {
  if (muted || effects.length === 0) return;
  const c = ctx;
  // A suspended context would hoard the sounds and fire them all at once on the first touch.
  if (!c || c.state !== 'running') return;
  let t = c.currentTime + 0.01;
  for (const e of effects) t += schedule(c, t, e);
}
