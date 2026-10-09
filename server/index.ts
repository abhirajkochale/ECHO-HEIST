import express from 'express';
import http from 'node:http';
import { Server, type Socket } from 'socket.io';
import { CORE_HOME, DASH_CD, DASH_MS, DASH_SPEED, DOORS, EXTRACT, HEIGHT, LOOP_MS, MAX_LOOPS, PLATES, PLAYER_RADIUS, PULSE_CD, RECORD_MS, SPAWNS, SPEED, TICK_MS, WALLS, WIDTH, VAULT, clamp, distance, echoFrame, type Core, type Echo, type Frame, type Input, type Phase, type Player, type Snapshot, type Team } from '../shared/game.ts';

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const rooms = new Map<string, Room>();
const socketRooms = new Map<string, string>();
const blankInput = (): Input => ({ x: 0, y: 0, dash: false, interact: false, pulse: false });
type Member = { player: Player; session: string; socketId: string | null; input: Input; recording: Frame[]; lastRecord: number; dashVector: { x: number; y: number }; lastPulse: boolean };

function code() { let result = ''; do { result = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''); } while (rooms.has(result)); return result; }
function safeName(value: unknown) { return String(value || 'AGENT').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 16) || 'AGENT'; }
function safeSession(value: unknown) { return String(value || '').slice(0, 80); }
function circleRect(x: number, y: number, r: number, rect: { x: number; y: number; w: number; h: number }) {
  const nx = clamp(x, rect.x, rect.x + rect.w), ny = clamp(y, rect.y, rect.y + rect.h);
  return (x - nx) ** 2 + (y - ny) ** 2 < r ** 2;
}

