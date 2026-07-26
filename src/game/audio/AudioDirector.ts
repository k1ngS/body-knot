import { type VoiceClipKey, voiceClips } from "@/i18n/strings";
import { type GameSettings, useGameUiStore } from "@/stores/useGameUiStore";

type OscillatorBundle = {
  oscillator: OscillatorNode;
  gain: GainNode;
};

export class AudioDirector {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private drone: OscillatorBundle[] = [];
  private heartbeatTimer = 0;
  private observerMode = false;
  private ambienceTarget = 0.16;

  init() {
    if (this.context || !this.settings().audio) {
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.effects = this.context.createGain();
    this.master.gain.value = 0.16;
    this.effects.gain.value = this.settings().effectsVolume;
    this.effects.connect(this.master);
    this.master.connect(this.context.destination);
    this.startDrone();
  }

  destroy() {
    for (const bundle of this.drone) {
      bundle.oscillator.stop();
      bundle.oscillator.disconnect();
      bundle.gain.disconnect();
    }

    this.drone = [];
    this.context?.close();
    this.context = null;
    this.master = null;
    this.effects = null;
  }

  setObserverMode(enabled: boolean) {
    this.observerMode = enabled;
  }

  tick(delta: number) {
    if (!this.context) {
      return;
    }

    const settings = this.settings();
    this.master?.gain.setTargetAtTime(
      settings.audio ? this.ambienceTarget : 0,
      this.context.currentTime,
      0.05,
    );
    this.effects?.gain.setTargetAtTime(
      settings.effectsVolume,
      this.context.currentTime,
      0.04,
    );

    if (!settings.audio) {
      return;
    }

    this.heartbeatTimer -= delta;

    if (this.heartbeatTimer <= 0) {
      this.heartbeatTimer = this.observerMode ? 0.56 : 1.12;
      this.heartbeat();
    }
  }

  fadeForReveal() {
    if (!this.context || !this.master) {
      return;
    }

    this.ambienceTarget = 0.015;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setValueAtTime(
      this.master.gain.value,
      this.context.currentTime,
    );
    this.master.gain.linearRampToValueAtTime(
      0.015,
      this.context.currentTime + 1.2,
    );
  }

  restoreAfterReveal() {
    if (!this.context || !this.master) {
      return;
    }

    this.ambienceTarget = 0.18;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setValueAtTime(
      this.master.gain.value,
      this.context.currentTime,
    );
    this.master.gain.linearRampToValueAtTime(
      0.18,
      this.context.currentTime + 0.7,
    );
  }

  playVoice(key: VoiceClipKey) {
    const settings = this.settings();

    if (!settings.audio) {
      return;
    }

    const audio = new Audio(voiceClips[key]);
    audio.volume = settings.voiceVolume;
    audio.play().catch(() => undefined);
  }

  tone(
    name:
      | "dash"
      | "close"
      | "constrict"
      | "capture"
      | "sever"
      | "reveal"
      | "observer"
      | "tension",
  ) {
    const map = {
      capture: [176, 0.22, 0.12],
      close: [92, 0.16, 0.09],
      constrict: [120, 0.08, 0.055],
      dash: [240, 0.07, 0.05],
      observer: [66, 0.18, 0.08],
      reveal: [36, 0.8, 0.13],
      sever: [28, 0.38, 0.16],
      tension: [310, 0.06, 0.035],
    } satisfies Record<string, [number, number, number]>;
    const [frequency, duration, volume] = map[name];

    this.playTone(frequency, duration, volume);
  }

  private settings(): GameSettings {
    return useGameUiStore.getState().settings;
  }

  private startDrone() {
    if (!this.context || !this.effects) {
      return;
    }

    for (const [frequency, volume, type] of [
      [43, 0.13, "sine"],
      [64.5, 0.055, "triangle"],
    ] as const) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = type;
      gain.gain.value = volume;
      oscillator.connect(gain);
      gain.connect(this.effects);
      oscillator.start();
      this.drone.push({ oscillator, gain });
    }
  }

  private heartbeat() {
    if (!this.context || !this.effects) {
      return;
    }

    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(this.observerMode ? 78 : 58, now);
    oscillator.frequency.exponentialRampToValueAtTime(38, now + 0.18);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      this.observerMode ? 0.23 : 0.11,
      now + 0.02,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(gain);
    gain.connect(this.effects);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
  }

  private playTone(frequency: number, duration: number, volume: number) {
    if (!this.context || !this.effects || !this.settings().audio) {
      return;
    }

    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, frequency * 0.56),
      now + duration,
    );
    gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.effects);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
