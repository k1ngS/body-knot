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
import {
  detectKnotCandidate,
  detectSelfKnot,
  type SelfKnot,
} from "../systems/knotDetection";
import {
  CHAIN_SEGMENT_LENGTH,
  CUTTER_MIN_SECONDS,
  FINAL_INTEGRITY,
  FINAL_ONBOARDING_SECONDS,
  FIXED_TIMESTEP,
  FOCUS_ATTRACTION,
  FOCUS_RADIUS,
  INITIAL_LINKS,
  KNOT_CAPTURE_SECONDS,
  KNOT_COOLDOWN_SECONDS,
  KNOT_HITSTOP_SECONDS,
  MIN_KNOT_SPAN,
  OBSERVER_ATTACK_MAX_SECONDS,
  OBSERVER_ATTACK_MIN_SECONDS,
  OBSERVER_ATTACK_TELEGRAPH_SECONDS,
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
  FocusState,
  HostCore,
  KnotCandidate,
  KnotState,
  LinkKind,
  ObserverAttack,
  Particle,
  Player,
  Scar,
} from "./types";

type RuntimePhase =
  | "menu"
  | "playing"
  | "paused"
  | "reveal"
  | "observer"
  | "ending";

type InputState = {
  keys: Set<string>;
  mouseScreen: Vec2;
  mouseWorld: Vec2;
  pointerInside: boolean;
};

type EndingOutcome = "victory" | "failure" | null;

