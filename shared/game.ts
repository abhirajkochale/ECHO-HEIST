export const WIDTH = 1280;
export const HEIGHT = 720;
export const LOOP_MS = 20_000;
export const MAX_LOOPS = 8;
export const TICK_MS = 40;
export const RECORD_MS = 80;
export const SPEED = 210;
export const DASH_SPEED = 630;
export const DASH_MS = 170;
export const DASH_CD = 4000;
export const PULSE_CD = 6500;
export const PLAYER_RADIUS = 17;
export const PLATES = [{ x: 555, y: 210 }, { x: 725, y: 510 }];
export const VAULT = { x: 567, y: 286, w: 146, h: 148 };
export const CORE_HOME = { x: 640, y: 360 };
export const EXTRACT = [{ x: 120, y: 360, r: 52 }, { x: 1160, y: 360, r: 52 }];
export const SPAWNS = [{ x: 206, y: 360 }, { x: 1074, y: 360 }];
export const WALLS = [
  { x: 366, y: 136, w: 34, h: 172 }, { x: 366, y: 412, w: 34, h: 172 },
  { x: 880, y: 136, w: 34, h: 172 }, { x: 880, y: 412, w: 34, h: 172 },
  { x: 488, y: 286, w: 28, h: 148 }, { x: 764, y: 286, w: 28, h: 148 },
  { x: 516, y: 286, w: 51, h: 22 }, { x: 713, y: 286, w: 51, h: 22 },
  { x: 516, y: 412, w: 51, h: 22 }, { x: 713, y: 412, w: 51, h: 22 },
];
export const DOORS = [{ x: 567, y: 286, w: 146, h: 22 }, { x: 567, y: 412, w: 146, h: 22 }];
export type Team = 0 | 1;
export type Phase = 'lobby' | 'countdown' | 'playing' | 'transition' | 'results';
export type Input = { x: number; y: number; dash: boolean; interact: boolean; pulse: boolean };
export type Frame = { t: number; x: number; y: number; facing: number; interact: boolean };
export type Echo = { id: string; owner: string; name: string; team: Team; loop: number; frames: Frame[] };
export type Player = { id: string; name: string; team: Team; host: boolean; connected: boolean; x: number; y: number; facing: number; dashUntil: number; dashReady: number; pulseReady: number; stunnedUntil: number; steals: number; dashes: number; carries: boolean };
export type Core = { x: number; y: number; carrier: string | null; taken: boolean };
export type Snapshot = { code: string; phase: Phase; solo: boolean; players: Player[]; loop: number; loopEndsAt: number; phaseEndsAt: number; serverNow: number; echoCount: number; plates: [boolean, boolean]; unlocked: boolean; core: Core; winner: Team | null; result: string; announcement: string; announcementId: number; laserOn: boolean };

export function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
export function distance(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function echoFrame(echo: Echo, elapsed: number): Frame | null {
  const fs = echo.frames;
  if (!fs.length || elapsed < fs[0].t) return null;
  let lo = 0, hi = fs.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fs[mid].t <= elapsed) lo = mid; else hi = mid - 1; }
  const a = fs[lo], b = fs[Math.min(lo + 1, fs.length - 1)];
  if (a === b) return a;
  const f = clamp((elapsed - a.t) / Math.max(1, b.t - a.t), 0, 1);
  return { t: elapsed, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, facing: a.facing, interact: a.interact };
}
