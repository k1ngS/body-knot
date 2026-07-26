"use client";

import { useEffect, useRef } from "react";
import { GameEngine } from "@/game/core/GameEngine";
import { strings } from "@/i18n/strings";
import { type GameSettings, useGameUiStore } from "@/stores/useGameUiStore";

const settingKeys = [
  ["audio", strings.settingsLabels.audio],
  ["captions", strings.settingsLabels.captions],
  ["reducedMotion", strings.settingsLabels.reducedMotion],
  ["screenShake", strings.settingsLabels.shake],
  ["highContrast", strings.settingsLabels.highContrast],
] as const;

export function BodyKnotShell() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const {
    caption,
    captureToast,
    clock,
    debug,
    debugVisible,
    phase,
    prompt,
    revealMenu,
    settings,
    settingsVisible,
    setSettings,
    toggleSettings,
  } = useGameUiStore();

  useEffect(() => {
    if (!canvasRef.current) {
      return undefined;
    }

    const engine = new GameEngine(canvasRef.current);
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-[#020304] text-[#e8e8e4]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full cursor-crosshair"
        aria-label="BODY//KNOT game canvas"
      />

      {phase === "menu" && (
        <section className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_52%,transparent_0_18%,rgba(5,6,7,0.76)_58%,#020304_100%)]">
          <span className="absolute left-5 top-5 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-[#4e5660]">
            {strings.eyebrow}
          </span>
          <span className="absolute bottom-5 right-5 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-[#4e5660]">
            POINTER STATUS: UNSEEN
          </span>
          <div className="w-[min(560px,90vw)] px-7 text-center">
            <div className="text-[0.62rem] font-black uppercase tracking-[0.28em] text-[#646b73]">
              A 32x32 biological interface
            </div>
            <h1 className="my-3 text-[clamp(3rem,9vw,6.5rem)] font-black leading-[0.82] tracking-[0.07em]">
              BODY<span className="text-[#78727f]">{"//"}</span>KNOT
            </h1>
            <p className="mx-auto mb-7 max-w-[430px] text-sm leading-7 text-[#858b92]">
              {strings.menuTag}
            </p>
            <div className="mx-auto grid w-[min(290px,100%)]">
              <button
                className="border-t border-[#25292e] bg-transparent px-3 py-4 text-left text-xs font-black uppercase tracking-[0.18em] text-[#b7bbc0] transition hover:pl-5 hover:text-white"
                type="button"
                onClick={() => engineRef.current?.enterHost()}
              >
                {strings.enter}
              </button>
              <button
                className="border-y border-[#25292e] bg-transparent px-3 py-4 text-left text-xs font-black uppercase tracking-[0.18em] text-[#b7bbc0] transition hover:pl-5 hover:text-white"
                type="button"
                onClick={toggleSettings}
              >
                {strings.settings}
              </button>
            </div>
            <div className="mt-6 text-[0.58rem] uppercase tracking-[0.18em] text-[#535a62]">
              {strings.audioNotice}
            </div>
          </div>
        </section>
      )}

      {(phase === "playing" || phase === "observer") && (
        <section className="pointer-events-none absolute inset-0">
          <div className="absolute left-0 right-0 top-0 flex h-14 items-start justify-between bg-gradient-to-b from-[#030405dd] to-transparent px-5 pt-4 text-[0.58rem] uppercase tracking-[0.18em] text-[#747b82]">
            <span>
              {phase === "observer"
                ? strings.hud.contaminated
                : strings.hud.stable}
            </span>
            <span>{clock}</span>
          </div>
          {phase === "observer" && (
            <div className="absolute left-1/2 top-[9%] -translate-x-1/2 text-center text-[0.65rem] font-black uppercase tracking-[0.24em] text-[#b73540] drop-shadow-[0_0_16px_#8f1d29]">
              {strings.observerWarning}
            </div>
          )}
          {prompt && (
            <div className="absolute bottom-[9%] left-1/2 -translate-x-1/2 text-center text-[0.74rem] font-black uppercase tracking-[0.24em] text-[#c8d6d3]">
              {prompt}
            </div>
          )}
          <div className="absolute bottom-4 left-5 right-5 hidden justify-between text-[0.58rem] uppercase tracking-[0.16em] text-[#5e656d] sm:flex">
            <span>{strings.hud.membrane}</span>
            {phase === "playing" && (
              <span>Right click cancels. Space dashes.</span>
            )}
          </div>
        </section>
      )}

      {phase === "reveal" && (
        <section className="absolute inset-0 grid place-items-center bg-[#02030452] backdrop-blur-[1px]">
          <div className="relative z-10 w-[min(420px,88vw)] border border-[#22262b] bg-[#060708dd] p-7 text-center shadow-[0_30px_100px_#000c]">
            <div className="mb-4 text-[0.62rem] uppercase tracking-[0.3em] text-[#747b82]">
              {revealMenu.title}
            </div>
            <div className="mb-4 min-h-14 whitespace-pre-line text-sm font-bold uppercase leading-8 tracking-[0.16em] text-[#d0d0ca]">
              {settings.captions ? caption : ""}
            </div>
            <button
              className="w-full border-t border-[#292d32] bg-transparent p-4 text-xs font-black uppercase tracking-[0.2em] text-[#b7bbc0] hover:bg-[#0c0e10] hover:text-white"
              type="button"
              onClick={() => engineRef.current?.runFromRevelation()}
            >
              {revealMenu.resume}
            </button>
            <button
              className="w-full border-y border-[#292d32] bg-transparent p-4 text-xs font-black uppercase tracking-[0.2em] text-[#b7bbc0] hover:bg-[#0c0e10] hover:text-white"
              type="button"
              onClick={() => engineRef.current?.quitResponse()}
            >
              {revealMenu.quit}
            </button>
          </div>
        </section>
      )}

      {phase === "ending" && (
        <section className="absolute inset-0 grid place-items-center bg-[#010203ed] backdrop-blur">
          <div className="w-[min(620px,90vw)] text-center">
            <div className="text-[0.62rem] font-black uppercase tracking-[0.28em] text-[#8d151f]">
              POINTER MEMORY STORED
            </div>
            <h2 className="my-4 whitespace-pre-line text-[clamp(1.7rem,5vw,3.4rem)] font-black uppercase tracking-[0.14em]">
              {settings.captions
                ? caption
                : `${strings.endingA}\n${strings.endingB}`}
            </h2>
            <button
              className="mt-4 border border-[#34383e] bg-[#080a0c] px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-[#d7d7d1] hover:border-[#73777e]"
              type="button"
              onClick={() => engineRef.current?.restart()}
            >
              {strings.restart}
            </button>
          </div>
        </section>
      )}

      {settings.captions &&
        caption &&
        phase !== "reveal" &&
        phase !== "ending" && (
          <div className="pointer-events-none absolute bottom-[18%] left-1/2 max-w-[90vw] -translate-x-1/2 whitespace-pre-line text-center text-sm font-bold uppercase tracking-[0.16em] text-[#d0d0ca]">
            {caption}
          </div>
        )}

      {captureToast && (
        <div
          key={captureToast.id}
          className="pointer-events-none absolute left-1/2 top-[18%] -translate-x-1/2 animate-[fadeToast_1.4s_ease_forwards] text-sm font-black uppercase tracking-[0.24em] text-[#dfffff]"
        >
          {captureToast.text}
        </div>
      )}

      <button
        className="absolute right-4 top-16 z-20 border border-[#2a3035] bg-[#050708aa] px-3 py-2 text-[0.6rem] font-black uppercase tracking-[0.16em] text-[#929aa0] backdrop-blur hover:text-white"
        type="button"
        onClick={toggleSettings}
      >
        {strings.settings}
      </button>

      {settingsVisible && (
        <SettingsPanel settings={settings} onChange={setSettings} />
      )}

      {debugVisible && (
        <div className="absolute left-4 top-16 z-20 w-64 border border-[#2b3438] bg-[#020304d9] p-3 font-mono text-[0.68rem] leading-5 text-[#9ee7ef] backdrop-blur">
          <div>FPS {debug.fps}</div>
          <div>STEP {debug.step}</div>
          <div>CHAIN {debug.chainLinks}</div>
          <div>PATH {debug.pathLength.toFixed(2)}</div>
          <div>AREA {debug.enclosedArea.toFixed(2)}</div>
          <div>INSIDE {debug.cellsInside}</div>
          <div>PHASE {debug.phase}</div>
        </div>
      )}
    </main>
  );
}

function SettingsPanel({
  settings,
  onChange,
}: {
  settings: GameSettings;
  onChange: (settings: Partial<GameSettings>) => void;
}) {
  return (
    <section className="absolute right-4 top-[104px] z-30 w-[min(300px,calc(100vw-2rem))] border border-[#2a3035] bg-[#050708e8] p-4 text-xs text-[#c8cecc] shadow-[0_24px_80px_#000b] backdrop-blur">
      <div className="mb-3 text-[0.62rem] font-black uppercase tracking-[0.22em] text-[#747b82]">
        {strings.settings}
      </div>
      <div className="grid gap-3">
        {settingKeys.map(([key, label]) => (
          <label
            className="flex items-center justify-between gap-4 uppercase tracking-[0.12em]"
            key={key}
          >
            <span>{label}</span>
            <input
              checked={Boolean(settings[key])}
              className="h-4 w-4 accent-[#9cf2ff]"
              type="checkbox"
              onChange={(event) => onChange({ [key]: event.target.checked })}
            />
          </label>
        ))}
        <VolumeControl
          label={strings.settingsLabels.voice}
          value={settings.voiceVolume}
          onChange={(voiceVolume) => onChange({ voiceVolume })}
        />
        <VolumeControl
          label={strings.settingsLabels.effects}
          value={settings.effectsVolume}
          onChange={(effectsVolume) => onChange({ effectsVolume })}
        />
      </div>
    </section>
  );
}

function VolumeControl({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="grid gap-2 uppercase tracking-[0.12em]">
      <span className="flex justify-between">
        <span>{label}</span>
        <span>{Math.round(value * 100)}</span>
      </span>
      <input
        className="accent-[#9cf2ff]"
        max={1}
        min={0}
        step={0.01}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
