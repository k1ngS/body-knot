import { WORLD_SIZE } from "../core/constants";
import type {
  Cell,
  ChainLink,
  Cutter,
  FocusState,
  HostCore,
  KnotCandidate,
  KnotState,
  ObserverAttack,
  Particle,
  Player,
  Scar,
} from "../core/types";
import { clamp, normalize, type Vec2 } from "../geometry/vector";

export type RenderSnapshot = {
  phase: "menu" | "playing" | "paused" | "reveal" | "observer" | "ending";
  time: number;
  player: Player;
  chain: ChainLink[];
  severed: ChainLink[];
  cells: Cell[];
  scars: Scar[];
  particles: Particle[];
  cutter: Cutter | null;
  hostCore: HostCore | null;
  knot: KnotState;
  candidate: KnotCandidate | null;
  focus: FocusState;
  chainWave: number;
  observerAttacks: ObserverAttack[];
  mouseScreen: Vec2;
  ghostRoute: Vec2[];
  shake: number;
  highContrast: boolean;
  reducedMotion: boolean;
};

export class CanvasRenderer {
  private context: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private scale = 1;
  private offset = { x: 0, y: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas 2D context is unavailable.");
    }

    this.context = context;
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scale = Math.min(this.width, this.height) / WORLD_SIZE;
    this.scale *= this.width > 900 ? 0.9 : 0.96;
    this.offset = {
      x: (this.width - WORLD_SIZE * this.scale) * 0.5,
      y: (this.height - WORLD_SIZE * this.scale) * 0.5,
    };
  }

  screenToWorld(point: Vec2): Vec2 {
    return {
      x: clamp((point.x - this.offset.x) / this.scale, 0, WORLD_SIZE),
      y: clamp((point.y - this.offset.y) / this.scale, 0, WORLD_SIZE),
    };
  }

  isScreenInsideWorld(point: Vec2): boolean {
    const size = WORLD_SIZE * this.scale;

    return (
      point.x >= this.offset.x &&
      point.x <= this.offset.x + size &&
      point.y >= this.offset.y &&
      point.y <= this.offset.y + size
    );
  }

  worldToScreen(point: Vec2): Vec2 {
    return {
      x: this.offset.x + point.x * this.scale,
      y: this.offset.y + point.y * this.scale,
    };
  }

  render(snapshot: RenderSnapshot) {
    const { context } = this;
    context.save();
    context.clearRect(0, 0, this.width, this.height);

    const shake =
      snapshot.shake > 0 && !snapshot.reducedMotion
        ? {
            x: Math.sin(snapshot.time * 71) * snapshot.shake * 10,
            y: Math.cos(snapshot.time * 53) * snapshot.shake * 10,
          }
        : { x: 0, y: 0 };

    context.translate(shake.x, shake.y);
    this.drawBackground(snapshot);
    this.drawScars(snapshot.scars);
    this.drawGhost(snapshot);
    this.drawHostCore(snapshot);
    this.drawCells(
      snapshot.cells,
      snapshot.time,
      snapshot.phase === "observer" || snapshot.phase === "ending",
      new Set(snapshot.candidate?.cellIds ?? []),
      new Set(snapshot.focus.influencedIds),
      snapshot.focus.world,
    );
    this.drawCutterTelegraph(snapshot);
    this.drawKnot(snapshot);
    this.drawKnotGate(snapshot);
    this.drawChain(snapshot.chain, false, snapshot.chainWave);
    this.drawChain(snapshot.severed, true, 0);
    this.drawCutter(snapshot.cutter, snapshot.time);
    this.drawPlayer(snapshot.player, snapshot.phase === "observer");
    this.drawFocus(snapshot);
    this.drawParticles(snapshot.particles);
    this.drawCursorPresence(snapshot);

    if (
      snapshot.phase === "reveal" ||
      snapshot.phase === "observer" ||
      snapshot.phase === "ending"
    ) {
      this.drawEye(snapshot);
    }

    if (snapshot.phase === "observer") {
      this.drawObserverAttacks(snapshot.observerAttacks);
    }

    context.restore();
  }

  private drawBackground(snapshot: RenderSnapshot) {
    const { context } = this;
    const red = snapshot.phase === "observer" || snapshot.phase === "ending";
    const pulse = snapshot.reducedMotion
      ? 0
      : Math.sin(snapshot.time * (red ? 3.2 : 1.1)) * 0.05;
    const gradient = context.createRadialGradient(
      this.width * 0.5,
      this.height * 0.52,
      20,
      this.width * 0.5,
      this.height * 0.52,
      Math.max(this.width, this.height) * 0.74,
    );
    gradient.addColorStop(
      0,
      red ? `rgba(60, 8, 12, ${0.48 + pulse})` : "#0c1112",
    );
    gradient.addColorStop(0.58, red ? "#0b0304" : "#06090a");
    gradient.addColorStop(1, "#010203");
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);

    context.save();
    context.globalAlpha = red ? 0.4 : 0.18;
    context.strokeStyle = red ? "#64141d" : "#384044";
    context.lineWidth = 1;

    for (let index = 0; index < 22; index += 1) {
      const seed = index * 91.7;
      const start = {
        x: ((Math.sin(seed) * 0.5 + 0.5) * this.width) | 0,
        y: ((Math.cos(seed * 1.3) * 0.5 + 0.5) * this.height) | 0,
      };
      const wobble = Math.sin(snapshot.time * 0.6 + index) * 18;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.bezierCurveTo(
        start.x + Math.sin(seed) * 180,
        start.y + Math.cos(seed) * 80 + wobble,
        start.x + Math.cos(seed * 0.7) * 260,
        start.y + Math.sin(seed) * 170,
        start.x + Math.sin(seed * 2) * 380,
        start.y + Math.cos(seed * 0.9) * 260,
      );
      context.stroke();
    }

    context.restore();

    const arenaTopLeft = this.worldToScreen({ x: 0, y: 0 });
    const arenaBottomRight = this.worldToScreen({
      x: WORLD_SIZE,
      y: WORLD_SIZE,
    });
    context.strokeStyle = red ? "#45101755" : "#d7d3c814";
    context.lineWidth = 1;
    context.strokeRect(
      arenaTopLeft.x,
      arenaTopLeft.y,
      arenaBottomRight.x - arenaTopLeft.x,
      arenaBottomRight.y - arenaTopLeft.y,
    );
  }

  private drawGhost(snapshot: RenderSnapshot) {
    if (snapshot.ghostRoute.length < 2 || snapshot.phase !== "playing") {
      return;
    }

    const { context } = this;
    context.save();
    context.setLineDash([5, 8]);
    context.strokeStyle = snapshot.highContrast ? "#ffffff99" : "#80f4ff44";
    context.lineWidth = 2;
    context.beginPath();

    for (const [index, point] of snapshot.ghostRoute.entries()) {
      const screen = this.worldToScreen(point);

      if (index === 0) {
        context.moveTo(screen.x, screen.y);
      } else {
        context.lineTo(screen.x, screen.y);
      }
    }

    context.stroke();
    context.restore();
  }

  private drawHostCore(snapshot: RenderSnapshot) {
    const core = snapshot.hostCore;

    if (!core) {
      return;
    }

    const { context } = this;
    const screen = this.worldToScreen(core.pos);
    const bind = core.state === "binding" ? core.bindProgress : 0;
    const pulse = snapshot.reducedMotion
      ? 0.2
      : 0.5 + Math.sin(snapshot.time * 5 + core.pulse) * 0.5;
    const radius =
      core.radius * this.scale * (1 + pulse * 0.08) * (1 - bind * 0.28);
    context.save();
    context.translate(screen.x, screen.y);

    const glow = context.createRadialGradient(0, 0, 2, 0, 0, radius * 2.9);
    glow.addColorStop(0, `rgba(198, 244, 244, ${0.18 + pulse * 0.08})`);
    glow.addColorStop(0.42, "rgba(100, 18, 28, 0.24)");
    glow.addColorStop(1, "transparent");
    context.fillStyle = glow;
    context.fillRect(-radius * 3, -radius * 3, radius * 6, radius * 6);

    if (snapshot.phase === "observer") {
      context.save();
      context.globalAlpha = 0.36 + pulse * 0.18;
      context.strokeStyle = "#c8ffff";
      context.lineWidth = 1.6;
      context.setLineDash([10, 9]);
      context.beginPath();
      context.ellipse(
        0,
        0,
        radius * 2.35,
        radius * 1.45,
        -0.48,
        -Math.PI * 0.15,
        Math.PI * 1.35,
      );
      context.stroke();
      context.restore();
    }

    context.rotate(snapshot.time * 0.24);
    context.fillStyle = core.state === "bound" ? "#eafcff" : "#1a060a";
    context.strokeStyle = core.state === "bound" ? "#eaffff" : "#d6404f";
    context.lineWidth = 2.4;
    context.beginPath();

    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      const pointRadius = radius * (index % 2 === 0 ? 1.08 : 0.7);
      const x = Math.cos(angle) * pointRadius;
      const y = Math.sin(angle) * pointRadius;

      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.closePath();
    context.fill();
    context.stroke();
    context.strokeStyle = "#f0ffff99";
    context.lineWidth = 1.2;
    context.beginPath();
    context.ellipse(0, 0, radius * 0.42, radius * 0.72, 0.2, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  private drawCells(
    cells: Cell[],
    time: number,
    red: boolean,
    candidateCellIds: Set<number>,
    focusCellIds: Set<number>,
    focusWorld: Vec2,
  ) {
    const { context } = this;

    for (const cell of cells) {
      const screen = this.worldToScreen(cell.pos);
      const radius = cell.radius * this.scale;
      const pulse = 1 + Math.sin(time * 4 + cell.phase) * 0.08;
      context.save();
      context.translate(screen.x, screen.y);
      context.scale(pulse, pulse);

      const isCandidate = candidateCellIds.has(cell.id);
      const isFocused = focusCellIds.has(cell.id);

      if (isFocused) {
        const lean = normalize({
          x: focusWorld.x - cell.pos.x,
          y: focusWorld.y - cell.pos.y,
        });
        context.translate(lean.x * radius * 0.18, lean.y * radius * 0.18);
        context.rotate(Math.atan2(lean.y, lean.x) * 0.08);
      }

      if (cell.highlighted || isCandidate || isFocused) {
        context.strokeStyle = isCandidate
          ? "#a8fbffcc"
          : isFocused
            ? "#d6dedc88"
            : "#c9fbff77";
        context.lineWidth = isCandidate ? 2.4 : isFocused ? 1.3 : 1.6;
        context.beginPath();
        context.arc(
          0,
          0,
          radius * (isCandidate ? 2.12 : isFocused ? 1.85 : 1.62),
          0,
          Math.PI * 2,
        );
        context.stroke();
      }

      if (cell.type === "hunter") {
        context.fillStyle = red ? "#a43a43aa" : "#c9d6d2cc";
        context.strokeStyle = red ? "#ef4050" : "#9cf2ff";
        context.beginPath();
        context.moveTo(0, -radius * 1.2);
        context.lineTo(radius * 0.9, radius * 0.85);
        context.lineTo(0, radius * 0.45);
        context.lineTo(-radius * 0.9, radius * 0.85);
        context.closePath();
      } else if (cell.type === "platelet") {
        context.fillStyle = red ? "#673137aa" : "#d8d0c2bb";
        context.strokeStyle = red ? "#9a313a" : "#b7bbc0";
        context.beginPath();
        context.ellipse(
          0,
          0,
          radius * 1.25,
          radius * 0.72,
          Math.sin(cell.phase),
          0,
          Math.PI * 2,
        );
      } else {
        const glow = context.createRadialGradient(0, 0, 1, 0, 0, radius * 2.5);
        glow.addColorStop(0, red ? "#ff4056" : "#9b6dff");
        glow.addColorStop(1, "transparent");
        context.fillStyle = glow;
        context.fillRect(-radius * 2.5, -radius * 2.5, radius * 5, radius * 5);
        context.fillStyle = red ? "#e23b4dcc" : "#c6b5ffcc";
        context.strokeStyle = red ? "#ff8b94" : "#7b62ff";
        context.beginPath();

        for (let index = 0; index < 8; index += 1) {
          const angle = (index / 8) * Math.PI * 2;
          const pointRadius = radius * (index % 2 === 0 ? 1.18 : 0.68);
          const x = Math.cos(angle) * pointRadius;
          const y = Math.sin(angle) * pointRadius;

          if (index === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }

        context.closePath();
      }

      context.lineWidth = 1.4;
      context.fill();
      context.stroke();
      context.restore();
    }
  }

  private drawChain(chain: ChainLink[], dead: boolean, chainWave: number) {
    if (chain.length < 2) {
      return;
    }

    const { context } = this;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = dead ? "#321013aa" : "#61706faa";
    context.lineWidth = dead ? 3 : 3.3;
    context.beginPath();

    for (const [index, link] of chain.entries()) {
      const screen = this.worldToScreen(link.pos);

      if (index === 0) {
        context.moveTo(screen.x, screen.y);
      } else {
        context.lineTo(screen.x, screen.y);
      }
    }

    context.stroke();

    for (const [index, link] of chain.entries()) {
      const screen = this.worldToScreen(link.pos);
      const firstLink = !dead && index <= 2;
      const distanceFade = dead
        ? 1
        : clamp(1 - (index / chain.length) * 0.5, 0.42, 1);
      const wavePosition = 1 - chainWave;
      const wave =
        chainWave > 0
          ? Math.max(
              0,
              1 -
                Math.abs(index / Math.max(1, chain.length - 1) - wavePosition) *
                  7,
            )
          : 0;
      const radius =
        (link.kind === "platelet" ? 0.13 : 0.105) *
        (firstLink ? 1.45 : 1) *
        (1 + wave * 0.55);
      context.globalAlpha = dead ? 1 : distanceFade;
      context.fillStyle = dead ? "#2b0b0e" : this.linkColor(link.kind);
      context.beginPath();
      context.arc(screen.x, screen.y, radius * this.scale, 0, Math.PI * 2);
      context.fill();

      if (firstLink || wave > 0.1) {
        context.strokeStyle = firstLink ? "#ecfffbcc" : "#cfffffaa";
        context.lineWidth = firstLink ? 1.3 : 1;
        context.beginPath();
        context.arc(
          screen.x,
          screen.y,
          radius * this.scale * (firstLink ? 1.65 : 1.9),
          0,
          Math.PI * 2,
        );
        context.stroke();
      }
    }

    context.globalAlpha = 1;
    context.restore();
  }

  private drawKnotGate(snapshot: RenderSnapshot) {
    const candidate = snapshot.candidate;

    if (!candidate || snapshot.phase !== "playing") {
      return;
    }

    const a = snapshot.chain[candidate.targetIndex];
    const b = snapshot.chain[candidate.targetIndex + 1];

    if (!a || !b) {
      return;
    }

    const { context } = this;
    const pulse = snapshot.reducedMotion
      ? 0.7
      : 0.62 + Math.sin(candidate.pulse * 2.2) * 0.24;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";

    if (candidate.previewCount > 0 && candidate.polygon.length > 2) {
      context.globalAlpha = 0.08 + pulse * 0.05;
      context.fillStyle = snapshot.highContrast ? "#ffffff" : "#9cf2ff";
      context.beginPath();

      for (const [index, point] of candidate.polygon.entries()) {
        const screen = this.worldToScreen(point);

        if (index === 0) {
          context.moveTo(screen.x, screen.y);
        } else {
          context.lineTo(screen.x, screen.y);
        }
      }

      context.closePath();
      context.fill();
    }

    context.globalAlpha = 1;
    const start = this.worldToScreen(a.pos);
    const end = this.worldToScreen(b.pos);
    context.strokeStyle = snapshot.highContrast
      ? `rgba(255, 255, 255, ${0.65 + pulse * 0.25})`
      : `rgba(156, 242, 255, ${0.55 + pulse * 0.32})`;
    context.lineWidth = 7;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();

    const point = this.worldToScreen(candidate.point);
    context.translate(point.x, point.y);
    context.rotate(candidate.pulse * 0.35);
    context.strokeStyle = candidate.previewCount > 0 ? "#eaffff" : "#91a7aa";
    context.lineWidth = 2;
    const marker = 8 + pulse * 5;
    context.beginPath();
    context.moveTo(-marker, -marker);
    context.lineTo(marker, marker);
    context.moveTo(marker, -marker);
    context.lineTo(-marker, marker);
    context.stroke();
    context.beginPath();
    context.arc(0, 0, marker * 1.35, -Math.PI * 0.25, Math.PI * 1.15);
    context.stroke();

    if (candidate.previewCount > 0) {
      context.rotate(-candidate.pulse * 0.35);
      context.font = "900 12px Arial, Helvetica, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#eaffff";
      context.strokeStyle = "#020304";
      context.lineWidth = 4;
      const text = `x${candidate.previewCount}`;
      context.strokeText(text, 0, -marker * 2.9);
      context.fillText(text, 0, -marker * 2.9);
    }

    context.restore();
  }

  private drawKnot(snapshot: RenderSnapshot) {
    const { context } = this;

    if (snapshot.knot.mode === "idle") {
      return;
    }

    const path = snapshot.knot.polygon;

    if (path.length < 2) {
      return;
    }

    const progress = snapshot.knot.progress;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = `rgba(190, 250, 255, ${0.9 - progress * 0.32})`;
    context.lineWidth = 6 - progress * 2.5;
    context.beginPath();

    for (const [index, point] of path.entries()) {
      const contracted = lerpWorld(
        point,
        snapshot.knot.center,
        progress * 0.55,
      );
      const screen = this.worldToScreen(contracted);

      if (index === 0) {
        context.moveTo(screen.x, screen.y);
      } else {
        context.lineTo(screen.x, screen.y);
      }
    }

    context.closePath();
    context.globalAlpha = 0.13 + (1 - progress) * 0.14;
    context.fillStyle =
      snapshot.knot.capturedIds.length > 1 ? "#c8ffff" : "#a7f7ff";
    context.fill();
    context.globalAlpha = 1;
    context.stroke();
    context.restore();
  }

  private drawCutterTelegraph(snapshot: RenderSnapshot) {
    if (!snapshot.cutter?.target) {
      return;
    }

    const target = snapshot.cutter.target;
    const a = snapshot.chain[target.index];
    const b = snapshot.chain[target.index + 1];

    if (!a || !b) {
      return;
    }

    const { context } = this;
    const start = this.worldToScreen(a.pos);
    const end = this.worldToScreen(b.pos);
    const cutter = this.worldToScreen(snapshot.cutter.pos);
    const targetPoint = this.worldToScreen(target.point);
    const pulse = snapshot.reducedMotion
      ? 0.7
      : 0.45 + Math.sin(snapshot.time * 12) * 0.25;
    const charge = clamp(snapshot.cutter.telegraph / 1.12, 0, 1);
    context.save();
    context.lineCap = "round";
    context.strokeStyle = `rgba(226, 43, 62, ${0.18 + pulse * 0.35})`;
    context.lineWidth = 1.5;
    context.setLineDash([6, 7]);
    context.beginPath();
    context.moveTo(cutter.x, cutter.y);
    context.lineTo(targetPoint.x, targetPoint.y);
    context.stroke();
    context.setLineDash([]);
    context.strokeStyle = `rgba(226, 43, 62, ${0.38 + pulse})`;
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.strokeStyle = "#f07b86";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(
      cutter.x,
      cutter.y,
      18,
      -Math.PI / 2,
      -Math.PI / 2 + charge * Math.PI * 2,
    );
    context.stroke();

    context.restore();
  }

  private drawCutter(cutter: Cutter | null, time: number) {
    if (!cutter) {
      return;
    }

    const { context } = this;
    const screen = this.worldToScreen(cutter.pos);
    context.save();
    context.translate(screen.x, screen.y);
    context.rotate(time * 3);
    context.fillStyle = "#230509";
    context.strokeStyle = "#d12f3e";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, -12);
    context.lineTo(16, 0);
    context.lineTo(0, 12);
    context.lineTo(-8, 0);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  private drawPlayer(player: Player, horror: boolean) {
    const { context } = this;
    const screen = this.worldToScreen(player.pos);
    const direction = normalize(player.vel);
    const radius = player.radius * this.scale * 1.32;
    context.save();
    context.fillStyle = horror ? "#6f111aaa" : "#dffbff18";
    context.beginPath();
    context.arc(screen.x, screen.y, radius * 1.85, 0, Math.PI * 2);
    context.fill();
    context.translate(screen.x, screen.y);
    context.rotate(Math.atan2(direction.y, direction.x) + Math.PI / 2);
    context.fillStyle = horror ? "#ded3c7" : "#bec8c5";
    context.strokeStyle = horror ? "#b72935" : "#ecfffb";
    context.lineWidth = 1.8;
    context.beginPath();
    context.moveTo(0, -radius * 1.64);
    context.bezierCurveTo(
      radius * 0.96,
      -radius * 0.86,
      radius * 1.08,
      radius * 0.42,
      radius * 0.44,
      radius * 1.02,
    );
    context.lineTo(0, radius * 0.48);
    context.lineTo(-radius * 0.44, radius * 1.02);
    context.bezierCurveTo(
      -radius * 1.08,
      radius * 0.42,
      -radius * 0.96,
      -radius * 0.86,
      0,
      -radius * 1.64,
    );
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = horror ? "#9b202b" : "#f3fffb";
    context.beginPath();
    context.arc(0, 0, radius * 0.28, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  private drawFocus(snapshot: RenderSnapshot) {
    const focus = snapshot.focus;

    if (!focus.active && snapshot.phase !== "observer") {
      return;
    }

    const { context } = this;
    const red = snapshot.phase === "observer";
    const strong = focus.influencedIds.length >= 3 || red;
    const pulse = snapshot.reducedMotion
      ? 0
      : Math.sin(snapshot.time * (strong ? 8 : 4.2) + focus.pulse) * 2.5;
    const ringRadius = red
      ? 16 + pulse
      : strong
        ? 18 + pulse
        : 12 + pulse * 0.4;

    context.save();

    if (focus.active) {
      const focusScreen = this.worldToScreen(focus.world);

      for (const cellId of focus.influencedIds) {
        const cell = snapshot.cells.find(
          (candidate) => candidate.id === cellId,
        );

        if (!cell) {
          continue;
        }

        const cellScreen = this.worldToScreen(cell.pos);
        context.globalAlpha = 0.22;
        context.strokeStyle = "#c7d1cf";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(focusScreen.x, focusScreen.y);
        context.quadraticCurveTo(
          (focusScreen.x + cellScreen.x) * 0.5 + Math.sin(cell.phase) * 5,
          (focusScreen.y + cellScreen.y) * 0.5 + Math.cos(cell.phase) * 5,
          cellScreen.x,
          cellScreen.y,
        );
        context.stroke();
      }

      context.globalAlpha = 1;
    }

    context.translate(focus.screen.x, focus.screen.y);
    context.strokeStyle = red
      ? "#b72935dd"
      : strong
        ? "#d7dfddbb"
        : "#b7c0c188";
    context.lineWidth = red ? 2 : strong ? 1.5 : 1.1;
    context.beginPath();
    context.ellipse(
      0,
      0,
      ringRadius,
      ringRadius * (red ? 0.82 : 0.72),
      snapshot.time * 0.18,
      0,
      Math.PI * 2,
    );
    context.stroke();

    if (strong) {
      context.globalAlpha = red ? 0.5 : 0.28;
      context.beginPath();
      context.arc(0, 0, ringRadius * 1.45, 0, Math.PI * 2);
      context.stroke();
    }

    context.restore();
  }

  private drawScars(scars: Scar[]) {
    const { context } = this;

    for (const scar of scars) {
      const screen = this.worldToScreen(scar.pos);
      const progress = scar.life / scar.maxLife;
      const radius = scar.radius * this.scale * (1.4 - progress * 0.35);
      context.fillStyle = `rgba(88, 12, 19, ${0.5 * progress})`;
      context.beginPath();
      context.ellipse(
        screen.x,
        screen.y,
        radius * 1.4,
        radius * 0.72,
        scar.pos.x,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }

  private drawParticles(particles: Particle[]) {
    const { context } = this;

    for (const particle of particles) {
      const screen = this.worldToScreen(particle.pos);
      context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      context.fillStyle = particle.color;
      context.beginPath();
      context.arc(screen.x, screen.y, 2.4, 0, Math.PI * 2);
      context.fill();
    }

    context.globalAlpha = 1;
  }

  private drawObserverAttacks(attacks: ObserverAttack[]) {
    const { context } = this;

    for (const attack of attacks) {
      const progress = 1 - attack.life / attack.maxLife;
      context.globalAlpha = clamp(attack.life / attack.maxLife, 0, 1);
      context.strokeStyle = attack.demo
        ? "#d8d0c2aa"
        : attack.hit
          ? "#ff4050"
          : "#e63848";
      context.lineWidth = attack.hit ? 5 : 2;
      context.beginPath();
      context.arc(
        attack.pos.x,
        attack.pos.y,
        attack.hit ? 14 + progress * 74 : attack.radius + progress * 12,
        0,
        Math.PI * 2,
      );
      context.stroke();

      if (!attack.hit) {
        const charge = clamp(
          (attack.maxLife - attack.life) / attack.telegraph,
          0,
          1,
        );
        context.globalAlpha = attack.demo ? 0.45 : 0.78;
        context.beginPath();
        context.arc(
          attack.pos.x,
          attack.pos.y,
          attack.radius * 1.35,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * charge,
        );
        context.stroke();
        context.beginPath();
        context.moveTo(attack.pos.x - attack.radius * 1.8, attack.pos.y);
        context.lineTo(attack.pos.x - attack.radius * 0.7, attack.pos.y);
        context.moveTo(attack.pos.x + attack.radius * 0.7, attack.pos.y);
        context.lineTo(attack.pos.x + attack.radius * 1.8, attack.pos.y);
        context.moveTo(attack.pos.x, attack.pos.y - attack.radius * 1.8);
        context.lineTo(attack.pos.x, attack.pos.y - attack.radius * 0.7);
        context.moveTo(attack.pos.x, attack.pos.y + attack.radius * 0.7);
        context.lineTo(attack.pos.x, attack.pos.y + attack.radius * 1.8);
        context.stroke();
      }
    }

    context.globalAlpha = 1;
  }

  private drawCursorPresence(snapshot: RenderSnapshot) {
    if (snapshot.phase !== "reveal" && snapshot.phase !== "observer") {
      return;
    }

    const { context } = this;
    const red = snapshot.phase === "reveal" || snapshot.phase === "observer";
    const pulse = snapshot.reducedMotion ? 0 : Math.sin(snapshot.time * 8) * 2;
    context.save();
    context.translate(snapshot.mouseScreen.x, snapshot.mouseScreen.y);
    context.strokeStyle = red ? "#8f1d29cc" : "#b7c0c188";
    context.lineWidth = red ? 1.8 : 1.2;
    context.beginPath();
    context.arc(0, 0, red ? 15 + pulse : 6, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(red ? -22 : -9, 0);
    context.lineTo(red ? -9 : -3, 0);
    context.moveTo(red ? 9 : 3, 0);
    context.lineTo(red ? 22 : 9, 0);
    context.moveTo(0, red ? -22 : -9);
    context.lineTo(0, red ? -9 : -3);
    context.moveTo(0, red ? 9 : 3);
    context.lineTo(0, red ? 22 : 9);
    context.stroke();
    context.restore();
  }

  private drawEye(snapshot: RenderSnapshot) {
    const { context } = this;
    const big = snapshot.phase === "reveal" || snapshot.phase === "ending";
    const center = {
      x: this.width * 0.5,
      y: big ? this.height * 0.38 : this.height * 0.22,
    };
    const eyeWidth = Math.min(
      this.width * (big ? 0.52 : 0.28),
      big ? 620 : 340,
    );
    const eyeHeight = Math.min(
      this.height * (big ? 0.26 : 0.14),
      big ? 210 : 112,
    );
    const open =
      snapshot.phase === "ending"
        ? clamp(1 - snapshot.time / 1.2, 0.05, 1)
        : clamp((snapshot.time - 0.4) / 2.2, 0, 1);
    const attackCharge =
      snapshot.phase === "observer"
        ? Math.max(
            0,
            ...snapshot.observerAttacks
              .filter((attack) => !attack.hit && !attack.demo)
              .map((attack) =>
                clamp((attack.maxLife - attack.life) / attack.telegraph, 0, 1),
              ),
          )
        : 0;
    const blink = snapshot.reducedMotion
      ? 1
      : 0.92 + Math.sin(snapshot.time * 2.1) * 0.05 - attackCharge * 0.22;
    const lid = eyeHeight * open * blink;
    context.save();
    context.translate(center.x, center.y);
    const socket = context.createRadialGradient(0, 0, 5, 0, 0, eyeWidth * 0.62);
    socket.addColorStop(0, "#35070d99");
    socket.addColorStop(0.6, "#16040777");
    socket.addColorStop(1, "transparent");
    context.fillStyle = socket;
    context.beginPath();
    context.ellipse(0, 0, eyeWidth * 0.62, eyeHeight * 0.95, 0, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.beginPath();
    context.ellipse(0, 0, eyeWidth * 0.5, Math.max(1, lid), 0, 0, Math.PI * 2);
    context.clip();
    const sclera = context.createRadialGradient(
      -eyeWidth * 0.12,
      -eyeHeight * 0.15,
      8,
      0,
      0,
      eyeWidth * 0.55,
    );
    sclera.addColorStop(0, "#d8d0c2");
    sclera.addColorStop(0.45, "#9c8f82");
    sclera.addColorStop(1, "#38282a");
    context.fillStyle = sclera;
    context.fillRect(
      -eyeWidth * 0.55,
      -eyeHeight,
      eyeWidth * 1.1,
      eyeHeight * 2,
    );

    for (let index = 0; index < 26; index += 1) {
      const angle = (index / 26) * Math.PI * 2 + Math.sin(index * 12.3) * 0.12;
      context.strokeStyle = index % 3 === 0 ? "#7e1721aa" : "#5d222866";
      context.lineWidth = index % 4 === 0 ? 1.2 : 0.65;
      context.beginPath();
      context.moveTo(
        Math.cos(angle) * eyeWidth * 0.2,
        Math.sin(angle) * eyeHeight * 0.3,
      );
      context.quadraticCurveTo(
        Math.cos(angle + 0.18) * eyeWidth * 0.34,
        Math.sin(angle + 0.18) * eyeHeight * 0.72,
        Math.cos(angle) * eyeWidth * 0.48,
        Math.sin(angle) * eyeHeight * 0.85,
      );
      context.stroke();
    }

    const look = normalize({
      x: snapshot.mouseScreen.x - center.x,
      y: snapshot.mouseScreen.y - center.y,
    });
    const iris = {
      x: look.x * eyeWidth * 0.06,
      y: look.y * eyeHeight * 0.14,
    };
    const irisRadius = Math.min(eyeWidth * 0.13, big ? 86 : 48);
    context.translate(iris.x, iris.y);
    const irisGradient = context.createRadialGradient(
      0,
      0,
      2,
      0,
      0,
      irisRadius,
    );
    irisGradient.addColorStop(0, "#050405");
    irisGradient.addColorStop(0.22, "#130408");
    irisGradient.addColorStop(0.5, "#6c121e");
    irisGradient.addColorStop(0.78, "#281014");
    irisGradient.addColorStop(1, "#050405");
    context.fillStyle = irisGradient;
    context.beginPath();
    context.arc(0, 0, irisRadius, 0, Math.PI * 2);
    context.fill();

    for (let index = 0; index < 44; index += 1) {
      const angle = (index / 44) * Math.PI * 2;
      context.strokeStyle = index % 4 === 0 ? "#d14a55" : "#8b2630";
      context.lineWidth = index % 5 === 0 ? 1.3 : 0.6;
      context.beginPath();
      context.moveTo(
        Math.cos(angle) * irisRadius * 0.28,
        Math.sin(angle) * irisRadius * 0.28,
      );
      context.lineTo(
        Math.cos(angle + 0.035) * irisRadius * 0.94,
        Math.sin(angle + 0.035) * irisRadius * 0.94,
      );
      context.stroke();
    }

    context.fillStyle = "#020203";
    context.beginPath();
    context.ellipse(
      0,
      0,
      irisRadius * 0.36,
      irisRadius * 0.62,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.fillStyle = "#ffffffcc";
    context.beginPath();
    context.arc(
      -irisRadius * 0.28,
      -irisRadius * 0.3,
      irisRadius * 0.16,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.restore();

    context.fillStyle = "#080405";
    context.strokeStyle = "#5a1119";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(-eyeWidth * 0.55, -eyeHeight * 0.9);
    context.lineTo(eyeWidth * 0.55, -eyeHeight * 0.9);
    context.lineTo(eyeWidth * 0.55, 0);
    context.bezierCurveTo(
      eyeWidth * 0.28,
      -lid * 0.88,
      -eyeWidth * 0.28,
      -lid * 0.88,
      -eyeWidth * 0.55,
      0,
    );
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(-eyeWidth * 0.55, eyeHeight * 0.9);
    context.lineTo(eyeWidth * 0.55, eyeHeight * 0.9);
    context.lineTo(eyeWidth * 0.55, 0);
    context.bezierCurveTo(
      eyeWidth * 0.28,
      lid * 0.88,
      -eyeWidth * 0.28,
      lid * 0.88,
      -eyeWidth * 0.55,
      0,
    );
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  private linkColor(kind: ChainLink["kind"]) {
    if (kind === "hunter") {
      return "#9cf2ff";
    }

    if (kind === "platelet") {
      return "#d8d0c2";
    }

    if (kind === "fever") {
      return "#b08bff";
    }

    return "#9aa8a6";
  }
}

const lerpWorld = (a: Vec2, b: Vec2, amount: number): Vec2 => ({
  x: a.x + (b.x - a.x) * amount,
  y: a.y + (b.y - a.y) * amount,
});
