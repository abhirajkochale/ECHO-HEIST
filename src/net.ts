import { io, type Socket } from 'socket.io-client';
import type { Echo, Input, Snapshot } from '../shared/game.ts';

const sessionKey = 'echo-heist-session';
let session = sessionStorage.getItem(sessionKey);
if (!session) { session = crypto.randomUUID(); sessionStorage.setItem(sessionKey, session); }
export const sessionId = session;
export const socket: Socket = io({ autoConnect: true, reconnection: true, reconnectionDelay: 600, reconnectionAttempts: Infinity });
export type RoomResponse = { ok: boolean; code?: string; error?: string };
export function request(event: 'room:create' | 'room:join' | 'room:solo', payload: object): Promise<RoomResponse> {
  return new Promise(resolve => {
    if (!socket.connected) { resolve({ ok: false, error: 'Connecting to server. Try again in a moment.' }); return; }
    socket.timeout(5000).emit(event, { ...payload, session: sessionId }, (err: Error | null, response: RoomResponse) => resolve(err ? { ok: false, error: 'Server did not respond' } : response));
  });
}
export function sendInput(input: Input) { if (socket.connected) socket.emit('game:input', input); }
export type GameData = { snapshot: Snapshot | null; echoes: Echo[] };
