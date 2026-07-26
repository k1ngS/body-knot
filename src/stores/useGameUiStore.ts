"use client";

import { create } from "zustand";

export type GamePhase = "menu" | "playing" | "reveal" | "observer" | "ending";

export type GameSettings = {
  audio: boolean;
  captions: boolean;
  reducedMotion: boolean;
  screenShake: boolean;
  highContrast: boolean;
  voiceVolume: number;
  effectsVolume: number;
};

export type DebugSnapshot = {
  fps: number;
  step: number;
  chainLinks: number;
  knotSpan: number;
  knotArea: number;
  cellsInside: number;
  cutterTarget: string;
  phase: string;
};

type RevealMenu = {
  title: string;
  resume: string;
  quit: string;
};

type Toast = {
  id: number;
  text: string;
};

type GameUiState = {
  phase: GamePhase;
  prompt: string;
  caption: string;
  clock: string;
  captureToast: Toast | null;
  debugVisible: boolean;
  settingsVisible: boolean;
  revealMenu: RevealMenu;
  debug: DebugSnapshot;
  settings: GameSettings;
  setPhase: (phase: GamePhase) => void;
  setPrompt: (prompt: string) => void;
  setCaption: (caption: string) => void;
  setClock: (clock: string) => void;
  setToast: (text: string) => void;
  setRevealMenu: (menu: RevealMenu) => void;
  setDebugVisible: (visible: boolean) => void;
  setSettingsVisible: (visible: boolean) => void;
  toggleDebug: () => void;
  toggleSettings: () => void;
  setSettings: (settings: Partial<GameSettings>) => void;
  setDebug: (debug: DebugSnapshot) => void;
  resetUi: () => void;
};

const defaultSettings: GameSettings = {
  audio: true,
  captions: true,
  reducedMotion: false,
  screenShake: true,
  highContrast: false,
  voiceVolume: 0.82,
  effectsVolume: 0.62,
};

const defaultDebug: DebugSnapshot = {
  fps: 0,
  step: 0,
  chainLinks: 0,
  knotSpan: 0,
  knotArea: 0,
  cellsInside: 0,
  cutterTarget: "none",
  phase: "menu",
};

export const useGameUiStore = create<GameUiState>((set) => ({
  phase: "menu",
  prompt: "",
  caption: "",
  clock: "00:00",
  captureToast: null,
  debugVisible: false,
  settingsVisible: false,
  revealMenu: {
    title: "PAUSED",
    resume: "RESUME",
    quit: "QUIT",
  },
  debug: defaultDebug,
  settings: defaultSettings,
  setPhase: (phase) => set({ phase }),
  setPrompt: (prompt) => set({ prompt }),
  setCaption: (caption) => set({ caption }),
  setClock: (clock) => set({ clock }),
  setToast: (text) => {
    const id = Date.now();
    set({
      captureToast: {
        id,
        text,
      },
    });

    window.setTimeout(() => {
      set((state) =>
        state.captureToast?.id === id ? { captureToast: null } : state,
      );
    }, 1500);
  },
  setRevealMenu: (revealMenu) => set({ revealMenu }),
  setDebugVisible: (debugVisible) => set({ debugVisible }),
  setSettingsVisible: (settingsVisible) => set({ settingsVisible }),
  toggleDebug: () => set((state) => ({ debugVisible: !state.debugVisible })),
  toggleSettings: () =>
    set((state) => ({ settingsVisible: !state.settingsVisible })),
  setSettings: (settings) =>
    set((state) => ({ settings: { ...state.settings, ...settings } })),
  setDebug: (debug) => set({ debug }),
  resetUi: () =>
    set({
      phase: "menu",
      prompt: "",
      caption: "",
      clock: "00:00",
      captureToast: null,
      debugVisible: false,
      settingsVisible: false,
      revealMenu: {
        title: "PAUSED",
        resume: "RESUME",
        quit: "QUIT",
      },
      debug: defaultDebug,
    }),
}));
