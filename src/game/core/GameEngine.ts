import { strings } from "@/i18n/strings";
import { useGameUiStore } from "@/stores/useGameUiStore";
import { AudioDirector } from "../audio/AudioDirector";
import {
  pointInPolygon,
  polygonArea,
  polygonCentroid,
} from "../geometry/polygon";
import { clamp, dist, normalize, type Vec2, vec } from "../geometry/vector";
import { CanvasRenderer } from "../rendering/CanvasRenderer";
import {
  applySafeCut,
  canCutterThreaten,
  cutterTelegraphReady,
  findValidCutterTarget,
  isCutterTargetValid,
  resetCutterTelegraph,
  runCutterLifecycleChecks,
} from "../systems/cutterSafety";
import { detectKnotCandidate, detectSelfKnot } from "../systems/knotDetection";
import {
  CHAIN_SEGMENT_LENGTH,
  CUTTER_MIN_SECONDS,
  FIXED_TIMESTEP,
  INITIAL_LINKS,
  KNOT_CAPTURE_SECONDS,
  KNOT_COOLDOWN_SECONDS,
  KNOT_HITSTOP_SECONDS,
  MIN_KNOT_AREA,
  MIN_KNOT_SPAN,
  OBSERVER_DURATION,
  PROTECTED_CHAIN_LINKS,
  REVELATION_FORCE_SECONDS,
  REVELATION_MIN_SECONDS,
  WORLD_SIZE,
} from "./constants";
import type {
  Cell,
  CellType,
  ChainLink,
  Cutter,
  KnotCandidate,
  KnotState,
  LinkKind,
  ObserverAttack,
  Particle,
  Player,
  Scar,
} from "./types";

type RuntimePhase = "menu" | "playing" | "reveal" | "observer" | "ending";

type InputState = {
  keys: Set<string>;
  mouseScreen: Vec2;
  mouseWorld: Vec2;
};

const isDevelopment = process.env.NODE_ENV !== "production";

export class GameEngine {
  private renderer: CanvasRenderer;
  private audio = new AudioDirector();
  private animationFrame = 0;
  private lastFrame = performance.now();
  private accumulator = 0;
  private phase: RuntimePhase = "menu";
  private startedAt = 0;
  private gameplayElapsed = 0;
  private phaseStartedAt = 0;
  private simulationStep = 0;
  private revealStage = -1;
  private captures = 0;
  private cellId = 1;
  private shake = 0;
  private fps = 0;
  private fpsFrames = 0;
  private fpsTimer = 0;
  private attackTimer = 0;
  private firstCutterQueued = false;
  private knotCooldown = 0;
  private lastKnotSpan = 0;
  private largestCapture = 0;
  private candidate: KnotCandidate | null = null;
  private chainWave = 0;
  private input: InputState = {
    keys: new Set(),
    mouseScreen: { x: 0, y: 0 },
    mouseWorld: { x: 16, y: 16 },
  };
  private player: Player = this.createPlayer();
  private chain: ChainLink[] = [];
  private severed: ChainLink[] = [];
  private cells: Cell[] = [];
  private scars: Scar[] = [];
  private particles: Particle[] = [];
  private observerAttacks: ObserverAttack[] = [];
  private cutter: Cutter | null = null;
  private knot: KnotState = { mode: "idle" };
  private ghostRoute: Vec2[] = [
    { x: 16.5, y: 19.2 },
    { x: 18.2, y: 19.4 },
    { x: 18.4, y: 20.8 },
    { x: 16.2, y: 21.0 },
    { x: 15.7, y: 19.3 },
    { x: 17.4, y: 18.4 },
  ];

