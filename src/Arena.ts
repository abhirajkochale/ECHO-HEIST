import Phaser from 'phaser';
import { CORE_HOME, DOORS, EXTRACT, HEIGHT, PLATES, WALLS, WIDTH, clamp, echoFrame, type Echo, type Player, type Snapshot } from '../shared/game.ts';

const C = { bg: 0x070b18, cyan: 0x36e8ff, violet: 0xa56aff, lime: 0xb5ff59, amber: 0xffcb57, red: 0xff5478, wall: 0x17233e, grid: 0x1a2942 };
type P = { x: number; y: number };
export class ArenaScene extends Phaser.Scene {
  private base!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private snap: Snapshot | null = null;
  private echoes: Echo[] = [];
  private selfId = '';
  private clockOffset = 0;
  private positions = new Map<string, { from: P; to: P; at: number }>();
  private particles: { x: number; y: number; vx: number; vy: number; life: number; color: number }[] = [];
  private lastAnnouncement = -1;
  constructor() { super('Arena'); }
  create() {
    this.cameras.main.setBackgroundColor('#070b18');
    this.base = this.add.graphics(); this.fx = this.add.graphics();
    this.drawBase();
  }
  setData(snapshot: Snapshot | null, echoes: Echo[], selfId: string) {
    if (snapshot) {
      const now = performance.now();
      for (const p of snapshot.players) {
        const existing = this.positions.get(p.id);
        const from = existing ? { x: Phaser.Math.Linear(existing.from.x, existing.to.x, clamp((now - existing.at) / 80, 0, 1)), y: Phaser.Math.Linear(existing.from.y, existing.to.y, clamp((now - existing.at) / 80, 0, 1)) } : { x: p.x, y: p.y };
        this.positions.set(p.id, { from, to: { x: p.x, y: p.y }, at: now });
      }
      this.clockOffset = snapshot.serverNow - Date.now();
      if (snapshot.announcementId !== this.lastAnnouncement) {
        this.lastAnnouncement = snapshot.announcementId;
        if (/STOLEN|DROPPED|SUCCESS|FRACTURE|ZAPPED/.test(snapshot.announcement)) this.cameras.main.shake(190, .0025);
        if (/STOLEN|SUCCESS|UNLOCKED/.test(snapshot.announcement)) this.burst(snapshot.core.x, snapshot.core.y, snapshot.announcement === 'EXTRACTION SUCCESS' ? C.lime : C.cyan, 26);
      }
    }
    this.snap = snapshot; this.echoes = echoes; this.selfId = selfId;
  }
  private burst(x: number, y: number, color: number, count: number) {
    for (let i = 0; i < count; i++) { const a = Math.random() * Math.PI * 2, speed = Math.random() * 4 + 1; this.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 24 + Math.random() * 18, color }); }
  }
  private drawBase() {
    const g = this.base;
    g.fillStyle(C.bg).fillRect(0, 0, WIDTH, HEIGHT);
    g.fillStyle(0x0c1428).fillRoundedRect(28, 82, 1224, 610, 20);
    g.lineStyle(2, 0x2c4364).strokeRoundedRect(28, 82, 1224, 610, 20);
    g.lineStyle(1, C.grid, .5);
    for (let x = 48; x < 1240; x += 40) g.lineBetween(x, 96, x, 682);
    for (let y = 102; y < 684; y += 40) g.lineBetween(42, y, 1238, y);
    for (let x = 84; x < 1240; x += 80) for (let y = 122; y < 690; y += 80) { g.fillStyle(0x243a58, .65).fillCircle(x, y, 1.5); }
    // Path lanes and symmetric etched motifs.
    g.fillStyle(0x101d35, .72).fillRoundedRect(72, 313, 1136, 94, 18);
    g.lineStyle(1, 0x365076, .55).strokeRoundedRect(72, 313, 1136, 94, 18);
    g.fillStyle(0x111d34).fillRoundedRect(416, 168, 448, 384, 24);
    g.lineStyle(1, 0x33476a, .8).strokeRoundedRect(416, 168, 448, 384, 24);
    for (let x = 445; x < 850; x += 36) { g.lineStyle(1, 0x263a59, .6).lineBetween(x, 180, x + 25, 180); g.lineBetween(x, 540, x + 25, 540); }
    // Vault floor.
    g.fillStyle(0x19223e).fillRoundedRect(516, 308, 248, 104, 8);
    g.lineStyle(2, 0x6670a4, .8).strokeRoundedRect(516, 308, 248, 104, 8);
    g.lineStyle(1, C.violet, .28).strokeCircle(CORE_HOME.x, CORE_HOME.y, 82);
    g.lineStyle(2, C.violet, .45).strokeCircle(CORE_HOME.x, CORE_HOME.y, 65);
    for (const w of WALLS) {
      g.fillStyle(0x050b18, .9).fillRoundedRect(w.x + 5, w.y + 7, w.w, w.h, 5);
      g.fillStyle(C.wall).fillRoundedRect(w.x, w.y, w.w, w.h, 5);
      g.fillStyle(0x253957).fillRect(w.x + 3, w.y + 3, w.w - 6, 5);
      g.lineStyle(1, 0x52678e, .75).strokeRoundedRect(w.x, w.y, w.w, w.h, 5);
      if (w.h > 80) for (let y = w.y + 22; y < w.y + w.h - 10; y += 28) { g.lineStyle(2, C.cyan, .16).lineBetween(w.x + 8, y, w.x + w.w - 8, y); }
    }
    for (const [i, zone] of EXTRACT.entries()) {
      const color = i === 0 ? C.cyan : C.violet;
      g.fillStyle(color, .055).fillCircle(zone.x, zone.y, 76);
      g.lineStyle(2, color, .4).strokeCircle(zone.x, zone.y, 66);
      g.lineStyle(4, color, .85).strokeCircle(zone.x, zone.y, 51);
      g.lineStyle(1, color, .35).strokeCircle(zone.x, zone.y, 35);
      for (let a = 0; a < 4; a++) {
        const angle = a * Math.PI / 2; g.lineStyle(4, color, .65).lineBetween(zone.x + Math.cos(angle) * 72, zone.y + Math.sin(angle) * 72, zone.x + Math.cos(angle) * 89, zone.y + Math.sin(angle) * 89);
      }
    }
    for (const x of [437, 843]) {
      g.fillStyle(0x351729).fillRoundedRect(x - 17, 301, 34, 14, 4);
      g.fillStyle(0x351729).fillRoundedRect(x - 17, 405, 34, 14, 4);
      g.lineStyle(1, C.red, .5).strokeRoundedRect(x - 17, 301, 34, 14, 4).strokeRoundedRect(x - 17, 405, 34, 14, 4);
    }
    // Borders and meter details.
    g.fillStyle(C.cyan, .8).fillRect(42, 94, 102, 3);
    g.fillStyle(C.violet, .8).fillRect(1136, 94, 102, 3);
    g.lineStyle(1, C.cyan, .26).lineBetween(44, 665, 165, 665);
    g.lineStyle(1, C.violet, .26).lineBetween(1115, 665, 1236, 665);
  }
  private ring(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, alpha: number, width = 2) { g.lineStyle(width, color, alpha).strokeCircle(x, y, r); }
  private drawAgent(g: Phaser.GameObjects.Graphics, p: P & { facing: number; team: number; carries?: boolean; stunned?: boolean }, alpha: number, ghost: boolean, t: number, self = false) {
    const color = p.team === 0 ? C.cyan : C.violet;
    const pulse = Math.sin(t * .009 + p.x) * 1.5;
    g.fillStyle(0x000000, ghost ? .08 : .32).fillEllipse(p.x + 3, p.y + 13, 34, 14);
    if (self && !ghost) { this.ring(g, p.x, p.y, 25 + pulse, color, .52, 2); this.ring(g, p.x, p.y, 29 + pulse, color, .1, 5); }
    if (ghost) this.ring(g, p.x, p.y, 20 + pulse, color, .22, 2);
    const angle = p.facing;
    const cs = Math.cos(angle), sn = Math.sin(angle);
    const pt = (u: number, v: number): P => ({ x: p.x + u * cs - v * sn, y: p.y + u * sn + v * cs });
    const poly = (points: P[], col: number, a: number) => { g.fillStyle(col, a * alpha).fillPoints(points, true); };
    poly([pt(-18,-14),pt(-5,-13),pt(-5,-6),pt(-18,-5)], 0x17233b, ghost ? .4 : 1);
    poly([pt(-18,5),pt(-5,6),pt(-5,13),pt(-18,14)], 0x17233b, ghost ? .4 : 1);
    poly([pt(-9,-13),pt(10,-11),pt(18,-5),pt(18,5),pt(10,11),pt(-9,13),pt(-16,4),pt(-16,-4)], ghost ? color : 0x1b2843, ghost ? .35 : 1);
    poly([pt(-9,-10),pt(8,-8),pt(12,0),pt(8,8),pt(-9,10)], ghost ? 0xffffff : 0x384a6d, ghost ? .2 : 1);
    poly([pt(8,-9),pt(18,-6),pt(20,0),pt(18,6),pt(8,9)], color, ghost ? .6 : 1);
    poly([pt(13,-6),pt(20,-4),pt(20,4),pt(13,6)], 0xe6ffff, ghost ? .46 : 1);
    const chest = pt(-3,0); g.fillStyle(color, ghost ? .48 : 1).fillCircle(chest.x, chest.y, 3);
    if (p.carries) { this.ring(g, p.x, p.y, 28 + pulse, C.lime, .6, 3); }
    if (p.stunned) { this.ring(g, p.x, p.y, 24, C.red, .7, 3); }
  }
  update(time: number, delta: number) {
    const s = this.snap; if (!s) return;
    const g = this.fx; g.clear();
    const now = Date.now() + this.clockOffset;
    const elapsed = clamp(now - (s.loopEndsAt - 20000), 0, 20000);
    const breath = Math.sin(time * .003);
    // Animated extraction beams and circuit details.
    EXTRACT.forEach((zone, i) => { const col = i === 0 ? C.cyan : C.violet; this.ring(g, zone.x, zone.y, 45 + breath * 2, col, .42, 2); this.ring(g, zone.x, zone.y, 74 + (time * .025) % 22, col, .08, 2); });
    // Plates: the center glyph visibly latches when a live agent or echo occupies it.
    PLATES.forEach((plate, i) => {
      const active = s.plates[i]; const color = active ? C.lime : C.amber;
      g.fillStyle(color, active ? .24 : .1).fillCircle(plate.x, plate.y, 37 + breath * 2);
      this.ring(g, plate.x, plate.y, 32, color, active ? 1 : .75, 3);
      this.ring(g, plate.x, plate.y, 23, color, active ? .75 : .33, 1);
      g.fillStyle(color, active ? .8 : .25).fillRoundedRect(plate.x - 12, plate.y - 4, 24, 8, 2);
      for (let a = 0; a < 4; a++) { const angle = a * Math.PI / 2; g.lineStyle(2, color, .8).lineBetween(plate.x + Math.cos(angle) * 39, plate.y + Math.sin(angle) * 39, plate.x + Math.cos(angle) * 47, plate.y + Math.sin(angle) * 47); }
    });
    // Vault doors slide open horizontally.
    for (const d of DOORS) {
      if (!s.unlocked) { g.fillStyle(C.red, .12).fillRoundedRect(d.x - 6, d.y - 5, d.w + 12, d.h + 10, 5); g.fillStyle(0x3d203c).fillRoundedRect(d.x, d.y, d.w, d.h, 3); g.lineStyle(2, C.red, .95).strokeRoundedRect(d.x, d.y, d.w, d.h, 3); g.fillStyle(C.red, .8).fillRect(d.x + d.w/2 - 15, d.y + 8, 30, 6); }
      else { g.fillStyle(C.lime, .1).fillRoundedRect(d.x, d.y, d.w, d.h, 3); g.fillStyle(C.lime, .75).fillRect(d.x - 5, d.y + 4, 5, d.h - 8).fillRect(d.x + d.w, d.y + 4, 5, d.h - 8); }
    }
    // Energy vault and collectible core.
    this.ring(g, CORE_HOME.x, CORE_HOME.y, 45 + breath * 2, s.unlocked ? C.lime : C.violet, .56, 2);
    const rotation = time * .001;
    for (let i = 0; i < 4; i++) { const a = rotation + i * Math.PI / 2; g.fillStyle(s.unlocked ? C.lime : C.violet, .85).fillCircle(CORE_HOME.x + Math.cos(a) * 45, CORE_HOME.y + Math.sin(a) * 45, 3); }
    if (s.phase !== 'results' || s.core.carrier) {
      const core = s.core; const cx = core.x, cy = core.y;
      g.fillStyle(C.lime, .09).fillCircle(cx, cy, 34 + breath * 3);
      this.ring(g, cx, cy, 19 + breath * 2, C.lime, .75, 2);
      g.fillStyle(C.lime, .96).fillPoints([{x:cx,y:cy-14},{x:cx+13,y:cy},{x:cx,y:cy+14},{x:cx-13,y:cy}], true);
      g.fillStyle(0xffffff, .85).fillCircle(cx, cy, 4);
    }
    // Laser beams pulse on a deterministic server clock.
    for (const x of [437,843]) {
      const on = s.laserOn;
      g.fillStyle(C.red, on ? .12 : .025).fillRect(x - 16, 314, 32, 92);
      g.lineStyle(on ? 7 : 2, C.red, on ? .38 : .22).lineBetween(x, 315, x, 405);
      if (on) { g.lineStyle(2, 0xffd9e1, .95).lineBetween(x, 315, x, 405); g.fillStyle(C.red, .65).fillCircle(x, 314, 7).fillCircle(x, 405, 7); }
    }
    // Historical recordings all replay from their own t=0, never from a previous echo.
    if (s.phase === 'playing') for (const echo of this.echoes) {
      const frame = echoFrame(echo, elapsed); if (!frame) continue;
      const color = echo.team === 0 ? C.cyan : C.violet;
      for (let t = 280; t <= 900; t += 310) { const past = echoFrame(echo, Math.max(0, elapsed - t)); if (past) g.fillStyle(color, .1 - t / 15000).fillCircle(past.x, past.y, 14 - t / 140); }
      this.drawAgent(g, { ...frame, team: echo.team }, .46, true, time);
      this.ring(g, frame.x, frame.y, 16 + breath, color, .22, 2);
    }
    for (const p of s.players) {
      if (!p.connected) continue;
      const tween = this.positions.get(p.id); const f = tween ? clamp((performance.now() - tween.at) / 80, 0, 1) : 1;
      const pos = tween ? { x: Phaser.Math.Linear(tween.from.x, tween.to.x, f), y: Phaser.Math.Linear(tween.from.y, tween.to.y, f) } : p;
      this.drawAgent(g, { ...pos, facing: p.facing, team: p.team, carries: p.carries, stunned: now < p.stunnedUntil }, 1, false, time, p.id === this.selfId);
      if (p.carries) { g.fillStyle(C.lime, .11).fillCircle(pos.x, pos.y, 34); }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.x += p.vx * delta / 16; p.y += p.vy * delta / 16; p.life -= delta / 16;
      if (p.life <= 0) this.particles.splice(i, 1); else g.fillStyle(p.color, p.life / 42).fillCircle(p.x, p.y, Math.max(1, p.life / 10));
    }
  }
}

export function mountArena(parent: HTMLElement) {
  return new Phaser.Game({ type: Phaser.AUTO, parent, width: WIDTH, height: HEIGHT, backgroundColor: '#070b18', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, render: { antialias: true, pixelArt: false }, scene: [ArenaScene], audio: { noAudio: true } });
}