class Room {
  code: string;
  solo: boolean;
  phase: Phase = 'lobby';
  members = new Map<string, Member>();
  echoes: Echo[] = [];
  loop = 0;
  loopStartedAt = 0;
  loopEndsAt = 0;
  phaseEndsAt = 0;
  plates: [boolean, boolean] = [false, false];
  unlocked = false;
  core: Core = { ...CORE_HOME, carrier: null, taken: false };
  winner: Team | null = null;
  result = '';
  announcement = '';
  announcementId = 0;
  laserOn = false;
  lastActive = Date.now();
  constructor(solo: boolean) { this.code = code(); this.solo = solo; }
  announce(message: string) { this.announcement = message; this.announcementId++; }
  roster() { return [...this.members.values()].map(m => m.player); }
  add(socket: Socket, session: string, name: string): Member | null {
    const previous = [...this.members.values()].find(m => m.session === session);
    if (previous) {
      if (previous.socketId && previous.socketId !== socket.id) io.sockets.sockets.get(previous.socketId)?.disconnect(true);
      previous.socketId = socket.id; previous.player.connected = true; previous.input = blankInput();
      this.attach(socket); return previous;
    }
    if (this.phase !== 'lobby' || this.members.size >= 4 || this.solo) return null;
    const team: Team = this.members.size % 2 as Team;
    const spawn = SPAWNS[team];
    const player: Player = { id: session, name, team, host: this.members.size === 0, connected: true, x: spawn.x, y: spawn.y, facing: team === 0 ? 0 : Math.PI, dashUntil: 0, dashReady: 0, pulseReady: 0, stunnedUntil: 0, steals: 0, dashes: 0, carries: false };
    const member: Member = { player, session, socketId: socket.id, input: blankInput(), recording: [], lastRecord: 0, dashVector: { x: 0, y: 0 }, lastPulse: false };
    this.members.set(session, member); this.attach(socket); this.announce(`${player.name.toUpperCase()} CONNECTED`); return member;
  }
  attach(socket: Socket) { socket.join(this.code); socketRooms.set(socket.id, this.code); socket.emit('room:joined', { code: this.code }); socket.emit('game:echoes', this.echoes); this.broadcast(); }
  remove(session: string) {
    const m = this.members.get(session); if (!m) return;
    if (this.core.carrier === session) this.dropCore(m.player.x, m.player.y);
    this.members.delete(session);
    if (m.socketId) { socketRooms.delete(m.socketId); io.sockets.sockets.get(m.socketId)?.leave(this.code); }
    const first = this.members.values().next().value as Member | undefined;
    for (const item of this.members.values()) item.player.host = item === first;
    if (!this.members.size) rooms.delete(this.code);
    else { if (this.phase !== 'lobby' && !this.solo && this.members.size < 2) this.end(null, 'CREW DISCONNECTED'); this.broadcast(); }
  }
  disconnect(socketId: string) {
    const m = [...this.members.values()].find(x => x.socketId === socketId);
    if (!m) return;
    m.socketId = null; m.player.connected = false; m.input = blankInput();
    if (m.player.carries) this.dropCore(m.player.x, m.player.y);
    this.broadcast();
  }
  start() {
    if (this.phase !== 'lobby' && this.phase !== 'results') return;
    if (!this.solo && this.members.size < 2) return;
    this.echoes = []; this.loop = 0; this.winner = null; this.result = '';
    for (const m of this.members.values()) { m.player.steals = 0; m.player.dashes = 0; m.player.dashReady = 0; m.player.pulseReady = 0; m.player.stunnedUntil = 0; }
    this.phase = 'countdown'; this.phaseEndsAt = Date.now() + 2400; this.announce('PREPARE TO FRACTURE');
    io.to(this.code).emit('game:echoes', this.echoes); this.broadcast();
  }
  startLoop(now: number) {
    this.loop++; this.phase = 'playing'; this.loopStartedAt = now; this.loopEndsAt = now + LOOP_MS;
    this.plates = [false, false]; this.unlocked = false; this.laserOn = false;
    this.core = { ...CORE_HOME, carrier: null, taken: false };
    for (const m of this.members.values()) {
      const spawn = SPAWNS[m.player.team];
      m.player.x = spawn.x + (m.player.team === 0 ? 1 : -1) * (this.roster().filter(p => p.team === m.player.team).indexOf(m.player) * 30);
      m.player.y = spawn.y; m.player.carries = false; m.player.stunnedUntil = 0; m.player.dashUntil = 0;
      m.recording = [{ t: 0, x: m.player.x, y: m.player.y, facing: m.player.facing, interact: false }]; m.lastRecord = 0;
    }
    this.announce(this.loop === 1 ? 'LOOP START' : 'TIMELINE FRACTURE');
    io.to(this.code).emit('game:echoes', this.echoes);
  }
  finishLoop(now: number) {
    for (const m of this.members.values()) {
      if (!m.recording.length) continue;
      this.echoes.push({ id: `${m.session}-${this.loop}`, owner: m.session, name: m.player.name, team: m.player.team, loop: this.loop, frames: m.recording });
    }
    if (this.loop >= MAX_LOOPS) { this.end(null, 'TIME COLLAPSE'); return; }
    this.phase = 'transition'; this.phaseEndsAt = now + 1500;
    this.announce(`${this.echoes.length} ECHO${this.echoes.length === 1 ? '' : 'ES'} CREATED`);
  }
  end(winner: Team | null, result: string) {
    if (this.phase === 'results') return;
    this.winner = winner; this.result = result; this.phase = 'results'; this.announce(result);
    this.broadcast();
  }
  dropCore(x: number, y: number) {
    if (!this.core.carrier) return;
    const m = this.members.get(this.core.carrier); if (m) m.player.carries = false;
    this.core.carrier = null; this.core.x = clamp(x, 35, WIDTH - 35); this.core.y = clamp(y, 35, HEIGHT - 35); this.core.taken = true; this.announce('CORE DROPPED');
  }
  valid(x: number, y: number) {
    if (x < 41 || x > WIDTH - 41 || y < 93 || y > HEIGHT - 41) return false;
    for (const wall of WALLS) if (circleRect(x, y, PLAYER_RADIUS, wall)) return false;
    if (!this.unlocked) for (const door of DOORS) if (circleRect(x, y, PLAYER_RADIUS, door)) return false;
    return true;
  }
  move(m: Member, dx: number, dy: number) {
    const p = m.player;
    if (this.valid(p.x + dx, p.y)) p.x += dx;
    if (this.valid(p.x, p.y + dy)) p.y += dy;
  }
  tick(now: number) {
    if (this.phase === 'countdown' && now >= this.phaseEndsAt) this.startLoop(now);
    if (this.phase === 'transition' && now >= this.phaseEndsAt) this.startLoop(now);
    if (this.phase !== 'playing') { this.broadcast(); return; }
    if (now >= this.loopEndsAt) { this.finishLoop(now); this.broadcast(); return; }
    const elapsed = now - this.loopStartedAt;
    this.laserOn = elapsed % 4000 >= 1700 && elapsed % 4000 < 2450;
    for (const m of this.members.values()) {
      const p = m.player; if (!p.connected) continue;
      const input = m.input;
      let x = clamp(input.x, -1, 1), y = clamp(input.y, -1, 1);
      const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; }
      if (length > 0.01) p.facing = Math.atan2(y, x);
      if (input.dash && now >= p.dashReady && length > 0.1 && now >= p.stunnedUntil) {
        p.dashUntil = now + DASH_MS; p.dashReady = now + DASH_CD; p.dashes++; m.dashVector = { x, y }; this.announce(`${p.name.toUpperCase()} DASHED`);
      }
      const dashing = now < p.dashUntil;
      const speed = now < p.stunnedUntil ? SPEED * .3 : dashing ? DASH_SPEED : SPEED;
      this.move(m, (dashing ? m.dashVector.x : x) * speed * TICK_MS / 1000, (dashing ? m.dashVector.y : y) * speed * TICK_MS / 1000);
      if (this.laserOn && ((Math.abs(p.x - 437) < 13 || Math.abs(p.x - 843) < 13) && p.y > 315 && p.y < 405) && now >= p.stunnedUntil) {
        p.stunnedUntil = now + 1050; if (p.carries) this.dropCore(p.x, p.y); this.announce(`${p.name.toUpperCase()} ZAPPED`);
      }
      if (input.pulse && !m.lastPulse && now >= p.pulseReady && now >= p.stunnedUntil) {
        p.pulseReady = now + PULSE_CD; this.announce(`${p.name.toUpperCase()} PULSE`);
        for (const target of this.members.values()) if (target !== m && target.player.team !== p.team && target.player.connected && distance(p, target.player) < 112) {
          target.player.stunnedUntil = now + 1050; if (target.player.carries) this.dropCore(target.player.x, target.player.y);
        }
      }
      m.lastPulse = input.pulse;
      if (elapsed - m.lastRecord >= RECORD_MS) {
        m.recording.push({ t: elapsed, x: p.x, y: p.y, facing: p.facing, interact: input.interact }); m.lastRecord = elapsed;
      }
    }
    const occupancy: [boolean, boolean] = [false, false];
    for (let i = 0; i < 2; i++) {
      occupancy[i] = [...this.members.values()].some(m => m.player.connected && distance(m.player, PLATES[i]) < 30);
      if (!occupancy[i]) occupancy[i] = this.echoes.some(e => { const f = echoFrame(e, elapsed); return f !== null && distance(f, PLATES[i]) < 30; });
    }
    const wasUnlocked = this.unlocked;
    this.plates = occupancy; this.unlocked = occupancy[0] && occupancy[1];
    if (!wasUnlocked && this.unlocked) this.announce('VAULT UNLOCKED');
    if (wasUnlocked && !this.unlocked) {
      // Closing doors push agents out rather than trapping them between solid walls.
      for (const m of this.members.values()) {
        const p = m.player;
        if (p.x > VAULT.x - PLAYER_RADIUS && p.x < VAULT.x + VAULT.w + PLAYER_RADIUS && p.y > VAULT.y && p.y < VAULT.y + VAULT.h) {
          if (p.carries) this.dropCore(CORE_HOME.x, CORE_HOME.y);
          p.y = p.y < CORE_HOME.y ? VAULT.y - PLAYER_RADIUS - 2 : VAULT.y + VAULT.h + PLAYER_RADIUS + 2;
          p.stunnedUntil = now + 250;
        }
      }
    }
    if (this.core.carrier) {
      const carrier = this.members.get(this.core.carrier)?.player;
      if (carrier) {
        this.core.x = carrier.x; this.core.y = carrier.y - 25;
        const zone = EXTRACT[carrier.team];
        if (distance(carrier, zone) < zone.r - 4) { this.end(carrier.team, 'EXTRACTION SUCCESS'); return; }
      }
    } else {
      for (const m of this.members.values()) {
        const p = m.player;
        if (!p.connected || !m.input.interact || now < p.stunnedUntil) continue;
        const coreInsideVault = this.core.x > VAULT.x && this.core.x < VAULT.x + VAULT.w && this.core.y > VAULT.y && this.core.y < VAULT.y + VAULT.h;
        if (distance(p, this.core) < 47 && (this.unlocked || (this.core.taken && !coreInsideVault))) {
          this.core.carrier = p.id; this.core.taken = true; p.carries = true; p.steals++; this.announce('CORE STOLEN'); break;
        }
      }
    }
    this.broadcast();
  }
  snapshot(now = Date.now()): Snapshot { return { code: this.code, phase: this.phase, solo: this.solo, players: this.roster(), loop: this.loop, loopEndsAt: this.loopEndsAt, phaseEndsAt: this.phaseEndsAt, serverNow: now, echoCount: this.echoes.length, plates: this.plates, unlocked: this.unlocked, core: this.core, winner: this.winner, result: this.result, announcement: this.announcement, announcementId: this.announcementId, laserOn: this.laserOn }; }
  broadcast() { io.to(this.code).emit('game:snapshot', this.snapshot()); }
}

