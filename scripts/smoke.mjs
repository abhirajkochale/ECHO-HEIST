import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const url = process.env.TEST_SERVER || 'http://127.0.0.1:3001';
const a = io(url, { reconnection: false });
const b = io(url, { reconnection: false });
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, timeout = 8000) {
  const start = Date.now();
  while (!test()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for game state'); await wait(40); }
}
async function ack(socket, event, payload) { return new Promise((resolve, reject) => socket.timeout(5000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result))); }
let sa, sb, echoes = [];
a.on('game:snapshot', s => { sa = s; }); b.on('game:snapshot', s => { sb = s; }); a.on('game:echoes', e => { echoes = e; });
await until(() => a.connected && b.connected);
const made = await ack(a, 'room:create', { session: 'smoke-host', name: 'HOST' });
assert(made.ok && made.code?.length === 6);
const joined = await ack(b, 'room:join', { session: 'smoke-guest', name: 'GUEST', code: made.code });
assert(joined.ok);
await until(() => sa?.players.length === 2 && sb?.players.length === 2);
assert.equal(sa.players[0].team, 0); assert.equal(sa.players[1].team, 1);
a.emit('room:start'); await until(() => sa?.phase === 'playing', 8000);
const firstX = sa.players.find(p => p.id === 'smoke-host').x;
const move = setInterval(() => a.emit('game:input', { x: 1, y: 0, dash: false, interact: false, pulse: false }), 40);
await wait(400); clearInterval(move);
await until(() => sa?.players.find(p => p.id === 'smoke-host').x > firstX + 30);
assert(Math.abs(sa.loopEndsAt - sb.loopEndsAt) < 50);
console.log('PASS: room create/join, balanced teams, synchronized start, authoritative movement');
a.emit('room:leave'); b.emit('room:leave');

const solo = await ack(a, 'room:solo', { session: 'smoke-host', name: 'SOLO' });
assert(solo.ok);
await until(() => sa?.phase === 'playing' && sa.solo, 8000);
const routes = {
  1: [{ x: 465, y: 360 }, { x: 465, y: 210 }, { x: 555, y: 210 }],
  2: [{ x: 465, y: 360 }, { x: 465, y: 510 }, { x: 725, y: 510 }],
  3: [{ x: 465, y: 360 }, { x: 465, y: 245 }, { x: 640, y: 245 }, { x: 640, y: 360 }],
};
const exitRoute = [{ x: 640, y: 245 }, { x: 465, y: 245 }, { x: 465, y: 360 }, { x: 206, y: 360 }, { x: 120, y: 360 }];
let currentLoop = 0, index = 0, exitIndex = 0, carrying = false, sawVault = false, sawEcho = false;
const drive = setInterval(() => {
  if (!sa || sa.phase !== 'playing') return;
  const p = sa.players.find(item => item.id === 'smoke-host'); if (!p) return;
  if (sa.loop !== currentLoop) { currentLoop = sa.loop; index = 0; exitIndex = 0; carrying = false; }
  if (sa.echoCount > 0 && echoes.length > 0) sawEcho = true;
  if (sa.unlocked) sawVault = true;
  if (p.carries) carrying = true;
  const route = carrying ? exitRoute : routes[sa.loop] || [];
  let step = carrying ? exitIndex : index;
  while (step < route.length && Math.hypot(p.x - route[step].x, p.y - route[step].y) < 9) step++;
  if (carrying) exitIndex = step; else index = step;
  const target = route[step];
  let x = 0, y = 0;
  if (target) { const dx = target.x - p.x, dy = target.y - p.y, len = Math.hypot(dx, dy); x = dx / len; y = dy / len; }
  if (carrying && p.x >= 435 && p.x <= 470 && p.y > 315 && p.y < 405 && x < 0 && sa.laserOn) { x = 0; y = 0; }
  a.emit('game:input', { x, y, dash: false, interact: sa.loop >= 3, pulse: false });
}, 40);
try {
  await until(() => sa?.phase === 'results', 75_000);
  assert(sawEcho, 'Historical echo created and delivered');
  assert(sawVault, 'Echoes opened the vault');
  assert.equal(sa.winner, 0, `Expected extraction, got ${sa.result}`);
  assert.equal(sa.result, 'EXTRACTION SUCCESS');
  console.log(`PASS: solo echoes replayed, vault opened, core extracted in loop ${sa.loop}`);
  a.emit('room:start');
  await until(() => sa?.phase === 'countdown' && sa.echoCount === 0);
  await until(() => sa?.phase === 'playing' && sa.loop === 1, 8000);
  assert.equal(sa.players[0].steals, 0);
  console.log('PASS: Play Again resets recordings, stats, and loop state');
} finally { clearInterval(drive); a.disconnect(); b.disconnect(); }
