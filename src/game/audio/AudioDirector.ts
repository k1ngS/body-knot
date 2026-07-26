import { type VoiceClipKey, voiceClips } from "@/i18n/strings";
import { type GameSettings, useGameUiStore } from "@/stores/useGameUiStore";

type OscillatorBundle = {
  oscillator: OscillatorNode;
  gain: GainNode;
};

type ActiveAudio = {
  audio: HTMLAudioElement;
  volume: number;
};

type LoopKey = "ambience" | "heartbeat" | "revelationBed";
type SfxKey =
  | "eyeOpen"
  | "hostBind"
  | "observerLock"
  | "signalSever"
  | "youArePressure";

const loopAssets = {
  ambience: "/audio/ambience/ambience_organic_loop_16s.wav",
  heartbeat: "/audio/ambience/heartbeat_loop_12s.wav",
  revelationBed: "/audio/ambience/revelation_voice_bed_13s.wav",
} satisfies Record<LoopKey, string>;

const sfxAssets = {
  eyeOpen: "/audio/sfx/sfx_eye_open.wav",
  hostBind: "/audio/sfx/sfx_host_bind.wav",
  observerLock: "/audio/sfx/sfx_observer_lock.wav",
  signalSever: "/audio/sfx/sfx_signal_sever.wav",
  youArePressure: "/audio/sfx/sfx_you_are_pressure.wav",
} satisfies Record<SfxKey, string>;

const baseLoopVolumes = {
  ambience: 0.21,
  heartbeat: 0.1,
  revelationBed: 0.2,
} satisfies Record<LoopKey, number>;

export class AudioDirector {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private drone: OscillatorBundle[] = [];
  private loops: Partial<Record<LoopKey, HTMLAudioElement>> = {};
  private activeVoices: ActiveAudio[] = [];
  private activeSfx: ActiveAudio[] = [];
  private active = false;
  private lastAudioEnabled = true;
  private observerMode = false;
  private heartbeatSilenceTimer = 0;
  private ambienceDuck = 1;
  private heartbeatIntensity = 0;

