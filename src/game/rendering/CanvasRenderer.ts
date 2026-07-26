import { WORLD_SIZE } from "../core/constants";
import type {
  Cell,
  ChainLink,
  Cutter,
  LassoState,
  ObserverAttack,
  Particle,
  Player,
  Scar,
} from "../core/types";
import { clamp, normalize, type Vec2 } from "../geometry/vector";

export type RenderSnapshot = {
  phase: "menu" | "playing" | "reveal" | "observer" | "ending";
  time: number;
  player: Player;
  chain: ChainLink[];
  severed: ChainLink[];
  cells: Cell[];
  scars: Scar[];
  particles: Particle[];
  cutter: Cutter | null;
  lasso: LassoState;
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
    this.drawCells(snapshot.cells, snapshot.time, snapshot.phase !== "playing");
    this.drawLasso(snapshot);
    this.drawChain(snapshot.chain, false);
    this.drawChain(snapshot.severed, true);
    this.drawCutter(snapshot.cutter, snapshot.time);
    this.drawPlayer(snapshot.player, snapshot.phase === "observer");
    this.drawParticles(snapshot.particles);

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

  private drawCells(cells: Cell[], time: number, red: boolean) {
    const { context } = this;

    for (const cell of cells) {
      const screen = this.worldToScreen(cell.pos);
      const radius = cell.radius * this.scale;
      const pulse = 1 + Math.sin(time * 4 + cell.phase) * 0.08;
      context.save();
      context.translate(screen.x, screen.y);
      context.scale(pulse, pulse);

      if (cell.highlighted) {
        context.strokeStyle = "#c9fbff88";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(0, 0, radius * 1.9, 0, Math.PI * 2);
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

  private drawChain(chain: ChainLink[], dead: boolean) {
    if (chain.length < 2) {
      return;
    }

    const { context } = this;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = dead ? "#321013aa" : "#738080";
    context.lineWidth = dead ? 3 : 4;
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

    for (const link of chain) {
      const screen = this.worldToScreen(link.pos);
      const radius = link.kind === "platelet" ? 0.13 : 0.105;
      context.fillStyle = dead ? "#2b0b0e" : this.linkColor(link.kind);
      context.beginPath();
      context.arc(screen.x, screen.y, radius * this.scale, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  }

  private drawLasso(snapshot: RenderSnapshot) {
    const { context } = this;

    if (snapshot.lasso.mode === "idle") {
      return;
    }

    const path =
      snapshot.lasso.mode === "closed"
        ? snapshot.lasso.polygon
        : snapshot.lasso.path;

    if (path.length < 2) {
      return;
    }

    const tension =
      snapshot.lasso.mode === "anchored" ? snapshot.lasso.tension : 0;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = `rgba(${145 + tension * 100}, ${210 - tension * 80}, 230, ${0.75 + tension * 0.2})`;
    context.lineWidth = 3 + tension * 3;
    context.beginPath();

    for (const [index, point] of path.entries()) {
      const screen = this.worldToScreen(point);

      if (index === 0) {
        context.moveTo(screen.x, screen.y);
      } else {
        context.lineTo(screen.x, screen.y);
      }
    }

    if (snapshot.lasso.mode === "closed") {
      context.closePath();
      const progress = snapshot.lasso.progress;
      const center = this.worldToScreen(snapshot.lasso.center);
      context.globalAlpha = 0.1 + progress * 0.18;
      context.fillStyle = "#a7f7ff";
      context.fill();
      context.globalAlpha = 1;
      context.stroke();
      context.strokeStyle = "#f4ffff";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(
        center.x,
        center.y,
        (1 - progress * 0.62) * this.scale * 1.3,
        0,
        Math.PI * 2,
      );
      context.stroke();
    } else {
      context.stroke();
      const anchor = this.worldToScreen(snapshot.lasso.anchor);
      context.fillStyle = "#d9ffff";
      context.beginPath();
      context.arc(anchor.x, anchor.y, 0.22 * this.scale, 0, Math.PI * 2);
      context.fill();
    }

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
    context.save();
    context.translate(screen.x, screen.y);
    context.rotate(Math.atan2(direction.y, direction.x) + Math.PI / 2);
    context.fillStyle = horror ? "#ded3c7" : "#bec8c5";
    context.strokeStyle = horror ? "#b72935" : "#ecfffb";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, -player.radius * this.scale * 1.45);
    context.lineTo(player.radius * this.scale, player.radius * this.scale);
    context.lineTo(0, player.radius * this.scale * 0.48);
    context.lineTo(-player.radius * this.scale, player.radius * this.scale);
    context.closePath();
    context.fill();
    context.stroke();
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
      context.strokeStyle = attack.hit ? "#ff4050" : "#8f1d29";
      context.lineWidth = attack.hit ? 5 : 2;
      context.beginPath();
      context.arc(
        attack.pos.x,
        attack.pos.y,
        14 + progress * 74,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }

    context.globalAlpha = 1;
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
        ? 1
        : clamp((snapshot.time - 0.4) / 2.2, 0, 1);
    const blink = snapshot.reducedMotion
      ? 1
      : 0.92 + Math.sin(snapshot.time * 2.1) * 0.05;
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