  constructor(canvas: HTMLCanvasElement) {
    if (isDevelopment) {
      runCutterLifecycleChecks();
    }

    this.renderer = new CanvasRenderer(canvas);
    this.resetSimulation();
    this.installEvents();
    this.loop = this.loop.bind(this);
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.animationFrame);
    this.audio.destroy();
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("mousemove", this.handlePointerMove);
    window.removeEventListener("mousedown", this.handlePointerDown);
    window.removeEventListener("mouseup", this.handlePointerUp);
    window.removeEventListener("contextmenu", this.handleContextMenu);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
  }

  enterHost() {
    this.audio.init();
    this.resetSimulation();
    this.phase = "playing";
    this.startedAt = performance.now() / 1000;
    this.gameplayElapsed = 0;
    this.phaseStartedAt = this.startedAt;
    this.updateTitle("BODY//KNOT");
    useGameUiStore.getState().setSettingsVisible(false);
    useGameUiStore.getState().setPhase("playing");
    useGameUiStore.getState().setPrompt(strings.prompts.circle);
    this.audio.tone("close");
  }

  restart() {
    this.audio.setObserverMode(false);
    this.resetSimulation();
    this.phase = "menu";
    this.updateTitle("BODY//KNOT");
    useGameUiStore.getState().resetUi();
  }

  runFromRevelation() {
    if (this.phase !== "reveal") {
      return;
    }

    this.beginObserver();
  }

  quitResponse() {
    if (this.phase !== "reveal") {
      return;
    }

    this.audio.playVoice("let_me_out");
    useGameUiStore.getState().setRevealMenu({
      title: strings.pointer,
      resume: strings.run,
      quit: "GET OUT",
    });
    window.setTimeout(() => {
      if (this.phase === "reveal") {
        this.audio.playVoice("get_out");
      }
    }, 1000);
    window.setTimeout(() => {
      if (this.phase === "reveal") {
        this.beginObserver();
      }
    }, 2200);
  }

  private resetSimulation() {
    this.player = this.createPlayer();
    this.chain = [];
    this.severed = [];
    this.cells = [];
    this.scars = [];
    this.particles = [];
    this.observerAttacks = [];
    this.cutter = null;
    this.knot = { mode: "idle" };
    this.captures = 0;
    this.gameplayElapsed = 0;
    this.firstCutterQueued = false;
    this.revealStage = -1;
    this.attackTimer = 0;
    this.knotCooldown = 0;
    this.lastKnotSpan = 0;
    this.largestCapture = 0;
    this.candidate = null;
    this.chainWave = 0;
    this.shake = 0;
    this.simulationStep = 0;

    for (let index = 0; index < INITIAL_LINKS; index += 1) {
      const pos = {
        x: this.player.pos.x - index * CHAIN_SEGMENT_LENGTH,
        y: this.player.pos.y,
      };
      this.chain.push({
        pos: { ...pos },
        prev: { ...pos },
        kind: "starter",
        mass: 1,
        dead: false,
      });
    }

    this.spawnGuidedCells();

    for (const center of [
      { x: 10.5, y: 12.4 },
      { x: 22.4, y: 14.8 },
      { x: 19.8, y: 22.2 },
      { x: 9.4, y: 22.6 },
    ]) {
      this.spawnCellCluster(center, 4, false);
    }
  }

  private createPlayer(): Player {
    return {
      pos: { x: 16.5, y: 19.2 },
      prev: { x: 16.5, y: 19.2 },
      vel: vec(),
      radius: 0.42,
      dashCooldown: 0,
      dashImpulse: 0,
    };
  }

  private spawnGuidedCells() {
    const guided: Array<[CellType, number, number]> = [
      ["hunter", 16.55, 19.85],
      ["platelet", 17.08, 20.05],
    ];

    for (const [type, x, y] of guided) {
      this.cells.push({
        id: this.cellId,
        type,
        pos: { x, y },
        vel: vec(),
        radius: type === "platelet" ? 0.4 : 0.32,
        phase: this.cellId * 1.71,
        highlighted: true,
        captured: false,
      });
      this.cellId += 1;
    }
  }

  private createRandomCell(highlighted: boolean): Cell {
    const typeRoll = Math.random();
    const type: CellType =
      typeRoll < 0.44 ? "hunter" : typeRoll < 0.75 ? "platelet" : "fever";
    const radius = type === "platelet" ? 0.42 : type === "fever" ? 0.33 : 0.3;
    const cell = {
      id: this.cellId,
      type,
      pos: {
        x: 8 + Math.random() * 16,
        y: 9 + Math.random() * 15,
      },
      vel: vec(),
      radius,
      phase: Math.random() * Math.PI * 2,
      highlighted,
      captured: false,
    };
    this.cellId += 1;

    return cell;
  }

  private spawnCellCluster(center: Vec2, count: number, highlighted: boolean) {
    for (let index = 0; index < count; index += 1) {
      const angle =
        (index / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.7;
      const radius = 0.35 + Math.random() * 1.25;
      const cell = this.createRandomCell(highlighted);
      cell.pos = {
        x: clamp(center.x + Math.cos(angle) * radius, 1.4, WORLD_SIZE - 1.4),
        y: clamp(center.y + Math.sin(angle) * radius, 1.4, WORLD_SIZE - 1.4),
      };

      if (dist(cell.pos, this.player.pos) < 2.4) {
        const away = normalize({
          x: cell.pos.x - this.player.pos.x,
          y: cell.pos.y - this.player.pos.y,
        });
        cell.pos.x = clamp(
          this.player.pos.x + away.x * 2.6,
          1.4,
          WORLD_SIZE - 1.4,
        );
        cell.pos.y = clamp(
          this.player.pos.y + away.y * 2.6,
          1.4,
          WORLD_SIZE - 1.4,
        );
      }

      this.cells.push(cell);
    }
  }

  private nextClusterCenter(): Vec2 {
    const phase = this.gameplayElapsed * 0.22 + this.captures * 1.37;
    const centers = [
      {
        x: 12 + Math.sin(phase) * 2.6,
        y: 11.5 + Math.cos(phase * 0.9) * 1.8,
      },
      {
        x: 20.4 + Math.cos(phase * 0.8) * 2.4,
        y: 13.2 + Math.sin(phase) * 2,
      },
      {
        x: 19 + Math.sin(phase * 0.7) * 2.8,
        y: 22 + Math.cos(phase) * 1.6,
      },
      {
        x: 10.5 + Math.cos(phase) * 2.2,
        y: 22.4 + Math.sin(phase * 0.6) * 2,
      },
    ];
    let best = centers[this.captures % centers.length];

    for (const center of centers) {
      if (dist(center, this.player.pos) > dist(best, this.player.pos)) {
        best = center;
      }
    }

    return {
      x: clamp(best.x, 4.5, WORLD_SIZE - 4.5),
      y: clamp(best.y, 4.5, WORLD_SIZE - 4.5),
    };
  }

  private loop(nowMs: number) {
    const now = nowMs / 1000;
    const frameDelta = Math.min(0.08, now - this.lastFrame / 1000);
    this.lastFrame = nowMs;
    this.accumulator += frameDelta;
    this.fpsFrames += 1;
    this.fpsTimer += frameDelta;

    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTimer);
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }

    while (this.accumulator >= FIXED_TIMESTEP) {
      this.step(FIXED_TIMESTEP, now);
      this.accumulator -= FIXED_TIMESTEP;
    }

    this.audio.tick(frameDelta);
    this.render(now);
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  private step(delta: number, now: number) {
    this.simulationStep += 1;
    this.shake = Math.max(0, this.shake - delta * 2.8);
    this.chainWave = Math.max(0, this.chainWave - delta * 1.8);
    const frozen =
      this.phase === "playing" &&
      this.knot.mode === "capturing" &&
      this.knot.hitStop > 0;

    if (this.phase === "playing" && useGameUiStore.getState().settingsVisible) {
      this.updateDebug();
      return;
    }

    if (this.phase === "playing") {
      this.updatePlaying(delta);
    } else if (this.phase === "reveal") {
      this.updateReveal(now);
    } else if (this.phase === "observer") {
      this.updateObserver(delta, now);
    }

    if (!frozen) {
      this.updateCells(delta);
      this.updateChain(delta);

      if (this.phase === "playing") {
        this.updateKnotCandidate(delta);
        this.detectKnotAfterChain();
      }
    } else if (this.knot.mode === "capturing") {
      this.knot.hitStop = Math.max(0, this.knot.hitStop - delta);
    }

    this.updateParticles(delta);
    this.updateDebug();
  }

  private updatePlaying(delta: number) {
    this.gameplayElapsed += delta;
    const elapsed = this.gameplayElapsed;
    const store = useGameUiStore.getState();
    store.setClock(`00:${Math.floor(elapsed).toString().padStart(2, "0")}`);

    this.knotCooldown = Math.max(0, this.knotCooldown - delta);

    if (this.knot.mode === "capturing") {
      this.updateKnotCapture(delta);
    } else {
      this.updatePlayer(delta, 24.5, 5.05);
    }

    this.updateCutter(delta);

    if (
      !this.firstCutterQueued &&
      this.captures >= 2 &&
      elapsed >= CUTTER_MIN_SECONDS
    ) {
      this.firstCutterQueued = true;
      this.spawnCutter();
      store.setToast("CUTTER CELL ENTERED");
    }

    if (this.captures === 0 && elapsed < 2.7) {
      store.setPrompt(strings.prompts.circle);
    } else if (this.captures === 0) {
      store.setPrompt(strings.prompts.cross);
    } else if (elapsed > 84 && this.knot.mode === "idle") {
      store.setPrompt(strings.prompts.cursor);
    } else if (elapsed > 68 && this.knot.mode === "idle") {
      store.setPrompt(strings.prompts.larger);
    } else if (this.knot.mode === "idle") {
      store.setPrompt(strings.prompts.free);
    }

    if (
      elapsed >= REVELATION_FORCE_SECONDS ||
      (elapsed >= REVELATION_MIN_SECONDS && this.captures >= 8)
    ) {
      this.triggerRevelation();
    }
  }

  private updateObserver(delta: number, now: number) {
    const elapsed = now - this.phaseStartedAt;
    useGameUiStore.getState().setClock(
      `00:${Math.max(0, Math.ceil(OBSERVER_DURATION - elapsed))
        .toString()
        .padStart(2, "0")}`,
    );
    this.updatePlayer(delta, 8.8, 8.7);
    this.attackTimer -= delta;

    if (this.attackTimer <= 0) {
      this.attackTimer = 1.24;
      this.observerAttacks.push({
        pos: { ...this.input.mouseScreen },
        life: 0.95,
        maxLife: 0.95,
        hit: false,
      });
      this.audio.tone("observer");
    }

    for (const attack of this.observerAttacks) {
      attack.life -= delta;

      if (!attack.hit && attack.life < 0.18) {
        attack.hit = true;
        this.resolveObserverAttack(attack);
      }
    }

    this.observerAttacks = this.observerAttacks.filter(
      (attack) => attack.life > 0,
    );

    if (elapsed >= OBSERVER_DURATION) {
      this.endSlice();
    }
  }

  private updateReveal(now: number) {
    const elapsed = now - this.phaseStartedAt;
    const stages = [
      { at: 1.0, caption: strings.revealLines[0], voice: "i_see_you" },
      { at: 3.4, caption: strings.revealLines[1], voice: "it_stops" },
      { at: 6.0, caption: strings.revealLines[2], voice: "it_moves" },
      { at: 8.8, caption: strings.revealLines[3], voice: "not_the_parasite" },
      { at: 11.7, caption: strings.revealLines[4], voice: "you_are" },
    ] as const;

    for (let index = 0; index < stages.length; index += 1) {
      const stage = stages[index];

      if (elapsed >= stage.at && this.revealStage < index) {
        this.revealStage = index;
        useGameUiStore.getState().setCaption(stage.caption);
        this.audio.playVoice(stage.voice);
        this.audio.tone("reveal");

        if (index === stages.length - 1) {
          useGameUiStore.getState().setRevealMenu({
            title: strings.pointer,
            resume: strings.run,
            quit: strings.letMeOut,
          });
          this.updateTitle("I SEE YOUR CURSOR");
        }
      }
    }
  }

  private updatePlayer(delta: number, acceleration: number, drag: number) {
    let x = 0;
    let y = 0;

    if (this.input.keys.has("a") || this.input.keys.has("arrowleft")) {
      x -= 1;
    }

    if (this.input.keys.has("d") || this.input.keys.has("arrowright")) {
      x += 1;
    }

    if (this.input.keys.has("w") || this.input.keys.has("arrowup")) {
      y -= 1;
    }

    if (this.input.keys.has("s") || this.input.keys.has("arrowdown")) {
      y += 1;
    }

    const direction = normalize({ x, y });
    this.player.dashCooldown = Math.max(0, this.player.dashCooldown - delta);
    this.player.prev = { ...this.player.pos };
    this.player.vel.x += direction.x * acceleration * delta;
    this.player.vel.y += direction.y * acceleration * delta;
    this.player.vel.x *= Math.max(0, 1 - drag * delta);
    this.player.vel.y *= Math.max(0, 1 - drag * delta);

    if (this.player.dashImpulse > 0) {
      const dashDirection =
        dist(direction, vec()) > 0 ? direction : normalize(this.player.vel);
      this.player.vel.x += dashDirection.x * this.player.dashImpulse;
      this.player.vel.y += dashDirection.y * this.player.dashImpulse;
      this.player.dashImpulse = 0;
      this.shake = Math.max(this.shake, 0.18);
    }

    this.player.pos.x = clamp(
      this.player.pos.x + this.player.vel.x * delta,
      0.8,
      WORLD_SIZE - 0.8,
    );
    this.player.pos.y = clamp(
      this.player.pos.y + this.player.vel.y * delta,
      0.8,
      WORLD_SIZE - 0.8,
    );
  }

  private detectKnotAfterChain() {
    if (this.knot.mode !== "idle" || this.knotCooldown > 0) {
      return;
    }

    const selfKnot = detectSelfKnot(this.chain, {
      protectedLinks: this.captures === 0 ? 2 : PROTECTED_CHAIN_LINKS,
      minSpan: this.captures === 0 ? 2 : MIN_KNOT_SPAN,
      minArea: this.captures === 0 ? 0.28 : MIN_KNOT_AREA,
      forgiveness: this.captures === 0 ? 1.08 : 0.56,
    });

    if (!selfKnot) {
      return;
    }

    const capturedIds = this.cells
      .filter((cell) => pointInPolygon(cell.pos, selfKnot.polygon))
      .map((cell) => cell.id);
    const includesCutter =
      this.cutter != null && pointInPolygon(this.cutter.pos, selfKnot.polygon);
    this.lastKnotSpan = selfKnot.span;
    this.knot = {
      mode: "capturing",
      polygon: selfKnot.polygon,
      area: selfKnot.area,
      center: selfKnot.center,
      progress: capturedIds.length > 0 || includesCutter ? 0 : 0.72,
      hitStop: this.captureHitStop(
        capturedIds.length + (includesCutter ? 1 : 0),
      ),
      capturedIds,
      includesCutter,
    };
    this.candidate = null;
    this.knotCooldown = KNOT_COOLDOWN_SECONDS;
    this.player.vel.x *= 0.38;
    this.player.vel.y *= 0.38;
    this.shake = Math.max(
      this.shake,
      capturedIds.length > 1 || includesCutter ? 0.28 : 0.1,
    );
    this.audio.tone(
      capturedIds.length > 0 || includesCutter ? "close" : "dash",
    );
  }

  private updateKnotCandidate(delta: number) {
    if (this.knot.mode !== "idle" || this.knotCooldown > 0) {
      this.candidate = null;
      return;
    }

    const candidate = detectKnotCandidate(this.chain, {
      protectedLinks: this.captures === 0 ? 2 : PROTECTED_CHAIN_LINKS,
      minSpan: this.captures === 0 ? 2 : MIN_KNOT_SPAN,
      minArea: this.captures === 0 ? 0.24 : MIN_KNOT_AREA,
      forgiveness: this.captures === 0 ? 1.32 : 0.78,
    });

    if (!candidate) {
      this.candidate = null;
      return;
    }

    const cellIds = this.cells
      .filter((cell) => pointInPolygon(cell.pos, candidate.polygon))
      .map((cell) => cell.id);
    this.candidate = {
      targetIndex: candidate.crossedIndex,
      point: candidate.intersection,
      polygon: candidate.polygon,
      center: candidate.center,
      area: candidate.area,
      cellIds,
      pulse: (this.candidate?.pulse ?? 0) + delta * 5,
    };

    if (this.simulationStep % 18 === 0) {
      this.audio.tone("tension");
    }
  }

  private updateKnotCapture(delta: number) {
    if (this.knot.mode !== "capturing") {
      return;
    }

    if (this.knot.hitStop > 0) {
      this.knot.hitStop = Math.max(0, this.knot.hitStop - delta);
      return;
    }

    this.knot.progress = clamp(
      this.knot.progress + delta / KNOT_CAPTURE_SECONDS,
      0,
      1,
    );
    this.pullCellsIntoKnot(delta);

    if (this.knot.progress >= 1) {
      this.finishKnotCapture();
    }
  }

  private pullCellsIntoKnot(delta: number) {
    if (this.knot.mode !== "capturing") {
      return;
    }

    for (const cell of this.cells) {
      if (!this.knot.capturedIds.includes(cell.id)) {
        continue;
      }

      const towardCenter = normalize({
        x: this.knot.center.x - cell.pos.x,
        y: this.knot.center.y - cell.pos.y,
      });
      cell.vel.x += towardCenter.x * delta * 12;
      cell.vel.y += towardCenter.y * delta * 12;
    }

    if (this.cutter && this.knot.includesCutter) {
      const towardCenter = normalize({
        x: this.knot.center.x - this.cutter.pos.x,
        y: this.knot.center.y - this.cutter.pos.y,
      });
      this.cutter.vel.x += towardCenter.x * delta * 10;
      this.cutter.vel.y += towardCenter.y * delta * 10;
    }
  }

  private finishKnotCapture() {
    if (this.knot.mode !== "capturing") {
      return;
    }

    const captured = this.cells.filter((cell) =>
      this.knot.mode === "capturing"
        ? this.knot.capturedIds.includes(cell.id)
        : false,
    );
    const totalTargets = captured.length + (this.knot.includesCutter ? 1 : 0);

    for (const cell of captured) {
      this.addCapturedLink(cell.type);
      this.spawnBurst(
        cell.pos,
        cell.type === "fever" ? "#b08bff" : "#bffaff",
        captured.length > 1 ? 14 : 8,
      );
    }

    if (this.cutter && this.knot.includesCutter) {
      this.addCapturedLink("fever");
      this.spawnBurst(this.cutter.pos, "#e63848", 18);
      this.cutter = null;
    }

    this.cells = this.cells.filter((cell) => !captured.includes(cell));

    while (this.cells.length < 28) {
      this.spawnCellCluster(this.nextClusterCenter(), 3, false);
    }

    if (totalTargets > 0) {
      this.captures += 1;
      this.largestCapture = Math.max(this.largestCapture, totalTargets);
      this.shake = Math.max(
        this.shake,
        totalTargets >= 4 ? 0.34 : totalTargets > 1 ? 0.26 : 0.12,
      );
      this.chainWave = totalTargets >= 4 ? 1 : Math.max(this.chainWave, 0.45);
      this.audio.tone("capture");
      if (totalTargets >= 4) {
        this.audio.tone("sever");
      } else if (totalTargets >= 2) {
        this.audio.tone("close");
      }
      useGameUiStore.getState().setToast(this.captureMessage(totalTargets));
    } else {
      this.shake = Math.max(this.shake, 0.08);
      this.audio.tone("dash");
    }

    this.knot = { mode: "idle" };
    this.candidate = null;
    useGameUiStore.getState().setPrompt(strings.prompts.free);

    if (this.captures === 1) {
      for (const cell of this.cells) {
        cell.highlighted = false;
      }
    }
  }

  private captureMessage(totalTargets: number) {
    if (totalTargets >= 4) {
      return `MASS KNOT x${totalTargets}`;
    }

    if (totalTargets >= 2) {
      return `KNOT x${totalTargets}`;
    }

    return "BOUND";
  }

  private captureHitStop(totalTargets: number) {
    if (totalTargets >= 4) {
      return 0.14;
    }

    if (totalTargets >= 2) {
      return 0.115;
    }

    return totalTargets > 0 ? KNOT_HITSTOP_SECONDS : 0;
  }

  private addCapturedLink(type: CellType) {
    const previous = this.chain[this.chain.length - 1];
    const kind: LinkKind = type;
    const mass = type === "platelet" ? 1.45 : type === "fever" ? 0.75 : 1;
    const pos = {
      x: previous.pos.x - CHAIN_SEGMENT_LENGTH,
      y: previous.pos.y + (Math.random() - 0.5) * 0.2,
    };
    this.chain.push({
      pos,
      prev: { ...pos },
      kind,
      mass,
      dead: false,
    });
  }

  private updateCells(delta: number) {
    for (const cell of this.cells) {
      cell.phase += delta * (cell.type === "fever" ? 4.2 : 1.2);

      if (this.phase === "playing" || this.phase === "observer") {
        if (cell.type === "hunter") {
          const direction = normalize({
            x: this.player.pos.x - cell.pos.x,
            y: this.player.pos.y - cell.pos.y,
          });
          cell.vel.x += direction.x * delta * 1.5;
          cell.vel.y += direction.y * delta * 1.5;
        } else if (cell.type === "platelet") {
          cell.vel.x += Math.sin(cell.phase * 0.8) * delta * 0.18;
          cell.vel.y += Math.cos(cell.phase * 0.7) * delta * 0.18;
        } else {
          cell.vel.x += Math.sin(cell.phase * 2.7 + cell.id) * delta * 2.5;
          cell.vel.y += Math.cos(cell.phase * 2.1 + cell.id) * delta * 2.5;
        }
      }

      cell.vel.x *= 0.985;
      cell.vel.y *= 0.985;
      cell.pos.x = clamp(
        cell.pos.x + cell.vel.x * delta,
        0.8,
        WORLD_SIZE - 0.8,
      );
      cell.pos.y = clamp(
        cell.pos.y + cell.vel.y * delta,
        0.8,
        WORLD_SIZE - 0.8,
      );
    }
  }

  private updateChain(delta: number) {
    if (this.chain.length < 2) {
      return;
    }

    this.chain[0].pos = { ...this.player.pos };
    this.chain[0].prev = { ...this.player.prev };

    for (let index = 1; index < this.chain.length; index += 1) {
      const link = this.chain[index];
      const velocity = {
        x: (link.pos.x - link.prev.x) * 0.984,
        y: (link.pos.y - link.prev.y) * 0.984,
      };
      link.prev = { ...link.pos };
      link.pos.x = clamp(link.pos.x + velocity.x, 0.5, WORLD_SIZE - 0.5);
      link.pos.y = clamp(link.pos.y + velocity.y, 0.5, WORLD_SIZE - 0.5);
    }

    for (let iteration = 0; iteration < 8; iteration += 1) {
      this.chain[0].pos = { ...this.player.pos };

      for (let index = 1; index < this.chain.length; index += 1) {
        const previous = this.chain[index - 1];
        const current = this.chain[index];
        const deltaPosition = {
          x: current.pos.x - previous.pos.x,
          y: current.pos.y - previous.pos.y,
        };
        const distance = Math.max(
          0.0001,
          Math.hypot(deltaPosition.x, deltaPosition.y),
        );
        const difference = (distance - CHAIN_SEGMENT_LENGTH) / distance;
        const previousWeight = index === 1 ? 0 : 0.5 / previous.mass;
        const currentWeight = 0.5 / current.mass;
        previous.pos.x += deltaPosition.x * difference * previousWeight;
        previous.pos.y += deltaPosition.y * difference * previousWeight;
        current.pos.x -= deltaPosition.x * difference * currentWeight;
        current.pos.y -= deltaPosition.y * difference * currentWeight;
      }
    }

    for (const link of this.severed) {
      const velocity = {
        x: (link.pos.x - link.prev.x) * 0.95,
        y: (link.pos.y - link.prev.y) * 0.95 + delta * 0.22,
      };
      link.prev = { ...link.pos };
      link.pos.x = clamp(link.pos.x + velocity.x, 0.5, WORLD_SIZE - 0.5);
      link.pos.y = clamp(link.pos.y + velocity.y, 0.5, WORLD_SIZE - 0.5);
    }
  }

  private spawnCutter() {
    const target = findValidCutterTarget(this.chain);

    if (!target) {
      return;
    }

    this.cutter = {
      pos: {
        x: clamp(target.point.x - 1.5, 0.8, WORLD_SIZE - 0.8),
        y: clamp(target.point.y + 0.8, 0.8, WORLD_SIZE - 0.8),
      },
      vel: vec(),
      cooldown: 0.6,
      alive: true,
      target,
      telegraph: 0,
    };
  }

  private updateCutter(delta: number) {
    if (!this.cutter) {
      return;
    }

    if (!canCutterThreaten(this.chain)) {
      this.cutter.target = null;
      this.cutter.telegraph = 0;
      return;
    }

    if (this.cutter.cooldown > 0) {
      this.cutter.cooldown = Math.max(0, this.cutter.cooldown - delta);
      this.cutter.target = null;
      this.cutter.telegraph = 0;
      return;
    }

    const preferredTargetIndex = this.cutter.target?.index;

    if (!isCutterTargetValid(this.chain, this.cutter.target)) {
      this.cutter.target = findValidCutterTarget(
        this.chain,
        preferredTargetIndex,
      );
      this.cutter.telegraph = 0;
    } else {
      this.cutter.target = findValidCutterTarget(
        this.chain,
        this.cutter.target.index,
      );
    }

    const target = this.cutter.target;

    if (!isCutterTargetValid(this.chain, target)) {
      return;
    }

    this.cutter.telegraph += delta;
    const direction = normalize({
      x: target.point.x - this.cutter.pos.x,
      y: target.point.y - this.cutter.pos.y,
    });
    this.cutter.vel.x += direction.x * delta * 4.6;
    this.cutter.vel.y += direction.y * delta * 4.6;
    this.cutter.vel.x *= 0.96;
    this.cutter.vel.y *= 0.96;
    this.cutter.pos.x = clamp(
      this.cutter.pos.x + this.cutter.vel.x * delta,
      0.4,
      WORLD_SIZE - 0.4,
    );
    this.cutter.pos.y = clamp(
      this.cutter.pos.y + this.cutter.vel.y * delta,
      0.4,
      WORLD_SIZE - 0.4,
    );
    if (
      cutterTelegraphReady(this.cutter.telegraph) &&
      dist(this.cutter.pos, target.point) < 0.46
    ) {
      this.cutChain(target.index);
    }
  }

  private cutChain(index: number) {
    const { removed, cutPoint } = applySafeCut(this.chain, index, 3);

    if (removed.length === 0 || !cutPoint) {
      if (this.cutter) {
        const reset = resetCutterTelegraph();
        this.cutter.cooldown = reset.cooldown;
        this.cutter.target = reset.target;
        this.cutter.telegraph = reset.telegraph;
      }

      return;
    }

    for (const link of removed) {
      link.dead = true;
      link.prev = {
        x: link.pos.x + (Math.random() - 0.5) * 0.24,
        y: link.pos.y + (Math.random() - 0.5) * 0.24,
      };
    }

    this.severed.push(...removed);
    this.scars.push({
      pos: { ...cutPoint },
      radius: 0.9,
      life: 6,
      maxLife: 6,
    });
    this.knot = { mode: "idle" };
    this.audio.tone("sever");
    this.shake = Math.max(this.shake, 0.42);
    useGameUiStore.getState().setToast(`CHAIN SEVERED -${removed.length}`);

    if (this.cutter) {
      const reset = resetCutterTelegraph();
      this.cutter.cooldown = reset.cooldown;
      this.cutter.target = reset.target;
      this.cutter.telegraph = reset.telegraph;
    }
  }

  private resolveObserverAttack(attack: ObserverAttack) {
    const worldPoint = this.renderer.screenToWorld(attack.pos);
    const hitPlayer = dist(worldPoint, this.player.pos) < 1.45;
    const hitChain = this.chain.some(
      (link) => dist(worldPoint, link.pos) < 0.85,
    );

    if (hitPlayer || hitChain) {
      this.spawnBurst(worldPoint, "#e63848", 18);
      this.audio.tone("sever");
      this.shake = Math.max(this.shake, 0.38);
    }
  }

  private updateParticles(delta: number) {
    for (const particle of this.particles) {
      particle.pos.x += particle.vel.x * delta;
      particle.pos.y += particle.vel.y * delta;
      particle.vel.x *= 0.95;
      particle.vel.y *= 0.95;
      particle.life -= delta;
    }

    this.particles = this.particles.filter((particle) => particle.life > 0);

    for (const scar of this.scars) {
      scar.life -= delta;
    }

    this.scars = this.scars.filter((scar) => scar.life > 0);
  }

  private spawnBurst(point: Vec2, color: string, count: number) {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3.4;
      this.particles.push({
        pos: { ...point },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        life: 0.55 + Math.random() * 0.3,
        maxLife: 0.85,
        color,
      });
    }
  }

  private triggerRevelation() {
    if (this.phase !== "playing") {
      return;
    }

    this.phase = "reveal";
    this.phaseStartedAt = performance.now() / 1000;
    this.revealStage = -1;
    this.knot = { mode: "idle" };
    this.candidate = null;
    this.audio.fadeForReveal();
    this.audio.tone("reveal");
    this.updateTitle("DON'T MOVE");
    const store = useGameUiStore.getState();
    store.setPhase("reveal");
    store.setSettingsVisible(false);
    store.setCaption("");
    store.setRevealMenu({
      title: strings.paused,
      resume: strings.resume,
      quit: strings.quit,
    });
  }

  private beginObserver() {
    this.phase = "observer";
    this.phaseStartedAt = performance.now() / 1000;
    this.observerAttacks = [];
    this.attackTimer = 0.6;
    this.audio.restoreAfterReveal();
    this.audio.setObserverMode(true);
    this.updateTitle("YOU ARE THE PARASITE");
    const store = useGameUiStore.getState();
    store.setPhase("observer");
    store.setCaption("");
    store.setPrompt("");
  }

  private endSlice() {
    this.phase = "ending";
    this.audio.setObserverMode(false);
    this.updateTitle("THE HOST REMEMBERS YOUR HAND");
    const store = useGameUiStore.getState();
    store.setPhase("ending");
    store.setCaption(`${strings.endingA}\n${strings.endingB}`);
    this.audio.playVoice("back_again");
  }

  private updateDebug() {
    if (!isDevelopment || !useGameUiStore.getState().debugVisible) {
      return;
    }

    const polygon = this.knot.mode === "capturing" ? this.knot.polygon : [];

    useGameUiStore.getState().setDebug({
      fps: this.fps,
      step: this.simulationStep,
      chainLinks: this.chain.length,
      knotSpan: this.lastKnotSpan,
      knotArea: this.knot.mode === "capturing" ? this.knot.area : 0,
      cellsInside: polygon.length
        ? this.cells.filter((cell) => pointInPolygon(cell.pos, polygon)).length
        : 0,
      cutterTarget: this.cutter?.target
        ? String(this.cutter.target.index)
        : "none",
      phase: this.phase,
    });
  }

  private render(now: number) {
    const settings = useGameUiStore.getState().settings;
    this.renderer.render({
      phase: this.phase,
      time: now - this.phaseStartedAt,
      player: this.player,
      chain: this.chain,
      severed: this.severed,
      cells: this.cells,
      scars: this.scars,
      particles: this.particles,
      cutter: this.cutter,
      knot: this.knot,
      candidate: this.candidate,
      chainWave: this.chainWave,
      observerAttacks: this.observerAttacks,
      mouseScreen: this.input.mouseScreen,
      ghostRoute: this.captures === 0 ? this.ghostRoute : [],
      shake: settings.screenShake ? this.shake : 0,
      highContrast: settings.highContrast,
      reducedMotion: settings.reducedMotion,
    });
  }

  private updateTitle(title: string) {
    document.title = title;
  }

  private completeSafeSampleCapture() {
    if (this.phase !== "playing") {
      return;
    }

    const center = { ...this.player.pos };
    const polygon: Vec2[] = [];

    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2;
      polygon.push({
        x: clamp(center.x + Math.cos(angle) * 2.2, 1, WORLD_SIZE - 1),
        y: clamp(center.y + Math.sin(angle) * 1.8, 1, WORLD_SIZE - 1),
      });
    }

    this.knot = {
      mode: "capturing",
      polygon,
      area: polygonArea(polygon),
      center: polygonCentroid(polygon),
      progress: 0.98,
      hitStop: 0,
      capturedIds: this.cells
        .filter((cell) => pointInPolygon(cell.pos, polygon))
        .map((cell) => cell.id),
      includesCutter:
        this.cutter != null && pointInPolygon(this.cutter.pos, polygon),
    };
    this.finishKnotCapture();
  }

  private installEvents() {
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("mousemove", this.handlePointerMove);
    window.addEventListener("mousedown", this.handlePointerDown);
    window.addEventListener("mouseup", this.handlePointerUp);
    window.addEventListener("contextmenu", this.handleContextMenu);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  private handleResize = () => {
    this.renderer.resize();
    this.input.mouseWorld = this.renderer.screenToWorld(this.input.mouseScreen);
  };

  private handlePointerMove = (event: MouseEvent) => {
    this.input.mouseScreen = { x: event.clientX, y: event.clientY };
    this.input.mouseWorld = this.renderer.screenToWorld(this.input.mouseScreen);
  };

  private handlePointerDown = (event: MouseEvent) => {
    event.preventDefault();
  };

  private handlePointerUp = (event: MouseEvent) => {
    event.preventDefault();
  };

  private handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    this.input.keys.add(key);
    this.applyMovementTapImpulse(key);

    if (key === " " && this.player.dashCooldown <= 0 && this.phase !== "menu") {
      this.player.dashImpulse = 5.1;
      this.player.dashCooldown = 0.66;
      this.audio.tone("dash");
    }

    if (isDevelopment && key === "r") {
      this.triggerRevelation();
    }

    if (isDevelopment && event.key === "D") {
      useGameUiStore.getState().toggleDebug();
    }

    if (isDevelopment && key === "n") {
      this.spawnCutter();
    }

    if (isDevelopment && key === "c") {
      this.completeSafeSampleCapture();
    }
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    this.input.keys.delete(event.key.toLowerCase());
  };

  private applyMovementTapImpulse(key: string) {
    if (this.phase !== "playing" && this.phase !== "observer") {
      return;
    }

    const direction =
      key === "a" || key === "arrowleft"
        ? { x: -1, y: 0 }
        : key === "d" || key === "arrowright"
          ? { x: 1, y: 0 }
          : key === "w" || key === "arrowup"
            ? { x: 0, y: -1 }
            : key === "s" || key === "arrowdown"
              ? { x: 0, y: 1 }
              : null;

    if (!direction) {
      return;
    }

    this.player.vel.x += direction.x * 0.9;
    this.player.vel.y += direction.y * 0.9;
  }
}