  init() {
    if (this.context || !this.settings().audio) {
      if (this.context) {
        this.startGameplayLoops();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.music = this.context.createGain();
    this.effects = this.context.createGain();
    this.master.gain.value = 1;
    this.music.gain.value = this.settings().musicVolume;
    this.effects.gain.value = this.settings().effectsVolume;
    this.music.connect(this.master);
    this.effects.connect(this.master);
    this.master.connect(this.context.destination);
    this.startDrone();
    this.prepareLoops();
    this.startGameplayLoops();
  }

  destroy() {
    this.stopAll();

    for (const bundle of this.drone) {
      bundle.oscillator.stop();
      bundle.oscillator.disconnect();
      bundle.gain.disconnect();
    }

    this.drone = [];
    this.context?.close();
    this.context = null;
    this.master = null;
    this.music = null;
    this.effects = null;
  }

  stopAll() {
    this.active = false;

    for (const audio of Object.values(this.loops)) {
      this.stopAudio(audio);
    }

    for (const active of [...this.activeVoices, ...this.activeSfx]) {
      this.stopAudio(active.audio);
    }

    this.activeVoices = [];
    this.activeSfx = [];
    this.ambienceDuck = 1;
    this.heartbeatIntensity = 0;
    this.observerMode = false;
    this.heartbeatSilenceTimer = 0;
  }

  setObserverMode(enabled: boolean) {
    this.observerMode = enabled;
  }

  silenceHeartbeat(seconds: number) {
    this.heartbeatSilenceTimer = Math.max(this.heartbeatSilenceTimer, seconds);
  }

  tick(delta: number, danger = 0) {
    if (!this.context) {
      return;
    }

    this.heartbeatSilenceTimer = Math.max(
      0,
      this.heartbeatSilenceTimer - delta,
    );
    this.heartbeatIntensity = clampAudio(
      Math.max(this.heartbeatIntensity - delta * 0.18, danger),
      0,
      1,
    );

    const settings = this.settings();
    this.syncMuteState(settings);
    const muted = !settings.audio || !this.active;
    this.master?.gain.setTargetAtTime(
      muted ? 0 : 1,
      this.context.currentTime,
      0.04,
    );
    this.music?.gain.setTargetAtTime(
      settings.musicVolume,
      this.context.currentTime,
      0.08,
    );
    this.effects?.gain.setTargetAtTime(
      settings.effectsVolume,
      this.context.currentTime,
      0.04,
    );
    this.updateLoopVolumes(settings, muted);
    this.updateActiveAudio(settings, muted);
  }

  startGameplayLoops() {
    if (!this.settings().audio) {
      return;
    }

    this.active = true;
    this.prepareLoops();
    this.resumeActiveLoops();
    this.stopAudio(this.loops.revelationBed);
    this.ambienceDuck = 1;
  }

  fadeForReveal() {
    if (!this.context) {
      return;
    }

    this.prepareLoops();
    this.ambienceDuck = 0.18;
    this.playLoop("revelationBed");
  }

  startRevelation() {
    this.fadeForReveal();
    this.playSfx("eyeOpen", 0.38);
  }

  restoreAfterReveal() {
    if (!this.context) {
      return;
    }

    this.ambienceDuck = 1;
    this.stopAudio(this.loops.revelationBed);
    this.startGameplayLoops();
  }

  playVoice(key: VoiceClipKey, volume = 1) {
    const settings = this.settings();

    if (!settings.audio) {
      return;
    }

    const audio = this.createOneShot(
      voiceClips[key],
      settings.voiceVolume * volume,
    );
    this.activeVoices.push({ audio, volume });
    this.playAudio(audio);
  }

  playSfx(key: SfxKey, volume = 1) {
    const settings = this.settings();

    if (!settings.audio) {
      return;
    }

    const audio = this.createOneShot(
      sfxAssets[key],
      settings.effectsVolume * volume,
    );
    this.activeSfx.push({ audio, volume });
    this.playAudio(audio);
  }

  pressure() {
    this.playSfx("youArePressure", 0.32);
  }

  hostBind() {
    this.playSfx("hostBind", 0.72);
  }

  observerLock() {
    this.playSfx("observerLock", 0.7);
  }

  signalSever() {
    this.playSfx("signalSever", 0.6);
  }

  tone(
    name:
      | "dash"
      | "close"
      | "capture"
      | "sever"
      | "reveal"
      | "observer"
      | "tension",
  ) {
    const map = {
      capture: [176, 0.22, 0.09],
      close: [92, 0.16, 0.07],
      dash: [240, 0.07, 0.04],
      observer: [66, 0.18, 0.05],
      reveal: [36, 0.8, 0.06],
      sever: [28, 0.38, 0.11],
      tension: [310, 0.06, 0.025],
    } satisfies Record<string, [number, number, number]>;
    const [frequency, duration, volume] = map[name];

    this.playTone(frequency, duration, volume);
  }

  private settings(): GameSettings {
    return useGameUiStore.getState().settings;
  }

  private prepareLoops() {
    for (const key of Object.keys(loopAssets) as LoopKey[]) {
      if (this.loops[key]) {
        continue;
      }

      const audio = new Audio(loopAssets[key]);
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = 0;
      this.loops[key] = audio;
    }
  }

  private playLoop(key: LoopKey) {
    const audio = this.loops[key];

    if (!audio || !this.settings().audio) {
      return;
    }

    audio.play().catch(() => undefined);
  }

  private resumeActiveLoops() {
    this.playLoop("ambience");
    this.playLoop("heartbeat");

    if (this.ambienceDuck < 1) {
      this.playLoop("revelationBed");
    }
  }

  private syncMuteState(settings: GameSettings) {
    if (settings.audio === this.lastAudioEnabled) {
      return;
    }

    this.lastAudioEnabled = settings.audio;

    if (!settings.audio) {
      this.stopAudibleInstances();
      return;
    }

    if (this.active) {
      this.resumeActiveLoops();
    }
  }

  private stopAudibleInstances() {
    for (const audio of Object.values(this.loops)) {
      this.stopAudio(audio);
    }

    for (const active of [...this.activeVoices, ...this.activeSfx]) {
      this.stopAudio(active.audio);
    }

    this.activeVoices = [];
    this.activeSfx = [];
  }

  private updateLoopVolumes(settings: GameSettings, muted: boolean) {
    const musicVolume = muted ? 0 : settings.musicVolume;
    const heartbeatLevel =
      this.heartbeatSilenceTimer > 0
        ? 0
        : baseLoopVolumes.heartbeat +
          this.heartbeatIntensity * (this.observerMode ? 0.16 : 0.08);
    const targets = {
      ambience: baseLoopVolumes.ambience * musicVolume * this.ambienceDuck,
      heartbeat: heartbeatLevel * musicVolume * this.ambienceDuck,
      revelationBed:
        baseLoopVolumes.revelationBed *
        musicVolume *
        (this.ambienceDuck < 1 ? 1 : 0),
    } satisfies Record<LoopKey, number>;

    for (const key of Object.keys(targets) as LoopKey[]) {
      const audio = this.loops[key];

      if (audio) {
        audio.volume = clampAudio(targets[key], 0, 1);
      }
    }
  }

  private updateActiveAudio(settings: GameSettings, muted: boolean) {
    this.activeVoices = this.activeVoices.filter(
      (active) => !active.audio.ended,
    );
    this.activeSfx = this.activeSfx.filter((active) => !active.audio.ended);

    for (const active of this.activeVoices) {
      active.audio.volume = muted ? 0 : settings.voiceVolume * active.volume;
    }

    for (const active of this.activeSfx) {
      active.audio.volume = muted ? 0 : settings.effectsVolume * active.volume;
    }
  }

  private createOneShot(src: string, volume: number) {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.volume = clampAudio(volume, 0, 1);

    return audio;
  }

  private playAudio(audio: HTMLAudioElement) {
    audio.play().catch(() => undefined);
  }

  private stopAudio(audio: HTMLAudioElement | undefined) {
    if (!audio) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
  }

  private startDrone() {
    if (!this.context || !this.music) {
      return;
    }

    for (const [frequency, volume, type] of [
      [43, 0.035, "sine"],
      [64.5, 0.018, "triangle"],
    ] as const) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = type;
      gain.gain.value = volume;
      oscillator.connect(gain);
      gain.connect(this.music);
      oscillator.start();
      this.drone.push({ oscillator, gain });
    }
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

const clampAudio = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
