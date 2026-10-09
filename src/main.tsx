import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type Phaser from 'phaser';
import { DASH_CD, LOOP_MS, MAX_LOOPS, PULSE_CD, type Echo, type Input, type Snapshot } from '../shared/game.ts';
import { ArenaScene, mountArena } from './Arena.ts';
import { request, sendInput, sessionId, socket } from './net.ts';
import { setMuted, sound } from './audio.ts';
import './style.css';

type Screen = 'menu' | 'join' | 'how' | 'lobby' | 'game';
const teamName = (team: number) => team === 0 ? 'CYAN' : 'MAGENTA';
function Icon({ type }: { type: 'bolt' | 'loop' | 'core' | 'cross' }) {
  return <span className={`icon icon-${type}`} aria-hidden="true">{type === 'bolt' ? 'ϟ' : type === 'loop' ? '↺' : type === 'core' ? '◇' : '✕'}</span>;
}
function Arena({ snapshot, echoes }: { snapshot: Snapshot | null; echoes: Echo[] }) {
  const holder = useRef<HTMLDivElement>(null); const game = useRef<Phaser.Game | null>(null);
  useEffect(() => { if (!holder.current) return; game.current = mountArena(holder.current); return () => { game.current?.destroy(true); game.current = null; }; }, []);
  useEffect(() => { const scene = game.current?.scene.getScene('Arena') as ArenaScene | undefined; if (scene?.sys.isActive()) scene.setData(snapshot, echoes, sessionId); }, [snapshot, echoes]);
  return <div className="arena-canvas" ref={holder} aria-label="ECHO HEIST game arena" />;
}