const isDevelopment = process.env.NODE_ENV !== "production";
const TUTORIAL_TARGET_INDEX = 5;
const FOCUS_DEMO_SECONDS = 1.5;
const REVEAL_SEQUENCE_READY_SECONDS = 8.2;
const HOST_CORE_RADIUS = 1.92;
const FINAL_ROUTE_ANGLE_REQUIRED = Math.PI * 1.5;

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
  private observerIntroElapsed = 0;
  private finalIntegrity = FINAL_INTEGRITY;
  private revealReady = false;
  private finalCoreAngularTravel = 0;
  private finalCoreRouteLength = 0;
  private finalCoreLastAngle: number | null = null;
  private finalCoreLastPlayerPos: Vec2 = vec();
  private finalStartPlayerPos: Vec2 = vec();
  private finalStartChain: Vec2[] = [];
  private endingOutcome: EndingOutcome = null;
  private firstCutterQueued = false;
  private knotCooldown = 0;
  private lastKnotSpan = 0;
  private largestCapture = 0;
  private candidate: KnotCandidate | null = null;
  private chainWave = 0;
  private focusInfluencedIds: number[] = [];
  private focusPulse = 0;
  private focusPromptPending = false;
  private focusInstructionCleared = false;
  private tutorialActive = true;
  private tutorialRouteProgress = 0;
  private focusDemoTimer = 0;
  private input: InputState = {
    keys: new Set(),
    mouseScreen: { x: 0, y: 0 },
    mouseWorld: { x: 16, y: 16 },
    pointerInside: false,
  };
  private player: Player = this.createPlayer();
  private chain: ChainLink[] = [];
  private severed: ChainLink[] = [];
  private cells: Cell[] = [];
  private scars: Scar[] = [];
  private particles: Particle[] = [];
  private observerAttacks: ObserverAttack[] = [];
  private cutter: Cutter | null = null;
  private hostCore: HostCore | null = null;
  private knot: KnotState = { mode: "idle" };
  private ghostRoute: Vec2[] = [
    { x: 16.5, y: 19.2 },
    { x: 18.0, y: 19.45 },
    { x: 18.25, y: 20.85 },
    { x: 16.75, y: 21.35 },
    { x: 15.35, y: 20.55 },
    { x: 15.2, y: 19.1 },
    { x: 16.85, y: 18.45 },
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
    window.removeEventListener("mouseleave", this.handlePointerLeave);
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

  resume() {
    if (this.phase !== "paused") {
      return;
    }

    this.phase = "playing";
    useGameUiStore.getState().setSettingsVisible(false);
    useGameUiStore.getState().setPhase("playing");
    this.updateTitle("BODY//KNOT");
  }

  private pause() {
    if (this.phase !== "playing") {
      return;
    }

    this.phase = "paused";
    this.candidate = null;
    this.focusInfluencedIds = [];
    const store = useGameUiStore.getState();
    store.setSettingsVisible(false);
    store.setPhase("paused");
    store.setPrompt("");
  }

  runFromRevelation() {
    if (this.phase !== "reveal" || !this.revealReady) {
      return;
    }

    this.beginObserver();
  }

  quitResponse() {
    if (this.phase !== "reveal" || !this.revealReady) {
      return;
    }

    this.audio.playVoice("let_me_out");
    useGameUiStore.getState().setRevealMenu({
      title: strings.pointer,
      resume: strings.run,
      quit: "GET OUT",
      enabled: true,
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
    this.hostCore = null;
    this.knot = { mode: "idle" };
    this.captures = 0;
    this.cellId = 1;
    this.gameplayElapsed = 0;
    this.firstCutterQueued = false;
    this.revealStage = -1;
    this.revealReady = false;
    this.attackTimer = 0;
    this.observerIntroElapsed = 0;
    this.finalIntegrity = FINAL_INTEGRITY;
    this.finalCoreAngularTravel = 0;
    this.finalCoreRouteLength = 0;
    this.finalCoreLastAngle = null;
    this.finalCoreLastPlayerPos = { ...this.player.pos };
    this.finalStartPlayerPos = { ...this.player.pos };
    this.finalStartChain = [];
    this.endingOutcome = null;
    this.knotCooldown = 0;
    this.lastKnotSpan = 0;
    this.largestCapture = 0;
    this.candidate = null;
    this.chainWave = 0;
    this.focusInfluencedIds = [];
    this.focusPulse = 0;
    this.focusPromptPending = false;
    this.focusInstructionCleared = false;
    this.tutorialActive = true;
    this.tutorialRouteProgress = 0;
    this.focusDemoTimer = 0;
    this.shake = 0;
    this.simulationStep = 0;

    this.createTutorialChain();
    this.spawnTutorialCells();
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

  private createTutorialChain() {
    const positions: Vec2[] = [
      this.player.pos,
      { x: 15.98, y: 19.08 },
      { x: 15.46, y: 18.85 },
      { x: 15.5, y: 18.35 },
      { x: 16.06, y: 18.12 },
      { x: 16.67, y: 18.14 },
      { x: 17.2, y: 18.43 },
      { x: 17.56, y: 18.9 },
      { x: 17.46, y: 19.42 },
      { x: 16.96, y: 19.72 },
      { x: 16.37, y: 19.66 },
      { x: 15.86, y: 19.36 },
    ];

    for (let index = positions.length; index < INITIAL_LINKS; index += 1) {
      const last = positions[index - 1];
      positions.push({
        x: last.x - CHAIN_SEGMENT_LENGTH,
        y: last.y + Math.sin(index * 0.74) * 0.08,
      });
    }

    for (const pos of positions) {
      this.chain.push({
        pos: { ...pos },
        prev: { ...pos },
        kind: "starter",
        mass: 1,
        dead: false,
      });
    }
  }

  private spawnTutorialCells() {
    const guided: Array<[CellType, number, number]> = [
      ["hunter", 16.55, 20.05],
      ["platelet", 17.14, 20.22],
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
        tutorial: true,
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
      const radius =
        this.gameplayElapsed < 45
          ? 0.95 + Math.random() * 1.35
          : 0.5 + Math.random() * 1.45;
      const cell = this.createRandomCell(highlighted);
      const proposed = {
        x: clamp(center.x + Math.cos(angle) * radius, 1.4, WORLD_SIZE - 1.4),
        y: clamp(center.y + Math.sin(angle) * radius, 1.4, WORLD_SIZE - 1.4),
      };
      cell.pos = this.separateSpawnPosition(proposed);

      this.cells.push(cell);
    }
  }

  private separateSpawnPosition(position: Vec2) {
    let result = { ...position };
    const minPlayerDistance = this.gameplayElapsed < 45 ? 4.2 : 2.6;
    const minCellDistance = this.gameplayElapsed < 45 ? 1.25 : 0.82;

    for (let iteration = 0; iteration < 5; iteration += 1) {
      if (dist(result, this.player.pos) < minPlayerDistance) {
        const away = normalize({
          x: result.x - this.player.pos.x,
          y: result.y - this.player.pos.y,
        });
        result = {
          x: clamp(
            this.player.pos.x + away.x * minPlayerDistance,
            1.4,
            WORLD_SIZE - 1.4,
          ),
          y: clamp(
            this.player.pos.y + away.y * minPlayerDistance,
            1.4,
            WORLD_SIZE - 1.4,
          ),
        };
      }

      const nearest = this.cells.find(
        (cell) => dist(cell.pos, result) < minCellDistance,
      );

      if (!nearest) {
        break;
      }

      const away = normalize({
        x: result.x - nearest.pos.x,
        y: result.y - nearest.pos.y,
      });
      result = {
        x: clamp(
          nearest.pos.x + away.x * minCellDistance,
          1.4,
          WORLD_SIZE - 1.4,
        ),
        y: clamp(
          nearest.pos.y + away.y * minCellDistance,
          1.4,
          WORLD_SIZE - 1.4,
        ),
      };
    }

    return result;
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
      (this.phase === "playing" || this.phase === "observer") &&
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

    const finalIntroPaused =
      this.phase === "observer" &&
      this.observerIntroElapsed < FINAL_ONBOARDING_SECONDS;

    if (!frozen && !finalIntroPaused) {
      this.updateCells(delta);
      this.updateChain(delta);

      if (
        this.phase === "playing" ||
        (this.phase === "observer" &&
          this.observerIntroElapsed >= FINAL_ONBOARDING_SECONDS &&
          this.hostCore?.state !== "binding")
      ) {
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
      this.updateTutorialRouteProgress();
    }

    this.updateFocus(delta);

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

    if (
      this.focusDemoTimer > 0 ||
      (this.focusPromptPending && !this.focusInstructionCleared)
    ) {
      store.setPrompt(strings.prompts.focus);
    } else if (this.captures === 0 && elapsed < 2.7) {
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

  private updateFocus(delta: number) {
    this.focusPulse += delta * 4;
    this.focusDemoTimer = Math.max(0, this.focusDemoTimer - delta);
    this.focusInfluencedIds = [];

    if (!this.isFocusActive()) {
      return;
    }

    const candidates = this.cells
      .map((cell) => ({
        cell,
        distance: dist(cell.pos, this.input.mouseWorld),
      }))
      .filter(({ distance }) => distance <= FOCUS_RADIUS)
      .sort((a, b) => a.distance - b.distance);

    for (const [index, { cell, distance }] of candidates.entries()) {
      const strength = clamp(1 - distance / FOCUS_RADIUS, 0, 1);
      const towardFocus = normalize({
        x: this.input.mouseWorld.x - cell.pos.x,
        y: this.input.mouseWorld.y - cell.pos.y,
      });
      const weight =
        cell.type === "platelet" ? 0.82 : cell.type === "fever" ? 0.62 : 0.72;
      const crowding = index < 4 ? 1 : 0.24 / (index - 2);
      const demo = this.focusDemoTimer > 0 && index < 2 ? 1.35 : 1;
      cell.vel.x +=
        towardFocus.x *
        FOCUS_ATTRACTION *
        strength *
        weight *
        crowding *
        demo *
        delta;
      cell.vel.y +=
        towardFocus.y *
        FOCUS_ATTRACTION *
        strength *
        weight *
        crowding *
        demo *
        delta;
      this.focusInfluencedIds.push(cell.id);
    }

    if (this.focusPromptPending && this.focusInfluencedIds.length >= 2) {
      this.focusInstructionCleared = true;
      this.focusPromptPending = false;
    }
  }

  private isFocusActive() {
    return (
      this.phase === "playing" &&
      !this.tutorialActive &&
      this.input.pointerInside &&
      !useGameUiStore.getState().settingsVisible
    );
  }

  private updateObserver(delta: number, now: number) {
    const elapsed = now - this.phaseStartedAt;
    const activeElapsed = Math.max(0, elapsed - FINAL_ONBOARDING_SECONDS);
    this.observerIntroElapsed += delta;
    if (this.hostCore) {
      this.hostCore.pulse += delta * 3;
    }
    useGameUiStore.getState().setClock(
      `00:${Math.max(0, Math.ceil(OBSERVER_DURATION - activeElapsed))
        .toString()
        .padStart(2, "0")}`,
    );

    const core = this.hostCore;
    if (core?.state === "binding") {
      this.updateCoreBinding(delta);
      return;
    }

    if (this.knot.mode === "capturing") {
      this.updateKnotCapture(delta);
    } else if (this.observerIntroElapsed >= FINAL_ONBOARDING_SECONDS) {
      this.updatePlayer(delta, 24.5, 5.05);
      this.updateFinalCoreRoute();
    } else {
      this.finalCoreLastPlayerPos = { ...this.player.pos };
      this.finalCoreLastAngle = null;
    }

    this.updateFinalPrompt();
    this.attackTimer -= delta;

    if (
      this.attackTimer <= 0 &&
      this.observerIntroElapsed >= FINAL_ONBOARDING_SECONDS
    ) {
      this.attackTimer =
        OBSERVER_ATTACK_MIN_SECONDS +
        Math.random() *
          (OBSERVER_ATTACK_MAX_SECONDS - OBSERVER_ATTACK_MIN_SECONDS);
      this.observerAttacks.push({
        pos: { ...this.input.mouseScreen },
        life: OBSERVER_ATTACK_TELEGRAPH_SECONDS + 0.28,
        maxLife: OBSERVER_ATTACK_TELEGRAPH_SECONDS + 0.28,
        telegraph: OBSERVER_ATTACK_TELEGRAPH_SECONDS,
        radius: 28,
        hit: false,
        demo: false,
      });
      this.audio.tone("observer");
    }

    this.updateObserverDemoAttack();

    for (const attack of this.observerAttacks) {
      attack.life -= delta;

      if (
        !attack.demo &&
        !attack.hit &&
        attack.life <= attack.maxLife - attack.telegraph
      ) {
        attack.hit = true;
        this.resolveObserverAttack(attack);
      }
    }

    this.observerAttacks = this.observerAttacks.filter(
      (attack) => attack.life > 0,
    );

    if (activeElapsed >= OBSERVER_DURATION) {
      this.endFailure();
    } else if (!this.canCreateFinalKnot()) {
      this.endFailure();
    }
  }

  private updateFinalPrompt() {
    if (this.observerIntroElapsed < 1.35) {
      useGameUiStore.getState().setPrompt(strings.prompts.finalA);
    } else if (this.observerIntroElapsed < 2.7) {
      useGameUiStore.getState().setPrompt(strings.prompts.finalB);
    } else if (this.observerIntroElapsed < FINAL_ONBOARDING_SECONDS) {
      useGameUiStore.getState().setPrompt(strings.prompts.finalC);
    } else if (this.observerIntroElapsed < FINAL_ONBOARDING_SECONDS + 1.5) {
      useGameUiStore.getState().setPrompt(strings.prompts.finalMove);
    } else {
      useGameUiStore.getState().setPrompt("");
    }
  }

  private updateObserverDemoAttack() {
    if (
      this.observerIntroElapsed < 1.42 ||
      this.observerIntroElapsed > 2.85 ||
      this.observerAttacks.some((attack) => attack.demo)
    ) {
      return;
    }

    this.observerAttacks.push({
      pos: { ...this.input.mouseScreen },
      life: 1.28,
      maxLife: 1.28,
      telegraph: 1.08,
      radius: 30,
      hit: false,
      demo: true,
    });
  }

  private updateCoreBinding(delta: number) {
    if (!this.hostCore || this.hostCore.state !== "binding") {
      return;
    }

    this.hostCore.bindProgress = clamp(
      this.hostCore.bindProgress + delta / 1.35,
      0,
      1,
    );
    this.chainWave = 1;
    this.shake = Math.max(this.shake, 0.16);

    if (this.hostCore.bindProgress >= 1) {
      this.hostCore.state = "bound";
      this.endVictory();
    }
  }

  private canCreateFinalKnot() {
    return this.chain.length >= PROTECTED_CHAIN_LINKS + MIN_KNOT_SPAN + 3;
  }

  private coreInsidePolygon(polygon: Vec2[]) {
    if (this.phase !== "observer" || this.hostCore?.state !== "dormant") {
      return false;
    }

    if (pointInPolygon(this.hostCore.pos, polygon)) {
      return true;
    }

    let containedSamples = 0;

    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const sample = {
        x: this.hostCore.pos.x + Math.cos(angle) * this.hostCore.radius * 0.62,
        y: this.hostCore.pos.y + Math.sin(angle) * this.hostCore.radius * 0.62,
      };

      if (pointInPolygon(sample, polygon)) {
        containedSamples += 1;
      }
    }

    return containedSamples >= 5;
  }

  private isValidFinalCoreKnot(selfKnot: SelfKnot) {
    const core = this.hostCore;

    if (
      this.phase !== "observer" ||
      core?.state !== "dormant" ||
      this.observerIntroElapsed < FINAL_ONBOARDING_SECONDS
    ) {
      return false;
    }

    if (!pointInPolygon(core.pos, selfKnot.polygon)) {
      return false;
    }

    if (!this.hasFinalRouteProgress(selfKnot.area)) {
      return false;
    }

    if (selfKnot.span < MIN_KNOT_SPAN + 1) {
      return false;
    }

    if (
      dist(selfKnot.intersection, this.finalStartPlayerPos) <
      core.radius * 1.6
    ) {
      return false;
    }

    const initialChainDistance = this.nearestFinalStartChainDistance(
      selfKnot.intersection,
    );

    if (
      initialChainDistance < 0.22 &&
      this.finalCoreRouteLength < core.radius * 3.4
    ) {
      return false;
    }

    const crossingDistance = dist(selfKnot.intersection, core.pos);

    if (
      crossingDistance < core.radius * 0.95 ||
      crossingDistance > core.radius * 4.8
    ) {
      return false;
    }

    return true;
  }

  private hasFinalRouteProgress(area: number) {
    const core = this.hostCore;

    if (!core || this.observerIntroElapsed < FINAL_ONBOARDING_SECONDS) {
      return false;
    }

    const minimumArea = Math.max(core.radius * core.radius * 1.85, 6.4);
    const minimumRouteLength = core.radius * 2.7;

    return (
      this.finalCoreAngularTravel >= FINAL_ROUTE_ANGLE_REQUIRED &&
      this.finalCoreRouteLength >= minimumRouteLength &&
      area >= minimumArea &&
      dist(this.player.pos, this.finalStartPlayerPos) >= core.radius * 1.1
    );
  }

  private isTutorialTarget(index: number) {
    return Math.abs(index - TUTORIAL_TARGET_INDEX) <= 1;
  }

  private isCompleteTutorialCapture(capturedIds: number[]) {
    const tutorialIds = this.cells
      .filter((cell) => cell.tutorial)
      .map((cell) => cell.id);

    return (
      tutorialIds.length === 2 &&
      capturedIds.length === 2 &&
      tutorialIds.every((id) => capturedIds.includes(id))
    );
  }

  private updateTutorialRouteProgress() {
    if (!this.tutorialActive) {
      return;
    }

    if (this.player.pos.x > 17.45) {
      this.tutorialRouteProgress |= 1;
    }

    if ((this.tutorialRouteProgress & 1) !== 0 && this.player.pos.y > 20.35) {
      this.tutorialRouteProgress |= 2;
    }

    if ((this.tutorialRouteProgress & 2) !== 0 && this.player.pos.x < 15.95) {
      this.tutorialRouteProgress |= 4;
    }
  }

  private detectTutorialKnot() {
    if (!this.tutorialActive || this.phase !== "playing") {
      return false;
    }

    if ((this.tutorialRouteProgress & 3) !== 3) {
      return false;
    }

    const a = this.chain[TUTORIAL_TARGET_INDEX];
    const b = this.chain[TUTORIAL_TARGET_INDEX + 1];

    if (!a || !b) {
      return false;
    }

    const crossed =
      crossedSegment(this.player.prev, this.player.pos, a.pos, b.pos, 1.05) ??
      this.tutorialNearCrossing(a.pos, b.pos);

    if (!crossed) {
      return false;
    }

    const polygon = this.tutorialPolygon(crossed);
    const capturedIds = this.cells
      .filter((cell) => pointInPolygon(cell.pos, polygon))
      .map((cell) => cell.id);

    if (!this.isCompleteTutorialCapture(capturedIds)) {
      return false;
    }

    this.knot = {
      mode: "capturing",
      polygon,
      area: polygonArea(polygon),
      center: polygonCentroid(polygon),
      progress: 0,
      hitStop: this.captureHitStop(2),
      capturedIds,
      includesCutter: false,
      includesCore: false,
    };
    this.candidate = null;
    this.knotCooldown = KNOT_COOLDOWN_SECONDS;
    this.player.vel.x *= 0.38;
    this.player.vel.y *= 0.38;
    this.shake = Math.max(this.shake, 0.26);
    this.audio.tone("close");

    return true;
  }

  private updateTutorialCandidate(delta: number) {
    if (!this.tutorialActive || this.phase !== "playing") {
      return false;
    }

    const a = this.chain[TUTORIAL_TARGET_INDEX];
    const b = this.chain[TUTORIAL_TARGET_INDEX + 1];

    if (!a || !b) {
      this.candidate = null;
      return true;
    }

    const point = closestPointOnSegment(this.player.pos, a.pos, b.pos);

    if (
      (this.tutorialRouteProgress & 3) !== 3 ||
      dist(this.player.pos, point) > 2.25
    ) {
      this.candidate = null;
      return true;
    }

    const polygon = this.tutorialPolygon(point);
    const cellIds = this.cells
      .filter((cell) => pointInPolygon(cell.pos, polygon))
      .map((cell) => cell.id);
    this.candidate = {
      targetIndex: TUTORIAL_TARGET_INDEX,
      point,
      polygon,
      center: polygonCentroid(polygon),
      area: polygonArea(polygon),
      cellIds,
      previewCount: cellIds.length,
      includesCore: false,
      canBindCore: false,
      tutorial: true,
      pulse: (this.candidate?.pulse ?? 0) + delta * 5,
    };

    return true;
  }

  private tutorialPolygon(crossing: Vec2) {
    return [
      crossing,
      { x: 18.25, y: 19.28 },
      { x: 18.35, y: 20.82 },
      { x: 16.95, y: 21.36 },
      { x: 15.4, y: 20.56 },
      { x: 15.26, y: 19.16 },
    ];
  }

  private tutorialNearCrossing(a: Vec2, b: Vec2) {
    const point = closestPointOnSegment(this.player.pos, a, b);

    if (dist(this.player.pos, point) > 2.25 || this.player.pos.y > 19.95) {
      return null;
    }

    return point;
  }

  private updateFinalCoreRoute() {
    if (
      this.phase !== "observer" ||
      this.hostCore?.state !== "dormant" ||
      this.observerIntroElapsed < FINAL_ONBOARDING_SECONDS
    ) {
      return;
    }

    this.finalCoreRouteLength += dist(
      this.player.pos,
      this.finalCoreLastPlayerPos,
    );
    this.finalCoreLastPlayerPos = { ...this.player.pos };

    const offset = {
      x: this.player.pos.x - this.hostCore.pos.x,
      y: this.player.pos.y - this.hostCore.pos.y,
    };
    const distance = Math.hypot(offset.x, offset.y);

    if (
      distance < this.hostCore.radius * 0.9 ||
      distance > this.hostCore.radius * 3.9
    ) {
      this.finalCoreLastAngle = null;
      return;
    }

    const angle = Math.atan2(offset.y, offset.x);
    if (this.finalCoreLastAngle != null) {
      let deltaAngle = angle - this.finalCoreLastAngle;

      while (deltaAngle > Math.PI) {
        deltaAngle -= Math.PI * 2;
      }

      while (deltaAngle < -Math.PI) {
        deltaAngle += Math.PI * 2;
      }

      if (Math.abs(deltaAngle) < Math.PI * 0.7) {
        this.finalCoreAngularTravel += Math.abs(deltaAngle);
      }
    }

    this.finalCoreLastAngle = angle;
  }

  private updateReveal(now: number) {
    const elapsed = now - this.phaseStartedAt;
    const stages = [
      { at: 0.7, caption: strings.revealLines[0], voice: "i_see_you" },
      { at: 2.55, caption: strings.revealLines[1], voice: "it_moves" },
      { at: 4.45, caption: strings.revealLines[2], voice: "not_the_parasite" },
      { at: 6.35, caption: strings.revealLines[3], voice: "you_are" },
    ] as const;

    for (let index = 0; index < stages.length; index += 1) {
      const stage = stages[index];

      if (elapsed >= stage.at && this.revealStage < index) {
        this.revealStage = index;
        useGameUiStore.getState().setCaption(stage.caption);
        this.audio.playVoice(stage.voice);
        this.audio.tone("reveal");
      }
    }

    if (!this.revealReady && elapsed >= REVEAL_SEQUENCE_READY_SECONDS) {
      this.revealReady = true;
      useGameUiStore.getState().setRevealMenu({
        title: strings.pointer,
        resume: strings.run,
        quit: strings.letMeOut,
        enabled: true,
      });
      this.updateTitle("I SEE YOUR CURSOR");
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

    if (this.detectTutorialKnot()) {
      return;
    }

    const selfKnot = detectSelfKnot(this.chain, {
      protectedLinks:
        this.phase === "observer"
          ? 2
          : this.captures === 0
            ? 2
            : PROTECTED_CHAIN_LINKS,
      minSpan:
        this.phase === "observer" ? 2 : this.captures === 0 ? 2 : MIN_KNOT_SPAN,
      minArea:
        this.phase === "observer" ? 0.54 : this.captures === 0 ? 0.28 : 0.55,
      forgiveness:
        this.phase === "observer" ? 1.55 : this.captures === 0 ? 1.08 : 0.82,
    });

    if (!selfKnot) {
      return;
    }

    const capturedIds = this.cells
      .filter((cell) => pointInPolygon(cell.pos, selfKnot.polygon))
      .map((cell) => cell.id);
    const includesCutter =
      this.cutter != null && pointInPolygon(this.cutter.pos, selfKnot.polygon);
    const includesCore = this.coreInsidePolygon(selfKnot.polygon);

    if (
      this.tutorialActive &&
      (!this.isTutorialTarget(selfKnot.crossedIndex) ||
        !this.isCompleteTutorialCapture(capturedIds))
    ) {
      return;
    }

    if (
      this.phase === "observer" &&
      (!includesCore || !this.isValidFinalCoreKnot(selfKnot))
    ) {
      return;
    }

    this.lastKnotSpan = selfKnot.span;
    this.knot = {
      mode: "capturing",
      polygon: selfKnot.polygon,
      area: selfKnot.area,
      center: selfKnot.center,
      progress:
        capturedIds.length > 0 || includesCutter || includesCore ? 0 : 0.72,
      hitStop: this.captureHitStop(
        capturedIds.length + (includesCutter ? 1 : 0) + (includesCore ? 1 : 0),
      ),
      capturedIds,
      includesCutter,
      includesCore,
    };
    this.candidate = null;
    this.knotCooldown = KNOT_COOLDOWN_SECONDS;
    this.player.vel.x *= 0.38;
    this.player.vel.y *= 0.38;
    this.shake = Math.max(
      this.shake,
      capturedIds.length > 1 || includesCutter || includesCore ? 0.28 : 0.1,
    );
    this.audio.tone(
      capturedIds.length > 0 || includesCutter || includesCore
        ? "close"
        : "dash",
    );
  }

  private updateKnotCandidate(delta: number) {
    if (this.knot.mode !== "idle" || this.knotCooldown > 0) {
      this.candidate = null;
      return;
    }

    if (this.updateTutorialCandidate(delta)) {
      return;
    }

    const candidate = detectKnotCandidate(this.chain, {
      protectedLinks:
        this.phase === "observer"
          ? 2
          : this.captures === 0
            ? 2
            : PROTECTED_CHAIN_LINKS,
      minSpan:
        this.phase === "observer" ? 2 : this.captures === 0 ? 2 : MIN_KNOT_SPAN,
      minArea:
        this.phase === "observer" ? 0.48 : this.captures === 0 ? 0.24 : 0.48,
      forgiveness:
        this.phase === "observer" ? 1.72 : this.captures === 0 ? 1.32 : 1.02,
    });

    if (!candidate) {
      this.candidate = null;
      return;
    }

    const cellIds = this.cells
      .filter((cell) => pointInPolygon(cell.pos, candidate.polygon))
      .map((cell) => cell.id);
    const includesCore = this.coreInsidePolygon(candidate.polygon);

    if (this.tutorialActive && !this.isTutorialTarget(candidate.crossedIndex)) {
      this.candidate = null;
      return;
    }

    if (
      this.phase === "observer" &&
      (!includesCore || !this.hasFinalRouteProgress(candidate.area))
    ) {
      this.candidate = null;
      return;
    }

    this.candidate = {
      targetIndex: candidate.crossedIndex,
      point: candidate.intersection,
      polygon: candidate.polygon,
      center: candidate.center,
      area: candidate.area,
      cellIds,
      previewCount: cellIds.length + (includesCore ? 1 : 0),
      includesCore,
      canBindCore:
        this.phase === "observer" &&
        includesCore &&
        this.isValidFinalCoreKnot(candidate),
      tutorial: this.tutorialActive,
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
    const includesCore = this.knot.includesCore;
    const totalTargets =
      captured.length +
      (this.knot.includesCutter ? 1 : 0) +
      (includesCore ? 1 : 0);

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

    if (includesCore) {
      this.beginCoreBinding();
      return;
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
      this.tutorialActive = false;
      this.focusDemoTimer = FOCUS_DEMO_SECONDS;
      for (const cell of this.cells) {
        cell.highlighted = false;
      }
      this.spawnFocusDemoCells();
      this.focusPromptPending = true;
    }

    this.replenishCells();
  }

  private beginCoreBinding() {
    if (!this.hostCore) {
      return;
    }

    this.hostCore.state = "binding";
    this.hostCore.bindProgress = 0;
    this.observerAttacks = [];
    this.knot = { mode: "idle" };
    this.candidate = null;
    this.audio.tone("capture");
    this.audio.tone("reveal");
    this.chainWave = 1;
    this.shake = Math.max(this.shake, 0.42);
    useGameUiStore.getState().setPrompt("HOST BOUND.");
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

  private replenishCells() {
    const target = this.gameplayElapsed < 45 ? 16 : 28;

    while (this.cells.length < target) {
      const remaining = target - this.cells.length;
      const count =
        this.gameplayElapsed < 45
          ? Math.min(remaining, 2 + ((this.cellId + this.captures) % 3))
          : Math.min(remaining, 3);
      this.spawnCellCluster(this.nextClusterCenter(), count, false);
    }
  }

  private spawnFocusDemoCells() {
    const center = this.input.pointerInside
      ? this.input.mouseWorld
      : {
          x: clamp(this.player.pos.x + 2.6, 2, WORLD_SIZE - 2),
          y: clamp(this.player.pos.y - 0.6, 2, WORLD_SIZE - 2),
        };
    const cells: Array<[CellType, Vec2]> = [
      ["hunter", { x: center.x - 1.15, y: center.y + 0.38 }],
      ["platelet", { x: center.x + 1.05, y: center.y - 0.42 }],
    ];

    for (const [type, pos] of cells) {
      this.cells.push({
        id: this.cellId,
        type,
        pos: this.separateFocusDemoPosition(pos),
        vel: vec(),
        radius: type === "platelet" ? 0.42 : 0.32,
        phase: this.cellId * 1.47,
        highlighted: true,
        captured: false,
      });
      this.cellId += 1;
    }
  }

  private separateFocusDemoPosition(position: Vec2) {
    let result = {
      x: clamp(position.x, 1.4, WORLD_SIZE - 1.4),
      y: clamp(position.y, 1.4, WORLD_SIZE - 1.4),
    };

    for (let iteration = 0; iteration < 3; iteration += 1) {
      const nearest = this.cells.find((cell) => dist(cell.pos, result) < 0.9);

      if (!nearest) {
        break;
      }

      const away = normalize({
        x: result.x - nearest.pos.x,
        y: result.y - nearest.pos.y,
      });
      result = {
        x: clamp(nearest.pos.x + away.x * 0.9, 1.4, WORLD_SIZE - 1.4),
        y: clamp(nearest.pos.y + away.y * 0.9, 1.4, WORLD_SIZE - 1.4),
      };
    }

    return result;
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
    const hitPlayer = dist(worldPoint, this.player.pos) < 1.25;
    const chainHit = this.closestChainHit(worldPoint);

    if (hitPlayer) {
      this.finalIntegrity -= 1;
      this.spawnBurst(worldPoint, "#e63848", 18);
      this.audio.tone("sever");
      this.shake = Math.max(this.shake, 0.38);

      if (this.finalIntegrity <= 0) {
        this.endFailure();
      }

      return;
    }

    if (chainHit != null) {
      this.observerCutChain(chainHit);
      return;
    }

    this.spawnBurst(worldPoint, "#7c1a23", 10);
    this.scars.push({
      pos: worldPoint,
      radius: 0.65,
      life: 2.2,
      maxLife: 2.2,
    });
    this.audio.tone("observer");
  }

  private closestChainHit(point: Vec2) {
    let bestIndex: number | null = null;
    let bestDistance = 0.82;

    for (const [index, link] of this.chain.entries()) {
      const distance = dist(point, link.pos);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  private observerCutChain(index: number) {
    const { removed, cutPoint } = applySafeCut(this.chain, index, 2);

    if (removed.length === 0 || !cutPoint) {
      this.spawnBurst(this.player.pos, "#e63848", 8);
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
      radius: 0.78,
      life: 4.2,
      maxLife: 4.2,
    });
    this.knot = { mode: "idle" };
    this.candidate = null;
    this.audio.tone("sever");
    this.shake = Math.max(this.shake, 0.34);
    useGameUiStore.getState().setToast(`CHAIN SEVERED -${removed.length}`);

    if (!this.canCreateFinalKnot()) {
      this.endFailure();
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
    this.revealReady = false;
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
      enabled: false,
    });
  }

  private beginObserver() {
    this.phase = "observer";
    this.phaseStartedAt = performance.now() / 1000;
    this.observerAttacks = [];
    this.attackTimer = FINAL_ONBOARDING_SECONDS + OBSERVER_ATTACK_MIN_SECONDS;
    this.observerIntroElapsed = 0;
    this.finalIntegrity = FINAL_INTEGRITY;
    this.finalCoreAngularTravel = 0;
    this.finalCoreRouteLength = 0;
    this.finalCoreLastAngle = null;
    this.finalCoreLastPlayerPos = { ...this.player.pos };
    this.finalStartPlayerPos = { ...this.player.pos };
    this.finalStartChain = this.chain.map((link) => ({ ...link.pos }));
    const corePos = this.chooseHostCorePosition();
    this.hostCore = {
      pos: corePos,
      radius: HOST_CORE_RADIUS,
      pulse: 0,
      state: "dormant",
      bindProgress: 0,
    };
    this.clearFinalClutter();
    this.audio.restoreAfterReveal();
    this.audio.setObserverMode(true);
    this.updateTitle("YOU ARE THE PARASITE");
    const store = useGameUiStore.getState();
    store.setPhase("observer");
    store.setSettingsVisible(false);
    store.setCaption("");
    store.setClock("00:20");
    store.setPrompt(strings.prompts.finalA);
  }

  private clearFinalClutter() {
    if (!this.hostCore) {
      return;
    }

    const corePos = this.hostCore.pos;
    this.cells = this.cells.filter((cell) => dist(cell.pos, corePos) > 6.3);

    while (this.cells.length < 18) {
      this.spawnCellCluster(this.nextClusterCenter(), 3, false);
    }
  }

  private chooseHostCorePosition() {
    const candidates = this.hostCoreCandidates();
    let best: { pos: Vec2; score: number } | null = null;
    let fallback: { pos: Vec2; score: number } | null = null;

    for (const pos of candidates) {
      const scored = this.scoreHostCoreCandidate(pos);

      if (!fallback || scored.fallbackScore > fallback.score) {
        fallback = { pos, score: scored.fallbackScore };
      }

      if (scored.rejected) {
        continue;
      }

      if (!best || scored.score > best.score) {
        best = { pos, score: scored.score };
      }
    }

    return (
      best?.pos ?? fallback?.pos ?? { x: WORLD_SIZE * 0.5, y: WORLD_SIZE * 0.5 }
    );
  }

  private hostCoreCandidates() {
    const candidates: Vec2[] = [];
    const margin = 4.2;
    const center = { x: WORLD_SIZE * 0.5, y: WORLD_SIZE * 0.5 };

    for (let y = margin; y <= WORLD_SIZE - margin; y += 1.8) {
      for (let x = margin; x <= WORLD_SIZE - margin; x += 1.8) {
        candidates.push({ x, y });
      }
    }

    for (const radius of [5.2, 6.6, 8.0]) {
      for (let index = 0; index < 16; index += 1) {
        const angle = (index / 16) * Math.PI * 2;
        candidates.push({
          x: clamp(
            this.player.pos.x + Math.cos(angle) * radius,
            margin,
            WORLD_SIZE - margin,
          ),
          y: clamp(
            this.player.pos.y + Math.sin(angle) * radius,
            margin,
            WORLD_SIZE - margin,
          ),
        });
        candidates.push({
          x: clamp(
            center.x + Math.cos(angle) * radius * 0.62,
            margin,
            WORLD_SIZE - margin,
          ),
          y: clamp(
            center.y + Math.sin(angle) * radius * 0.62,
            margin,
            WORLD_SIZE - margin,
          ),
        });
      }
    }

    const seen = new Set<string>();

    return candidates.filter((candidate) => {
      const key = `${candidate.x.toFixed(1)}:${candidate.y.toFixed(1)}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private scoreHostCoreCandidate(pos: Vec2) {
    const playerDistance = dist(pos, this.player.pos);
    const chainDistance = this.nearestChainSegmentDistance(pos);
    const boundaryDistance = Math.min(
      pos.x,
      pos.y,
      WORLD_SIZE - pos.x,
      WORLD_SIZE - pos.y,
    );
    const scarDistance = this.scars.reduce(
      (nearest, scar) => Math.min(nearest, dist(pos, scar.pos) - scar.radius),
      Number.POSITIVE_INFINITY,
    );
    const angularCoverage = this.chainAngularCoverage(pos, 5.4);
    const insideOpenChain =
      this.chain.length >= 8 &&
      pointInPolygon(
        pos,
        this.chain.map((link) => link.pos),
      ) &&
      angularCoverage > Math.PI * 1.25;
    const nearEnclosure =
      angularCoverage > Math.PI * 1.55 &&
      chainDistance < HOST_CORE_RADIUS * 1.9;
    const freeArea = this.hostCoreFreeArea(pos);
    const cellCrowding = this.cells.filter(
      (cell) => dist(cell.pos, pos) < 4.5,
    ).length;
    const rejected =
      playerDistance < 4.6 ||
      chainDistance < 2.45 ||
      boundaryDistance < 3.25 ||
      scarDistance < 1.6 ||
      nearEnclosure ||
      insideOpenChain ||
      freeArea < 0.58;
    const playerScore = 1 - clamp(Math.abs(playerDistance - 6.8) / 4.4, 0, 1);
    const chainScore = clamp((chainDistance - 2.2) / 4.2, 0, 1);
    const boundaryScore = clamp((boundaryDistance - 3.0) / 5.0, 0, 1);
    const scarScore = Number.isFinite(scarDistance)
      ? clamp((scarDistance - 1.2) / 4.0, 0, 1)
      : 1;
    const enclosurePenalty = clamp(
      (angularCoverage - Math.PI * 1.1) / Math.PI,
      0,
      1,
    );
    const score =
      playerScore * 2.0 +
      chainScore * 3.2 +
      boundaryScore * 1.4 +
      scarScore +
      freeArea * 3.4 -
      enclosurePenalty * 4.2 -
      cellCrowding * 0.16;

    return {
      rejected,
      score,
      fallbackScore:
        score -
        (nearEnclosure ? 12 : 0) -
        (insideOpenChain ? 18 : 0) -
        (playerDistance < 4.0 ? 8 : 0),
    };
  }

  private nearestChainSegmentDistance(point: Vec2) {
    let nearest = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.chain.length - 1; index += 1) {
      const a = this.chain[index];
      const b = this.chain[index + 1];

      if (!a || !b) {
        continue;
      }

      nearest = Math.min(
        nearest,
        dist(point, closestPointOnSegment(point, a.pos, b.pos)),
      );
    }

    return nearest;
  }

  private nearestFinalStartChainDistance(point: Vec2) {
    let nearest = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.finalStartChain.length - 1; index += 1) {
      const a = this.finalStartChain[index];
      const b = this.finalStartChain[index + 1];

      if (!a || !b) {
        continue;
      }

      nearest = Math.min(
        nearest,
        dist(point, closestPointOnSegment(point, a, b)),
      );
    }

    return nearest;
  }

  private chainAngularCoverage(point: Vec2, radius: number) {
    const angles = this.chain
      .filter((link) => dist(link.pos, point) <= radius)
      .map((link) => Math.atan2(link.pos.y - point.y, link.pos.x - point.x))
      .sort((a, b) => a - b);

    if (angles.length < 5) {
      return 0;
    }

    let largestGap = 0;

    for (let index = 0; index < angles.length; index += 1) {
      const current = angles[index];
      const next =
        index === angles.length - 1
          ? angles[0] + Math.PI * 2
          : angles[index + 1];
      largestGap = Math.max(largestGap, next - current);
    }

    return Math.PI * 2 - largestGap;
  }

  private hostCoreFreeArea(point: Vec2) {
    let free = 0;
    const samples = 18;

    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2;
      const sample = {
        x: point.x + Math.cos(angle) * 3.6,
        y: point.y + Math.sin(angle) * 3.6,
      };
      const boundaryDistance = Math.min(
        sample.x,
        sample.y,
        WORLD_SIZE - sample.x,
        WORLD_SIZE - sample.y,
      );
      const chainDistance = this.nearestChainSegmentDistance(sample);
      const scarDistance = this.scars.reduce(
        (nearest, scar) =>
          Math.min(nearest, dist(sample, scar.pos) - scar.radius),
        Number.POSITIVE_INFINITY,
      );

      if (
        boundaryDistance > 1.2 &&
        chainDistance > 1.25 &&
        (!Number.isFinite(scarDistance) || scarDistance > 0.9)
      ) {
        free += 1;
      }
    }

    return free / samples;
  }

  private endVictory() {
    this.phase = "ending";
    this.endingOutcome = "victory";
    this.audio.setObserverMode(false);
    this.audio.silenceHeartbeat(1.25);
    this.audio.fadeForReveal();
    this.audio.playVoice("back_again");
    this.updateTitle("YOU WERE NEVER OUTSIDE");
    const store = useGameUiStore.getState();
    store.setPhase("ending");
    store.setPrompt("");
    store.setSettingsVisible(false);
    store.setCaption(strings.victoryA);
    window.setTimeout(() => {
      if (this.phase === "ending" && this.endingOutcome === "victory") {
        useGameUiStore.getState().setCaption(strings.victoryB);
      }
    }, 1900);
  }

  private endFailure() {
    if (this.phase === "ending") {
      return;
    }

    this.phase = "ending";
    this.endingOutcome = "failure";
    this.audio.setObserverMode(false);
    this.audio.tone("sever");
    this.updateTitle("SIGNAL SEVERED");
    const store = useGameUiStore.getState();
    store.setPhase("ending");
    store.setPrompt("");
    store.setSettingsVisible(false);
    store.setCaption(`${strings.failureA}\n${strings.failureB}`);
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

  private currentFocusState(): FocusState {
    const pullingToCore =
      this.phase === "ending" &&
      this.endingOutcome === "victory" &&
      this.hostCore != null;
    const world =
      pullingToCore && this.hostCore
        ? this.hostCore.pos
        : this.input.mouseWorld;
    const screen = pullingToCore
      ? this.renderer.worldToScreen(world)
      : this.input.mouseScreen;

    return {
      active:
        this.isFocusActive() || this.phase === "observer" || pullingToCore,
      screen,
      world,
      radius: FOCUS_RADIUS,
      influencedIds: this.focusInfluencedIds,
      pulse: this.focusPulse,
    };
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
      hostCore: this.hostCore,
      knot: this.knot,
      candidate: this.candidate,
      focus: this.currentFocusState(),
      chainWave: this.chainWave,
      observerAttacks: this.observerAttacks,
      mouseScreen: this.input.mouseScreen,
      ghostRoute: this.captures === 0 ? this.ghostRoute : [],
      tutorialActive: this.tutorialActive,
      tutorialTargetIndex: this.tutorialActive ? TUTORIAL_TARGET_INDEX : null,
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
      includesCore: false,
    };
    this.finishKnotCapture();
  }

  private installEvents() {
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("mousemove", this.handlePointerMove);
    window.addEventListener("mousedown", this.handlePointerDown);
    window.addEventListener("mouseup", this.handlePointerUp);
    window.addEventListener("mouseleave", this.handlePointerLeave);
    window.addEventListener("contextmenu", this.handleContextMenu);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  private handleResize = () => {
    this.renderer.resize();
    this.input.mouseWorld = this.renderer.screenToWorld(this.input.mouseScreen);
    this.input.pointerInside = this.renderer.isScreenInsideWorld(
      this.input.mouseScreen,
    );
  };

  private handlePointerMove = (event: MouseEvent) => {
    this.input.mouseScreen = { x: event.clientX, y: event.clientY };
    this.input.mouseWorld = this.renderer.screenToWorld(this.input.mouseScreen);
    this.input.pointerInside = this.renderer.isScreenInsideWorld(
      this.input.mouseScreen,
    );
  };

  private handlePointerLeave = () => {
    this.input.pointerInside = false;
    this.focusInfluencedIds = [];
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

    if (key === "escape") {
      const store = useGameUiStore.getState();

      if (store.settingsVisible) {
        store.setSettingsVisible(false);
        return;
      }

      if (this.phase === "playing") {
        this.pause();
      } else if (this.phase === "paused") {
        this.resume();
      }

      return;
    }

    this.input.keys.add(key);
    this.applyMovementTapImpulse(key);

    if (
      key === " " &&
      this.player.dashCooldown <= 0 &&
      (this.phase === "playing" || this.phase === "observer")
    ) {
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
    if (
      this.phase !== "playing" &&
      (this.phase !== "observer" ||
        this.observerIntroElapsed < FINAL_ONBOARDING_SECONDS)
    ) {
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

const crossedSegment = (
  start: Vec2,
  end: Vec2,
  a: Vec2,
  b: Vec2,
  forgiveness: number,
): Vec2 | null => {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const lengthSq = ab.x * ab.x + ab.y * ab.y;

  if (lengthSq < 0.0001) {
    return null;
  }

  const sideStart = cross(ab, { x: start.x - a.x, y: start.y - a.y });
  const sideEnd = cross(ab, { x: end.x - a.x, y: end.y - a.y });
  const closest = closestPointOnSegment(end, a, b);

  if (sideStart * sideEnd <= 0 || dist(end, closest) <= forgiveness) {
    return closest;
  }

  return null;
};

const closestPointOnSegment = (point: Vec2, a: Vec2, b: Vec2): Vec2 => {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const lengthSq = ab.x * ab.x + ab.y * ab.y;
  const amount =
    lengthSq < 0.0001
      ? 0
      : clamp(
          ((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / lengthSq,
          0,
          1,
        );

  return {
    x: a.x + ab.x * amount,
    y: a.y + ab.y * amount,
  };
};

const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