function respond(socket: Socket, callback: unknown, data: { ok: boolean; error?: string; code?: string }) { if (typeof callback === 'function') callback(data); else socket.emit('room:error', data.error || 'Unable to join'); }
function membership(socket: Socket) { const room = rooms.get(socketRooms.get(socket.id) || ''); const member = room && [...room.members.values()].find(m => m.socketId === socket.id); return { room, member }; }
io.on('connection', socket => {
  socket.on('room:create', (payload: { session?: string; name?: string }, callback) => {
    const session = safeSession(payload?.session); if (!session) return respond(socket, callback, { ok: false, error: 'Session unavailable' });
    const prior = membership(socket); if (prior.room && prior.member) prior.room.remove(prior.member.session);
    const room = new Room(false); rooms.set(room.code, room); room.add(socket, session, safeName(payload?.name)); respond(socket, callback, { ok: true, code: room.code });
  });
  socket.on('room:solo', (payload: { session?: string; name?: string }, callback) => {
    const session = safeSession(payload?.session); if (!session) return respond(socket, callback, { ok: false, error: 'Session unavailable' });
    const prior = membership(socket); if (prior.room && prior.member) prior.room.remove(prior.member.session);
    const room = new Room(false); rooms.set(room.code, room); room.add(socket, session, safeName(payload?.name)); room.solo = true; room.start(); respond(socket, callback, { ok: true, code: room.code });
  });
  socket.on('room:join', (payload: { code?: string; session?: string; name?: string }, callback) => {
    const room = rooms.get(String(payload?.code || '').toUpperCase().trim());
    if (!room) return respond(socket, callback, { ok: false, error: 'Room not found' });
    const session = safeSession(payload?.session); if (!session) return respond(socket, callback, { ok: false, error: 'Session unavailable' });
    const existing = [...room.members.values()].find(m => m.session === session);
    if (!existing && room.solo) return respond(socket, callback, { ok: false, error: 'Solo room is private' });
    if (!existing && room.phase !== 'lobby') return respond(socket, callback, { ok: false, error: 'Match already started' });
    if (!existing && room.members.size >= 4) return respond(socket, callback, { ok: false, error: 'Room is full' });
    const prior = membership(socket); if (prior.room && prior.member && prior.room !== room) prior.room.remove(prior.member.session);
    room.add(socket, session, safeName(payload?.name)); respond(socket, callback, { ok: true, code: room.code });
  });
  socket.on('room:leave', () => { const { room, member } = membership(socket); if (room && member) room.remove(member.session); socket.emit('room:left'); });
  socket.on('room:start', () => { const { room, member } = membership(socket); if (room && member?.player.host) room.start(); });
  socket.on('game:input', (raw: Input) => { const { room, member } = membership(socket); if (!room || !member || room.phase !== 'playing') return; member.input = { x: Number.isFinite(raw?.x) ? clamp(raw.x, -1, 1) : 0, y: Number.isFinite(raw?.y) ? clamp(raw.y, -1, 1) : 0, dash: raw?.dash === true, interact: raw?.interact === true, pulse: raw?.pulse === true }; });
  socket.on('disconnect', () => { const room = rooms.get(socketRooms.get(socket.id) || ''); room?.disconnect(socket.id); socketRooms.delete(socket.id); });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    room.tick(now);
    if ([...room.members.values()].every(m => !m.player.connected) && now - room.lastActive > 60_000) rooms.delete(room.code);
    if ([...room.members.values()].some(m => m.player.connected)) room.lastActive = now;
  }
}, TICK_MS);

const port = Number(process.env.PORT || 3001);
server.listen(port, '0.0.0.0', () => console.log(`ECHO HEIST server listening on ${port}`));
