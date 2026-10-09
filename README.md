# ECHO HEIST

A server-authoritative multiplayer time-loop heist game for 2–4 players, with a solo practice mode.

## Run locally

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. Vite serves the client on port **5173** and proxies Socket.IO to the Express game server on port **3001**. `npm run build` runs TypeScript checks and creates a production client build. The server can be started with `npm start` (set `PORT` to change its default 3001).

For LAN play, open `http://<your-computer-LAN-IP>:5173` on other devices. The Vite dev server listens on all interfaces and proxies Socket.IO to the local server. Allow port 5173 through the host firewall if needed.

## Rules

- Create a room and share its six-character code. A host can start with 2–4 players. Solo Practice starts immediately.
- Move with WASD or arrow keys. Hold **E** or **Space** near the core to pick it up. **Shift** dashes; **F** sends a short stun pulse at nearby opponents.
- The vault opens only while **both pressure plates** are occupied. Historical echoes can occupy plates.
- Every **20 seconds**, the server resets live agents and creates echoes from their recorded path. All previous echoes replay their own original timeline simultaneously.
- Carry the core to your team's extraction zone. The first valid extraction wins. The match ends in a stalemate after eight loops.
- Red laser beams temporarily stun carriers and drop the core.

There is no database or account system. Rooms and recordings live in server memory and are lost when the server restarts. A tab refresh can recover a session while that room still exists.
