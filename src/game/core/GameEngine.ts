import { strings } from "@/i18n/strings";
import { useGameUiStore } from "@/stores/useGameUiStore";
import { AudioDirector } from "../audio/AudioDirector";
import {
  hasObviousSelfIntersection,
  pathLength,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  samplePathFromEnd,
  simplifyPath,
} from "../geometry/polygon";
import { clamp, dist, normalize, type Vec2, vec } from "../geometry/vector";
import { CanvasRenderer } from "../rendering/CanvasRenderer";
import {
  CHAIN_SEGMENT_LENGTH,
  FIXED_TIMESTEP,
  INITIAL_LINKS,
  LOOP_CLOSE_DISTANCE,
  MIN_LOOP_AREA,
  MIN_LOOP_LENGTH,
  OBSERVER_DURATION,
  PATH_RECORD_DISTANCE,
  REVELATION_TIME,
  WORLD_SIZE,
} from "./constants";
import type {
  Cell,
  CellType,
  ChainLink,
  Cutter,
  LassoState,
  LinkKind,
  ObserverAttack,
  Particle,
  Player,
  Scar,
} from "./types";

type RuntimePhase = "menu" | "playing" | "reveal" | "observer" | "ending";

type InputState = {
  keys: Set<string>;
  leftHeld: boolean;
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
  private input: InputState = {
    keys: new Set(),
    leftHeld: false,
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
  private lasso: LassoState = { mode: "idle" };
  private ghostRoute: Vec2[] = [
    { x: 12.7, y: 16.8 },
    { x: 12.9, y: 13.8 },
    { x: 16.4, y: 13.5 },
    { x: 18.1, y: 16.5 },
    { x: 15.2, y: 18.4 },
    { x: 12.7, y: 16.8 },
  ];

  constructor(canvas: HTMLCanvasElement) {
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
    this.phaseStartedAt = this.startedAt;
    this.updateTitle("BODY//KNOT");
    useGameUiStore.getState().setPhase("playing");
    useGameUiStore.getState().setPrompt(strings.prompts.anchor);
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
    this.lasso = { mode: "idle" };
    this.captures = 0;
    this.firstCutterQueued = false;
    this.revealStage = -1;
    this.attackTimer = 0;
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

    for (let index = 0; index < 15; index += 1) {
      this.cells.push(this.createRandomCell(false));
    }
  }

  private createPlayer(): Player {
    return {
      pos: { x: 16.5, y: 20 },
      prev: { x: 16.5, y: 20 },
      vel: vec(),
      radius: 0.42,
      dashCooldown: 0,
      dashImpulse: 0,
    };
  }

  private spawnGuidedCells() {
    const guided: Array<[CellType, number, number]> = [
      ["hunter", 14.5, 15.9],
      ["platelet", 15.5, 16.2],
      ["fever", 16.2, 15.2],
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
        x: 3 + Math.random() * 26,
        y: 4 + Math.random() * 24,
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

    if (this.phase === "playing") {
      this.updatePlaying(delta, now);
    } else if (this.phase === "reveal") {
      this.updateReveal(now);
    } else if (this.phase === "observer") {
      this.updateObserver(delta, now);
    }

    this.updateCells(delta);
    this.updateChain(delta);
    this.updateParticles(delta);
    this.updateDebug();
  }

  private updatePlaying(delta: number, now: number) {
    const elapsed = now - this.startedAt;
    const store = useGameUiStore.getState();
    store.setClock(`00:${Math.floor(elapsed).toString().padStart(2, "0")}`);

    if (this.lasso.mode !== "closed") {
      this.updatePlayer(delta, 7.6, 6.4);
    } else {
      this.player.vel = {
        x: this.player.vel.x * 0.7,
        y: this.player.vel.y * 0.7,
      };
    }

    this.updateLasso(delta);
    this.updateCutter(delta);

    if (!this.firstCutterQueued && this.captures > 0) {
      this.firstCutterQueued = true;
      this.spawnCutter();
      store.setToast("CUTTER CELL ENTERED");
    }

    if (elapsed > 45 && this.captures < 3 && this.lasso.mode === "idle") {
      store.setPrompt(strings.prompts.larger);
    } else if (elapsed > 54 && this.lasso.mode === "idle") {
      store.setPrompt(strings.prompts.cursor);
    }

    if (elapsed >= REVELATION_TIME || this.captures >= 3) {
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

    if (this.lasso.mode === "anchored" && this.lasso.tension > 0.72) {
      this.player.vel.x *= 0.86;
      this.player.vel.y *= 0.86;
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

  private updateLasso(delta: number) {
    const store = useGameUiStore.getState();

    if (this.lasso.mode === "idle") {
      if (this.captures === 0) {
        store.setPrompt(strings.prompts.anchor);
      }

      return;
    }

    if (this.lasso.mode === "anchored") {
      const last = this.lasso.path[this.lasso.path.length - 1];
      const toPlayer = dist(last, this.player.pos);
      const available = this.availableChainLength();
      const projectedLength = this.lasso.length + toPlayer;

      if (
        toPlayer >= PATH_RECORD_DISTANCE &&
        projectedLength <= available * 1.05
      ) {
        this.lasso.path.push({ ...this.player.pos });
        this.lasso.path = simplifyPath(this.lasso.path, 0.12);
        this.lasso.length = pathLength(this.lasso.path);
      }

      this.lasso.tension = clamp(projectedLength / available, 0, 1);

      if (this.lasso.tension > 0.88 && this.simulationStep % 12 === 0) {
        this.audio.tone("tension");
      }

      const closeDistance = dist(this.player.pos, this.lasso.anchor);
      const polygon = [...this.lasso.path, { ...this.player.pos }];
      const area = polygonArea(polygon);
      const valid =
        closeDistance <= LOOP_CLOSE_DISTANCE &&
        this.lasso.length >= MIN_LOOP_LENGTH &&
        area >= MIN_LOOP_AREA &&
        !hasObviousSelfIntersection(polygon) &&
        this.lasso.tension < 1.02;

      if (valid) {
        this.closeLoop(polygon, area);
        return;
      }

      store.setPrompt(
        closeDistance < 2 && this.lasso.length > MIN_LOOP_LENGTH * 0.65
          ? strings.prompts.return
          : strings.prompts.encircle,
      );
    } else {
      store.setPrompt(strings.prompts.constrict);

      if (this.input.leftHeld) {
        this.lasso.progress = clamp(this.lasso.progress + delta / 0.95, 0, 1);
        this.audio.tone("constrict");
        this.pullCellsIntoLoop(delta);

        if (this.lasso.progress >= 1) {
          this.finishConstrict();
        }
      }
    }
  }

  private beginAnchor(point: Vec2) {
    const reachable =
      dist(this.player.pos, point) <= this.availableChainLength() + 0.35;

    if (!reachable || this.lasso.mode !== "idle") {
      return;
    }

    this.lasso = {
      mode: "anchored",
      anchor: { ...point },
      path: [{ ...point }, { ...this.player.pos }],
      length: dist(point, this.player.pos),
      tension: 0,
    };
    this.audio.tone("close");
    useGameUiStore.getState().setPrompt(strings.prompts.encircle);
  }

  private closeLoop(polygon: Vec2[], area: number) {
    const closedPolygon = simplifyPath(polygon, 0.16);
    this.lasso = {
      mode: "closed",
      anchor: closedPolygon[0],
      path: closedPolygon,
      polygon: closedPolygon,
      area,
      center: polygonCentroid(closedPolygon),
      progress: 0,
    };
    this.player.vel = vec();
    this.shake = Math.max(this.shake, 0.22);
    this.audio.tone("close");
    useGameUiStore.getState().setPrompt(strings.prompts.constrict);
  }

  private pullCellsIntoLoop(delta: number) {
    if (this.lasso.mode !== "closed") {
      return;
    }

    for (const cell of this.cells) {
      if (!pointInPolygon(cell.pos, this.lasso.polygon)) {
        continue;
      }

      const towardCenter = normalize({
        x: this.lasso.center.x - cell.pos.x,
        y: this.lasso.center.y - cell.pos.y,
      });
      cell.vel.x += towardCenter.x * delta * 6.4;
      cell.vel.y += towardCenter.y * delta * 6.4;
    }
  }

  private finishConstrict() {
    if (this.lasso.mode !== "closed") {
      return;
    }

    const captured = this.cells.filter((cell) =>
      pointInPolygon(
        cell.pos,
        this.lasso.mode === "closed" ? this.lasso.polygon : [],
      ),
    );

    for (const cell of captured) {
      this.addCapturedLink(cell.type);
      this.spawnBurst(
        cell.pos,
        cell.type === "fever" ? "#b08bff" : "#bffaff",
        9,
      );
    }

    this.cells = this.cells.filter((cell) => !captured.includes(cell));

    while (this.cells.length < 22) {
      this.cells.push(this.createRandomCell(false));
    }

    this.captures += 1;
    this.lasso = { mode: "idle" };
    this.input.leftHeld = false;
    this.shake = Math.max(this.shake, captured.length > 2 ? 0.36 : 0.18);
    this.audio.tone("capture");
    useGameUiStore.getState().setToast(`ASSIMILATED ${captured.length}`);
    useGameUiStore.getState().setPrompt(strings.prompts.free);

    if (this.captures === 1) {
      for (const cell of this.cells) {
        cell.highlighted = false;
      }
    }
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

  private cancelLasso() {
    if (this.lasso.mode !== "idle") {
      this.lasso = { mode: "idle" };
      useGameUiStore
        .getState()
        .setPrompt(
          this.captures === 0 ? strings.prompts.anchor : strings.prompts.free,
        );
      this.audio.tone("dash");
    }
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

    if (this.lasso.mode === "anchored" || this.lasso.mode === "closed") {
      const path =
        this.lasso.mode === "closed" ? this.lasso.polygon : this.lasso.path;

      for (let index = 1; index < this.chain.length; index += 1) {
        const sampled = samplePathFromEnd(path, index * CHAIN_SEGMENT_LENGTH);
        this.chain[index].prev = { ...this.chain[index].pos };
        this.chain[index].pos = sampled;
      }

      return;
    }

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
    this.cutter = {
      pos: { x: 1.2, y: 4 + Math.random() * 20 },
      vel: vec(),
      cooldown: 1.2,
      alive: true,
      targetIndex: 6,
    };
  }

  private updateCutter(delta: number) {
    if (!this.cutter) {
      return;
    }

    this.cutter.cooldown = Math.max(0, this.cutter.cooldown - delta);
    const target = this.cutterTarget();
    const direction = normalize({
      x: target.point.x - this.cutter.pos.x,
      y: target.point.y - this.cutter.pos.y,
    });
    this.cutter.vel.x += direction.x * delta * 3.2;
    this.cutter.vel.y += direction.y * delta * 3.2;
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
    this.cutter.targetIndex = target.index;

    if (
      this.cutter.cooldown <= 0 &&
      dist(this.cutter.pos, target.point) < 0.46
    ) {
      this.cutChain(target.index);
      this.cutter.cooldown = 3.4;
      this.cutter.pos.x = clamp(this.cutter.pos.x + 3.2, 0.8, WORLD_SIZE - 0.8);
    }
  }

  private cutterTarget(): { point: Vec2; index: number } {
    if (this.lasso.mode === "anchored" && this.lasso.path.length > 3) {
      const index = Math.floor(this.lasso.path.length * 0.55);

      return {
        point: this.lasso.path[index],
        index: clamp(
          Math.floor((this.lasso.length / CHAIN_SEGMENT_LENGTH) * 0.55),
          5,
          this.chain.length - 2,
        ),
      };
    }

    const index = clamp(
      Math.floor(this.chain.length * 0.72),
      5,
      this.chain.length - 2,
    );

    return { point: this.chain[index].pos, index };
  }

  private cutChain(index: number) {
    if (this.chain.length < 9) {
      return;
    }

    const severIndex = clamp(Math.floor(index), 5, this.chain.length - 2);
    const removed = this.chain.splice(severIndex);
    const cutPoint = removed[0].pos;

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
    this.cancelLasso();
    this.audio.tone("sever");
    this.shake = Math.max(this.shake, 0.42);
    useGameUiStore.getState().setToast(`CHAIN SEVERED -${removed.length}`);
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
    this.cancelLasso();
    this.audio.fadeForReveal();
    this.audio.tone("reveal");
    this.updateTitle("DON'T MOVE");
    const store = useGameUiStore.getState();
    store.setPhase("reveal");
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

  private availableChainLength() {
    return Math.max(0, (this.chain.length - 1) * CHAIN_SEGMENT_LENGTH);
  }

  private updateDebug() {
    if (!isDevelopment || !useGameUiStore.getState().debugVisible) {
      return;
    }

    const polygon = this.lasso.mode === "closed" ? this.lasso.polygon : [];
    const activePathLength =
      this.lasso.mode === "anchored" || this.lasso.mode === "closed"
        ? pathLength(this.lasso.path)
        : 0;

    useGameUiStore.getState().setDebug({
      fps: this.fps,
      step: this.simulationStep,
      chainLinks: this.chain.length,
      pathLength: activePathLength,
      enclosedArea: this.lasso.mode === "closed" ? this.lasso.area : 0,
      cellsInside: polygon.length
        ? this.cells.filter((cell) => pointInPolygon(cell.pos, polygon)).length
        : 0,
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
      lasso: this.lasso,
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

    this.lasso = {
      mode: "closed",
      anchor: polygon[0],
      path: polygon,
      polygon,
      area: polygonArea(polygon),
      center: polygonCentroid(polygon),
      progress: 0.98,
    };
    this.finishConstrict();
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
    if (event.button === 0) {
      this.input.leftHeld = true;

      if (this.phase === "playing" && this.lasso.mode === "idle") {
        this.beginAnchor(this.input.mouseWorld);
      }
    }

    if (event.button === 2) {
      this.cancelLasso();
    }
  };

  private handlePointerUp = (event: MouseEvent) => {
    if (event.button === 0) {
      this.input.leftHeld = false;
    }
  };

  private handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    this.input.keys.add(key);

    if (key === " " && this.player.dashCooldown <= 0 && this.phase !== "menu") {
      this.player.dashImpulse = 4.2;
      this.player.dashCooldown = 0.9;
      this.audio.tone("dash");
    }

    if (key === "r") {
      this.triggerRevelation();
    }

    if (isDevelopment && key === "d") {
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
}