function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [name, setName] = useState(() => localStorage.getItem('echo-heist-name') || 'AGENT');
  const [joinCode, setJoinCode] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [echoes, setEchoes] = useState<Echo[]>([]);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(socket.connected);
  const [muted, setMute] = useState(false);
  const [showKeys, setShowKeys] = useState(true);
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [notice, setNotice] = useState('');
  const lastAnnouncement = useRef(-1);
  const roomCode = useRef(sessionStorage.getItem('echo-heist-room') || '');
  const clockOffset = useRef(0);
  const input = useRef<Input>({ x: 0, y: 0, dash: false, interact: false, pulse: false });
  const held = useRef(new Set<string>());

  useEffect(() => {
    const onConnect = () => { setConnected(true); if (roomCode.current) { void request('room:join', { code: roomCode.current, name }).then(r => { if (!r.ok) { roomCode.current = ''; sessionStorage.removeItem('echo-heist-room'); setSnapshot(null); setScreen('menu'); setError(r.error || 'Could not restore room'); } }); } };
    const onDisconnect = () => setConnected(false);
    const onJoined = ({ code }: { code: string }) => { roomCode.current = code; sessionStorage.setItem('echo-heist-room', code); };
    const onSnapshot = (state: Snapshot) => {
      clockOffset.current = state.serverNow - Date.now(); setSnapshot(state);
      if (state.phase === 'lobby') setScreen('lobby'); else setScreen('game');
      if (state.announcementId !== lastAnnouncement.current) {
        lastAnnouncement.current = state.announcementId; setNotice(state.announcement);
        if (/FRACTURE|LOOP START|CREATED/.test(state.announcement)) sound('loop');
        else if (/UNLOCKED/.test(state.announcement)) sound('plate');
        else if (/STOLEN/.test(state.announcement)) sound('core');
        else if (/SUCCESS/.test(state.announcement)) sound('win');
        else if (/DROPPED|ZAPPED/.test(state.announcement)) sound('hit');
      }
    };
    const onEchoes = (items: Echo[]) => setEchoes(items);
    const onLeft = () => { setScreen('menu'); setSnapshot(null); setEchoes([]); roomCode.current = ''; sessionStorage.removeItem('echo-heist-room'); };
    const onError = (message: string) => setError(message);
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect); socket.on('room:joined', onJoined); socket.on('game:snapshot', onSnapshot); socket.on('game:echoes', onEchoes); socket.on('room:left', onLeft); socket.on('room:error', onError);
    if (socket.connected) onConnect();
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('room:joined', onJoined); socket.off('game:snapshot', onSnapshot); socket.off('game:echoes', onEchoes); socket.off('room:left', onLeft); socket.off('room:error', onError); };
  }, [name]);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 1800); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target?.tagName === 'INPUT') return;
      const key = event.key.toLowerCase();
      if (['arrowup','arrowdown','arrowleft','arrowright',' ','shift'].includes(key)) event.preventDefault();
      held.current.add(key);
      if (key === 'escape' && (screen === 'how' || screen === 'join')) setScreen('menu');
    };
    const keyup = (event: KeyboardEvent) => held.current.delete(event.key.toLowerCase());
    const blur = () => held.current.clear();
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    const timer = window.setInterval(() => {
      if (screen !== 'game' || snapshot?.phase !== 'playing') return;
      const keys = held.current;
      const current: Input = { x: Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')), y: Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup')), dash: keys.has('shift'), interact: keys.has('e') || keys.has(' '), pulse: keys.has('f') };
      input.current = current; sendInput(current);
    }, 40);
    return () => { clearInterval(timer); window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); };
  }, [screen, snapshot?.phase]);

  const normalizedName = name.trim().slice(0, 16) || 'AGENT';
  const doRequest = useCallback(async (kind: 'room:create' | 'room:join' | 'room:solo') => {
    setError(''); localStorage.setItem('echo-heist-name', normalizedName); sound('click');
    const response = await request(kind, { name: normalizedName, code: joinCode.toUpperCase().trim() });
    if (!response.ok) setError(response.error || 'Could not enter room');
    else if (response.code) { roomCode.current = response.code; sessionStorage.setItem('echo-heist-room', response.code); setScreen(kind === 'room:solo' ? 'game' : 'lobby'); }
  }, [normalizedName, joinCode]);
  const leave = () => { sound('click'); socket.emit('room:leave'); setScreen('menu'); setSnapshot(null); setEchoes([]); roomCode.current = ''; sessionStorage.removeItem('echo-heist-room'); };
  const copy = async () => { if (!snapshot) return; try { await navigator.clipboard.writeText(snapshot.code); setCopied(true); setTimeout(() => setCopied(false), 1600); sound('click'); } catch { setError('Clipboard unavailable. Select the room code to copy it.'); } };
  const me = snapshot?.players.find(p => p.id === sessionId);
  const now = clock + clockOffset.current;
  const remaining = snapshot ? Math.max(0, (snapshot.loopEndsAt - now) / 1000) : 20;
  const dashRemaining = me ? Math.max(0, (me.dashReady - now) / 1000) : 0;
  const pulseRemaining = me ? Math.max(0, (me.pulseReady - now) / 1000) : 0;
  const coreLabel = snapshot?.core.carrier ? `${snapshot.players.find(p => p.id === snapshot.core.carrier)?.name || 'AGENT'} CARRYING` : snapshot?.core.taken ? 'DROPPED' : snapshot?.unlocked ? 'AVAILABLE' : 'LOCKED';
  return <div className="app-shell">
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/><div className="scanlines"/>
    <header className="topbar"><div className="brand-small" onClick={() => { if (screen === 'menu') return; if (screen === 'how' || screen === 'join') setScreen('menu'); }}><span className="brand-mark">⌁</span> ECHO<span>HEIST</span></div><div className="topbar-right"><span className={`connection ${connected ? 'online' : 'offline'}`}><i/>{connected ? 'SYSTEM ONLINE' : 'RECONNECTING'}</span><button className="icon-button" onClick={() => { setMute(!muted); setMuted(!muted); }} aria-label={muted ? 'Unmute sound' : 'Mute sound'}>{muted ? '◌' : '♫'}</button></div></header>
    {screen === 'menu' && <main className="home">
      <div className="home-copy"><div className="eyebrow"><span className="eyebrow-line"/> MULTIPLAYER TIME-LOOP HEIST <span className="eyebrow-line"/></div><h1><span className="echo-word">ECHO</span><span className="heist-word">HEIST</span></h1><div className="tagline">OUTSMART YOUR PAST. <strong>STEAL THE FUTURE.</strong></div><p className="intro">A 20-second window. One locked vault. Your past selves are the key. Race a rival crew to the core, fracture time, and pull off the impossible.</p><div className="name-field"><label htmlFor="agent-name">YOUR CALLSIGN</label><input id="agent-name" value={name} maxLength={16} onChange={e => setName(e.target.value)} placeholder="AGENT"/></div><div className="home-actions"><button className="button primary" onClick={() => void doRequest('room:create')}><Icon type="bolt"/> CREATE ROOM <span>↗</span></button><button className="button secondary" onClick={() => { sound('click'); setError(''); setScreen('join'); }}>JOIN ROOM <span>→</span></button><button className="button practice" onClick={() => void doRequest('room:solo')}><Icon type="loop"/> SOLO PRACTICE</button><button className="text-button" onClick={() => { sound('click'); setScreen('how'); }}>HOW TO PLAY <span>↗</span></button></div>{error && <div className="error-banner" role="alert">{error}</div>}</div>
      <div className="home-art" aria-hidden="true"><div className="art-halo halo-a"/><div className="art-halo halo-b"/><div className="art-grid"/><div className="art-core"><span>◇</span></div><div className="art-agent agent-a"><span>◈</span></div><div className="art-agent agent-b"><span>◈</span></div><div className="art-echo echo-a">◈</div><div className="art-echo echo-b">◈</div><div className="art-label label-a">T-20</div><div className="art-label label-b">ECHO REPLAY</div><div className="art-line line-a"/><div className="art-line line-b"/></div>
      <div className="home-footer"><div><span className="footer-num">01</span><span>ENTER THE ARENA</span></div><div><span className="footer-num">02</span><span>LEAVE YOUR ECHO</span></div><div><span className="footer-num">03</span><span>STEAL THE CORE</span></div></div>
    </main>}
    {(screen === 'join' || screen === 'how') && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setScreen('menu'); }}><div className={`modal ${screen === 'how' ? 'how-modal' : ''}`} role="dialog" aria-modal="true" aria-label={screen === 'join' ? 'Join a room' : 'How to play'}><button className="modal-close" onClick={() => setScreen('menu')} aria-label="Close">✕</button>{screen === 'join' ? <><div className="eyebrow">CONNECT TO CREW</div><h2>JOIN THE <em>HEIST.</em></h2><p>Enter the six-character room code from your host.</p><input className="code-input" autoFocus value={joinCode} maxLength={6} onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} onKeyDown={e => { if (e.key === 'Enter' && joinCode.length === 6) void doRequest('room:join'); }} placeholder="······" aria-label="Room code"/><button className="button primary full" disabled={joinCode.length !== 6} onClick={() => void doRequest('room:join')}>JOIN ROOM →</button>{error && <div className="error-banner" role="alert">{error}</div>}</> : <><div className="eyebrow">FIELD MANUAL / 001</div><h2>HOW TO <em>HEIST.</em></h2><div className="how-grid"><section><span className="how-number">01</span><h3>MOVE & SURVIVE</h3><p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys to move. <kbd>SHIFT</kbd> dashes through danger. <kbd>F</kbd> stuns nearby rivals. Lasers slow you and drop the core.</p></section><section><span className="how-number">02</span><h3>FRACTURE TIME</h3><p>Every 20 seconds, agents reset. Your translucent echoes replay the exact path you took in earlier loops. They can hold pressure plates for you.</p></section><section><span className="how-number">03</span><h3>CRACK THE VAULT</h3><p>Hold both glowing plates at once with live agents or echoes. The doors open while both are held. Press <kbd>E</kbd> or <kbd>SPACE</kbd> near the core to take it.</p></section><section><span className="how-number">04</span><h3>EXTRACT</h3><p>Carry the core into your team's glowing zone. First extraction wins. In solo mode, record yourself on one plate, then the other, and let both echoes open the vault.</p></section></div><div className="timeline-demo"><span>LOOP 01 <b>●</b> PLATE A</span><i>→</i><span>LOOP 02 <b>◎</b> ECHO A + PLATE B</span><i>→</i><span>LOOP 03 <b>◇</b> VAULT OPEN</span></div><button className="button primary full" onClick={() => setScreen('menu')}>BACK TO MENU</button></>}</div></div>}
    {screen === 'lobby' && snapshot && <main className="lobby"><div className="lobby-header"><div className="eyebrow">SECURE CHANNEL ESTABLISHED</div><h2>ASSEMBLE YOUR <em>CREW.</em></h2><p>Share your room code. Up to four agents, two teams, one core.</p></div><div className="lobby-layout"><div className="lobby-main"><div className="room-code-row"><div><small>ROOM ACCESS CODE</small><strong>{snapshot.code}</strong></div><button className="button secondary compact" onClick={() => void copy()}>{copied ? '✓ COPIED' : 'COPY CODE'}</button></div><div className="slots">{Array.from({ length: 4 }, (_, i) => { const p = snapshot.players[i]; return <div className={`slot ${p ? `team-${p.team}` : 'empty'}`} key={i}><div className="slot-avatar">{p ? '◈' : '+'}</div><div className="slot-info"><small>AGENT 0{i+1} / {p ? teamName(p.team) : 'AWAITING SIGNAL'}</small><strong>{p ? p.name : 'OPEN SLOT'}</strong></div>{p?.host && <span className="host-tag">HOST</span>}{p && !p.connected && <span className="host-tag disconnected">OFFLINE</span>}</div>; })}</div><div className="lobby-actions">{me?.host ? <button className="button primary" disabled={!snapshot.solo && snapshot.players.length < 2} onClick={() => { sound('click'); socket.emit('room:start'); }}>START MATCH <span>→</span></button> : <div className="waiting"><span className="waiting-dot"/> WAITING FOR HOST TO START</div>}<button className="text-button" onClick={leave}>← LEAVE ROOM</button></div></div><aside className="lobby-aside"><div className="aside-symbol">⌁</div><small>MISSION BRIEF</small><h3>YOUR PAST<br/>IS YOUR <em>ACCOMPLICE.</em></h3><p>Occupy pressure plates across time loops. Echoes recreate your movements and open the vault. Steal the core, then cross to your extraction zone.</p><div className="aside-rule"><span>01</span> 20 SECONDS PER LOOP</div><div className="aside-rule"><span>02</span> 8 LOOPS MAXIMUM</div><div className="aside-rule"><span>03</span> FIRST EXTRACTION WINS</div></aside></div></main>}
    {screen === 'game' && snapshot && <main className="game-screen"><div className="hud-top"><div className="hud-left"><div className="hud-tag">OPERATION ECHO HEIST</div><div className="hud-team"><span className={`team-dot team-${me?.team ?? 0}`}/> {me ? teamName(me.team) : 'SPECTATOR'} <span className="separator">/</span> {me?.name || 'AGENT'}</div><div className="hud-score">SCORE <span>CYAN {snapshot.winner === 0 ? 1 : 0}</span> : <span>MAGENTA {snapshot.winner === 1 ? 1 : 0}</span></div></div><div className={`timer ${remaining < 5 && snapshot.phase === 'playing' ? 'urgent' : ''}`}><small>{snapshot.phase === 'playing' ? 'TIMELINE COLLAPSE IN' : snapshot.phase === 'countdown' ? 'MISSION BEGINS IN' : snapshot.phase === 'transition' ? 'REWINDING TIMELINE' : 'MISSION COMPLETE'}</small><strong>{snapshot.phase === 'playing' ? remaining.toFixed(1) : snapshot.phase === 'results' ? '00.0' : Math.max(0,(snapshot.phaseEndsAt-now)/1000).toFixed(1)}</strong><div className="timer-bar"><i style={{ width: `${snapshot.phase === 'playing' ? remaining / 20 * 100 : snapshot.phase === 'results' ? 0 : 100}%` }}/></div></div><div className="hud-right"><div className="hud-count"><small>LOOP</small><strong>{String(snapshot.loop || 1).padStart(2,'0')}<span>/{String(MAX_LOOPS).padStart(2,'0')}</span></strong></div><div className="hud-count"><small>ECHOES</small><strong>{String(snapshot.echoCount).padStart(2,'0')}</strong></div><button className="icon-button game-menu" onClick={leave} title="Leave match" aria-label="Leave match">⌂</button></div></div><div className="arena-frame"><Arena snapshot={snapshot} echoes={echoes}/><div className="arena-corner corner-tl"/><div className="arena-corner corner-tr"/><div className="arena-corner corner-bl"/><div className="arena-corner corner-br"/>{notice && snapshot.phase !== 'results' && <div className="announcement" key={snapshot.announcementId}><span>⌁</span>{notice}<span>⌁</span></div>}{!connected && <div className="disconnect-overlay"><div className="spinner"/> CONNECTION LOST<br/><small>RECONNECTING TO TIMELINE...</small></div>}{snapshot.phase === 'countdown' && <div className="countdown-overlay"><small>MISSION STARTING</small><strong>{Math.max(1,Math.ceil((snapshot.phaseEndsAt-now)/1000))}</strong><span>PREPARE YOUR ECHO</span></div>}{snapshot.phase === 'transition' && <div className="transition-overlay"><div className="transition-ring">↺</div><strong>TIMELINE FRACTURE</strong><span>YOUR PAST RETURNS</span></div>}{snapshot.phase === 'results' && <div className="results-overlay"><div className="result-confetti" aria-hidden="true">{Array.from({length:24},(_,i)=><i key={i} style={{left:`${(i*41)%100}%`,animationDelay:`${(i*11)%20/10}s`,background:i%2?'#36e8ff':'#a56aff'}}/>)}</div><div className="result-card"><div className="eyebrow">MISSION TERMINATED / LOOP {snapshot.loop}</div><h2>{snapshot.winner === null ? <>TIME <em>COLLAPSE.</em></> : <>{teamName(snapshot.winner)} <em>WINS.</em></>}</h2><p>{snapshot.winner === null ? 'The core remains beyond reach. Rewrite your plan and try again.' : 'The core is secured. Your crew escaped the timeline.'}</p><div className="result-stats"><div><small>LOOPS PLAYED</small><strong>{snapshot.loop}</strong></div><div><small>ECHOES CREATED</small><strong>{snapshot.echoCount}</strong></div><div><small>CORE STEALS</small><strong>{me?.steals || 0}</strong></div><div><small>DASHES</small><strong>{me?.dashes || 0}</strong></div></div><div className="result-actions">{me?.host && <button className="button primary" onClick={() => { sound('click'); socket.emit('room:start'); }}>PLAY AGAIN ↺</button>}{!me?.host && <div className="waiting">WAITING FOR HOST TO RESTART</div>}<button className="button secondary" onClick={leave}>RETURN TO MENU</button></div></div></div>}</div><div className="hud-bottom"><div className="status-group"><div className="status-item"><small>VAULT</small><strong className={snapshot.unlocked ? 'lime' : 'red'}>{snapshot.unlocked ? 'UNLOCKED' : 'LOCKED'}</strong></div><div className="status-item"><small>CORE STATUS</small><strong className={snapshot.core.carrier ? 'lime' : ''}>{coreLabel}</strong></div><div className="plate-status"><span className={snapshot.plates[0] ? 'active' : ''}>A</span><span className={snapshot.plates[1] ? 'active' : ''}>B</span></div></div><div className="ability-group"><div className={`ability ${dashRemaining === 0 ? 'ready' : ''}`}><kbd>SHIFT</kbd><span>DASH</span><strong>{dashRemaining ? `${dashRemaining.toFixed(1)}S` : 'READY'}</strong><i style={{ width: `${100 - dashRemaining / (DASH_CD/1000)*100}%` }}/></div><div className={`ability ${pulseRemaining === 0 ? 'ready' : ''}`}><kbd>F</kbd><span>STUN PULSE</span><strong>{pulseRemaining ? `${pulseRemaining.toFixed(1)}S` : 'READY'}</strong><i style={{ width: `${100 - pulseRemaining / (PULSE_CD/1000)*100}%` }}/></div><button className="legend-toggle" onClick={() => setShowKeys(!showKeys)}>{showKeys ? 'HIDE KEYS' : 'SHOW KEYS'}</button></div></div>{showKeys && <div className="keys-legend"><span><kbd>WASD</kbd> MOVE</span><span><kbd>E</kbd> INTERACT</span><span><kbd>SHIFT</kbd> DASH</span><span><kbd>F</kbd> PULSE</span></div>}</main>}
    <footer className="global-footer"><span>© 2088 / CHRONOS DIVISION</span><span>EVERY SECOND LEAVES A SHADOW.</span></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
