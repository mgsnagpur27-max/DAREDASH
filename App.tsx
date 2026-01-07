
import React, { useState, useEffect, useRef } from 'react';
import { GamePhase, GameLevel, GameType, GameState } from './types';
import { generateProceduralContent } from './constants';

declare const Peer: any;

// --- High-End Cinematic Sound Manager ---
const createSoundManager = () => {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioContextClass();
  
  const resume = async () => {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  };

  const playTone = async (freq: number, type: OscillatorType, duration: number, volume: number = 0.1, ramp: boolean = true) => {
    await resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    if (ramp) {
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    } else {
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
    }
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  return {
    click: () => playTone(800, 'square', 0.1, 0.04),
    // Dramatically extended toss sound
    toss: () => {
      for (let i = 0; i < 30; i++) {
        setTimeout(() => {
          const f = 150 + (i * 40);
          playTone(f, 'sine', 0.2, 0.05);
          if (i % 5 === 0) playTone(f * 1.5, 'triangle', 0.1, 0.02);
        }, i * 100);
      }
    },
    reveal: () => {
      playTone(200, 'sine', 1, 0.1);
      setTimeout(() => playTone(400, 'square', 0.5, 0.05), 100);
      setTimeout(() => playTone(800, 'sine', 0.8, 0.08), 200);
    },
    success: () => {
      [440, 554.37, 659.25, 880].forEach((f, i) => {
        setTimeout(() => playTone(f, 'sine', 0.4, 0.06), i * 150);
      });
    },
    whoosh: async () => {
      await resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(50, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    }
  };
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>({
    phase: GamePhase.INTRO,
    p1Name: '',
    p2Name: '',
    winner: null,
    level: null,
    type: null,
    selectedContent: null,
    gridContent: [],
    isOnline: false,
    isHost: false,
    peerId: null,
    connected: false,
  });

  const [coinFlipping, setCoinFlipping] = useState(false);
  const [flipResult, setFlipResult] = useState<'HEADS' | 'TAILS' | null>(null);
  const [revealingIndex, setRevealingIndex] = useState<number | null>(null);
  const [joinId, setJoinId] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [status, setStatus] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const soundRef = useRef<any>(null);

  const handleStart = () => {
    if (!soundRef.current) soundRef.current = createSoundManager();
    soundRef.current.success();
    setGameState(prev => ({ ...prev, phase: GamePhase.SETUP }));
  };

  const syncToPeer = (data: any) => {
    if (connRef.current && connRef.current.open) {
      connRef.current.send(data);
    }
  };

  const handleIncomingData = (data: any) => {
    if (data.type === 'SYNC_STATE') {
      setGameState(prev => ({ ...prev, ...data.payload }));
      if (data.payload.phase === GamePhase.RESULT) soundRef.current?.reveal();
    }
    if (data.type === 'COIN_FLIP') {
      setFlipResult(data.payload.result);
      setCoinFlipping(true);
      soundRef.current?.toss();
      setTimeout(() => setCoinFlipping(false), 3000);
    }
    if (data.type === 'REVEAL_CARD') {
      setRevealingIndex(data.payload.index);
      soundRef.current?.whoosh();
    }
    if (data.type === 'RESET_SIGNAL') {
      setFlipResult(null);
      setRevealingIndex(null);
      setCoinFlipping(false);
    }
  };

  const initMultiplayer = (host: boolean) => {
    if (!soundRef.current) soundRef.current = createSoundManager();
    soundRef.current.click();
    if (peerRef.current) peerRef.current.destroy();

    setStatus(host ? 'Opening Channel...' : 'Initializing Client...');
    setIsConnecting(true);

    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    const actualId = host ? `DD-${roomCode}` : undefined;
    
    const peer = new Peer(actualId);
    peerRef.current = peer;

    peer.on('open', (id: string) => {
      setStatus(host ? 'Room Live' : 'Channel Ready');
      setIsConnecting(false);
      setGameState(prev => ({ 
        ...prev, 
        peerId: id.replace('DD-', ''),
        isHost: host, 
        isOnline: true, 
        phase: GamePhase.MULTIPLAYER_LOBBY,
        p1Name: host ? (prev.p1Name || 'Host') : prev.p1Name,
        p2Name: !host ? (prev.p2Name || 'Guest') : prev.p2Name
      }));
    });

    peer.on('connection', (conn: any) => {
      connRef.current = conn;
      setupConnection(conn);
    });

    peer.on('error', (err: any) => {
      setIsConnecting(false);
      setStatus('Network Error');
      if (err.type === 'peer-unavailable') alert("Room not found. Check the code.");
      else if (err.type === 'id-taken' && host) initMultiplayer(true);
    });
  };

  const connectToPeer = () => {
    if (!soundRef.current) soundRef.current = createSoundManager();
    soundRef.current.click();
    if (!joinId) return;
    setStatus('Linking to Host...');
    setIsConnecting(true);
    const conn = peerRef.current.connect(`DD-${joinId.toUpperCase()}`, { reliable: true });
    connRef.current = conn;
    setupConnection(conn);
  };

  const setupConnection = (conn: any) => {
    conn.on('open', () => {
      setIsConnecting(false);
      setStatus('Synced');
      soundRef.current?.success();
      setGameState(prev => {
        const newState = { ...prev, connected: true, phase: GamePhase.TOSS };
        if (!prev.isHost) conn.send({ type: 'SYNC_STATE', payload: { p2Name: prev.p2Name || 'Guest' } });
        else conn.send({ type: 'SYNC_STATE', payload: { p1Name: prev.p1Name || 'Host', phase: GamePhase.TOSS } });
        return newState;
      });
    });
    conn.on('data', handleIncomingData);
    conn.on('close', goOffline);
  };

  const goOffline = () => {
    if (peerRef.current) peerRef.current.destroy();
    setGameState(prev => ({
      ...prev,
      isOnline: false,
      connected: false,
      phase: prev.phase === GamePhase.MULTIPLAYER_LOBBY ? GamePhase.SETUP : prev.phase
    }));
  };

  const goHome = () => {
    if (peerRef.current) peerRef.current.destroy();
    setGameState({
      phase: GamePhase.SETUP,
      p1Name: '', p2Name: '', winner: null, level: null, type: null,
      selectedContent: null, gridContent: [], isOnline: false, isHost: false,
      peerId: null, connected: false,
    });
    setJoinId('');
    setStatus('');
    setIsConnecting(false);
    setFlipResult(null);
    setRevealingIndex(null);
  };

  const handleCoinFlip = () => {
    if (coinFlipping) return;
    soundRef.current?.toss();
    const result = Math.random() > 0.5 ? 'HEADS' : 'TAILS';
    if (gameState.isOnline) syncToPeer({ type: 'COIN_FLIP', payload: { result } });
    setCoinFlipping(true);
    setFlipResult(null);
    setTimeout(() => {
      setFlipResult(result);
      setCoinFlipping(false);
      soundRef.current?.reveal();
      const winnerName = result === 'HEADS' ? gameState.p1Name : gameState.p2Name;
      setGameState(prev => ({ ...prev, winner: winnerName }));
      if (gameState.isOnline) syncToPeer({ type: 'SYNC_STATE', payload: { winner: winnerName } });
      setTimeout(() => {
        setGameState(prev => ({ ...prev, phase: GamePhase.LEVEL }));
        if (gameState.isOnline) syncToPeer({ type: 'SYNC_STATE', payload: { phase: GamePhase.LEVEL } });
      }, 1500);
    }, 3000);
  };

  const selectLevel = (level: GameLevel) => {
    soundRef.current?.click();
    setGameState(prev => ({ ...prev, level, phase: GamePhase.CHOICE }));
    if (gameState.isOnline) syncToPeer({ type: 'SYNC_STATE', payload: { level, phase: GamePhase.CHOICE } });
  };

  const selectType = (type: GameType) => {
    soundRef.current?.click();
    const grid = generateProceduralContent(type, gameState.level!, 10);
    setGameState(prev => ({ ...prev, type, gridContent: grid, phase: GamePhase.GRID }));
    if (gameState.isOnline) syncToPeer({ type: 'SYNC_STATE', payload: { type, gridContent: grid, phase: GamePhase.GRID } });
  };

  const selectGridItem = (item: string, idx: number) => {
    if (revealingIndex !== null) return;
    soundRef.current?.whoosh();
    setRevealingIndex(idx);
    if (gameState.isOnline) syncToPeer({ type: 'REVEAL_CARD', payload: { index: idx } });
    setTimeout(() => {
      soundRef.current?.reveal();
      setGameState(prev => ({ ...prev, selectedContent: item, phase: GamePhase.RESULT }));
      if (gameState.isOnline) syncToPeer({ type: 'SYNC_STATE', payload: { selectedContent: item, phase: GamePhase.RESULT } });
      setRevealingIndex(null);
    }, 1000);
  };

  const resetGame = () => {
    if (!soundRef.current) soundRef.current = createSoundManager();
    soundRef.current.click();
    
    // Core reset logic
    const baseReset = {
      phase: GamePhase.TOSS,
      winner: null,
      level: null,
      type: null,
      selectedContent: null,
      gridContent: [],
    };

    setGameState(prev => ({ ...prev, ...baseReset }));
    setFlipResult(null);
    setRevealingIndex(null);
    setCoinFlipping(false);

    if (gameState.isOnline) {
      syncToPeer({ type: 'SYNC_STATE', payload: baseReset });
      syncToPeer({ type: 'RESET_SIGNAL' });
    }
  };

  const isMyTurn = () => {
    if (!gameState.isOnline) return true;
    if (!gameState.winner) return gameState.isHost;
    const myName = gameState.isHost ? (gameState.p1Name || 'Host') : (gameState.p2Name || 'Guest');
    return gameState.winner === myName;
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative select-none touch-manipulation overflow-hidden">
      
      {/* Cinematic Intro Overlay */}
      {gameState.phase === GamePhase.INTRO && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950 px-6">
          <div className="text-center animate-scale-up">
            <h1 className="text-8xl md:text-9xl font-neon font-bold text-white tracking-widest animate-flicker drop-shadow-[0_0_30px_#db2777]">DD</h1>
            <p className="mt-4 text-cyan-400 font-bold tracking-[1em] uppercase text-[10px] md:text-xs mb-16 opacity-70">DAREDASH ENGINE</p>
            <button 
              onClick={handleStart}
              className="px-12 py-3 border-2 border-cyan-400 text-cyan-400 font-neon text-xs tracking-[0.5em] rounded-full hover:bg-cyan-400 hover:text-slate-950 transition-all elastic-transition shadow-[0_0_25px_rgba(34,211,238,0.4)] active:scale-95 group"
            >
              <span className="group-hover:tracking-[0.8em] transition-all">ENTER</span>
            </button>
          </div>
        </div>
      )}

      {/* Global Navigation */}
      {gameState.phase !== GamePhase.SETUP && gameState.phase !== GamePhase.INTRO && (
        <button onClick={goHome} className="fixed top-6 left-6 z-50 p-4 bg-slate-900/60 border-2 border-pink-500 rounded-2xl text-pink-500 shadow-lg active:scale-90 hover:bg-pink-500 hover:text-white transition-all">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
        </button>
      )}

      <main className={`w-full max-w-5xl z-10 flex flex-col items-center ${gameState.phase === GamePhase.INTRO ? 'hidden' : 'block'}`}>
        
        {/* Logo Section */}
        <div className="text-center mb-12 animate-scale-up">
          <h1 className="text-6xl md:text-9xl font-neon font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-pink-400 via-yellow-400 to-cyan-400 drop-shadow-[0_0_20px_rgba(255,255,255,0.2)]">DAREDASH</h1>
          <div className="flex items-center justify-center gap-4 mt-2">
            <span className="h-px w-12 bg-pink-500/50"></span>
            <p className="text-slate-400 font-bold tracking-[0.4em] uppercase text-[9px]">{gameState.isOnline ? 'GLOBAL SYNC' : 'OFFLINE MODE'}</p>
            <span className="h-px w-12 bg-cyan-500/50"></span>
          </div>
        </div>

        {gameState.phase === GamePhase.SETUP && (
          <div className="flex flex-col items-center space-y-8 w-full max-w-md bg-slate-900/40 backdrop-blur-3xl p-10 rounded-[3rem] border-2 border-slate-800 shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-scale-up">
            <h2 className="text-2xl font-neon text-white uppercase tracking-widest text-center">INITIALIZE</h2>
            <div className="w-full space-y-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-4">Codename</p>
              <input
                type="text" placeholder="GHOST..." value={gameState.p1Name}
                onChange={(e) => setGameState(prev => ({ ...prev, p1Name: e.target.value }))}
                className="w-full bg-slate-800/30 border-2 border-cyan-500/20 focus:border-cyan-500 rounded-2xl px-6 py-4 text-white font-neon outline-none text-lg transition-all"
              />
            </div>
            <div className="w-full grid grid-cols-2 gap-4">
              <button onClick={() => initMultiplayer(true)} className="py-5 border-2 border-pink-500 text-pink-500 rounded-3xl font-neon text-xs tracking-widest hover:bg-pink-500 hover:text-white transition-all active:scale-95 shadow-lg shadow-pink-500/10">HOST</button>
              <button onClick={() => initMultiplayer(false)} className="py-5 border-2 border-cyan-500 text-cyan-400 rounded-3xl font-neon text-xs tracking-widest hover:bg-cyan-500 hover:text-slate-900 transition-all active:scale-95 shadow-lg shadow-cyan-500/10">JOIN</button>
            </div>
            <div className="w-full flex flex-col items-center gap-4">
              <div className="h-px w-full bg-slate-800"></div>
              <button onClick={() => { if(!soundRef.current) soundRef.current = createSoundManager(); soundRef.current.click(); setGameState(prev => ({ ...prev, p1Name: prev.p1Name || 'P1', p2Name: 'P2', phase: GamePhase.TOSS, isOnline: false })); }} className="w-full py-5 bg-gradient-to-r from-slate-800 to-slate-900 text-white rounded-3xl font-neon text-xs tracking-widest border border-slate-700 active:scale-95 shadow-xl">LOCAL PARTY ENGINE</button>
            </div>
          </div>
        )}

        {gameState.phase === GamePhase.MULTIPLAYER_LOBBY && (
          <div className="flex flex-col items-center space-y-10 bg-slate-900/40 backdrop-blur-2xl p-12 rounded-[3rem] border-2 border-slate-800 w-full max-w-md mx-auto shadow-2xl animate-scale-up">
            <h2 className="text-2xl font-neon text-white uppercase tracking-widest">{gameState.isHost ? 'BROADCASTING' : 'SCANNING'}</h2>
            
            <div className="text-center w-full space-y-6">
              <p className="text-slate-500 text-[9px] tracking-[0.3em] font-bold uppercase">{gameState.isHost ? 'YOUR FREQUENCY' : 'INPUT FREQUENCY'}</p>
              
              {gameState.isHost ? (
                <button onClick={() => { navigator.clipboard.writeText(gameState.peerId!); setIsCopied(true); setTimeout(()=>setIsCopied(false),2000); soundRef.current?.click(); }} className="w-full text-5xl font-neon text-yellow-400 p-8 bg-slate-950 rounded-[2rem] border-2 border-yellow-400/30 lobby-pulse tracking-[0.4em] hover:border-yellow-400 transition-all active:scale-95">
                  {gameState.peerId || '....'}
                </button>
              ) : (
                <input type="text" placeholder="0000" maxLength={4} value={joinId} onChange={(e) => setJoinId(e.target.value.toUpperCase())} className="w-full text-center text-4xl font-neon bg-slate-800 rounded-[2rem] p-6 text-yellow-400 border-2 border-slate-700 outline-none uppercase focus:border-cyan-400 transition-all"/>
              )}
              
              {!gameState.isHost && (
                <button 
                  onClick={connectToPeer} 
                  disabled={isConnecting}
                  className={`w-full py-5 font-neon text-sm tracking-[0.3em] rounded-full transition-all active:scale-95 ${isConnecting ? 'bg-slate-800 text-slate-500' : 'bg-cyan-500 text-slate-950 shadow-[0_0_30px_rgba(34,211,238,0.3)]'}`}
                >
                  {isConnecting ? 'SYNCING...' : 'CONNECT'}
                </button>
              )}
              
              <p className={`text-[10px] font-bold uppercase tracking-widest transition-all ${status.includes('Error') ? 'text-red-500' : 'text-pink-500'}`}>
                {isCopied ? 'Code Copied' : status || 'Awaiting Input'}
              </p>
            </div>
          </div>
        )}

        {gameState.phase === GamePhase.TOSS && (
          <div className="flex flex-col items-center space-y-12 animate-scale-up">
            <div className="text-center space-y-2">
              <h2 className="text-3xl md:text-5xl font-neon text-white uppercase text-center flex items-center justify-center gap-6">
                <span className="text-pink-500 drop-shadow-[0_0_10px_#db2777]">{gameState.p1Name || 'P1'}</span> 
                <span className="text-slate-700 text-base md:text-2xl font-bold tracking-tighter">VS</span> 
                <span className="text-cyan-400 drop-shadow-[0_0_10px_#22d3ee]">{gameState.p2Name || 'P2'}</span>
              </h2>
              <p className="text-slate-500 text-[10px] tracking-[0.5em] uppercase font-bold">Initiation Required</p>
            </div>

            <div className={`coin-container w-40 h-40 md:w-56 md:h-56 ${isMyTurn() ? 'cursor-pointer hover:scale-110 active:scale-90' : 'opacity-30 grayscale cursor-not-allowed'} transition-all`} onClick={isMyTurn() ? handleCoinFlip : undefined}>
              <div className={`coin ${coinFlipping ? (flipResult === 'HEADS' ? 'flip-heads' : 'flip-tails') : ''} ${flipResult ? (flipResult === 'HEADS' ? 'flip-heads' : 'flip-tails') : ''}`}>
                <div className="coin-face"><span className="text-pink-500 font-neon text-5xl md:text-7xl font-bold">1</span></div>
                <div className="coin-face coin-back"><span className="text-cyan-400 font-neon text-5xl md:text-7xl font-bold">2</span></div>
              </div>
            </div>

            {gameState.winner && !coinFlipping ? (
              <div className="text-center animate-scale-up space-y-2">
                <p className="text-slate-500 text-[10px] tracking-[0.4em] mb-1 uppercase font-bold">Identified Winner</p>
                <h3 className="text-4xl md:text-6xl font-neon text-yellow-400 uppercase drop-shadow-[0_0_20px_rgba(250,204,21,0.5)]">
                  👑 {gameState.winner}
                </h3>
              </div>
            ) : (
              isMyTurn() && <p className="text-yellow-400 font-neon text-xs tracking-[0.4em] animate-pulse">TAP TO COMMENCE TOSS</p>
            )}
          </div>
        )}

        {gameState.phase === GamePhase.LEVEL && (
          <div className="flex flex-col items-center space-y-12 w-full max-w-5xl px-6 animate-scale-up">
            <h2 className="text-3xl font-neon text-white tracking-widest">{isMyTurn() ? 'SELECT INTENSITY' : 'AWAITING SELECTION'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-4xl">
              {[
                { id: GameLevel.CHILL, label: 'CHILL', desc: 'Slightly Awkward', color: 'border-cyan-500 text-cyan-400 shadow-cyan-500/10' },
                { id: GameLevel.SPICY, label: 'SPICY', desc: 'Very Revealing', color: 'border-yellow-500 text-yellow-400 shadow-yellow-500/10' },
                { id: GameLevel.EXTREME, label: 'EXTREME', desc: 'Total Chaos', color: 'border-pink-500 text-pink-500 shadow-pink-500/10' },
              ].map(lvl => (
                <button 
                  key={lvl.id} 
                  disabled={!isMyTurn()} 
                  onClick={() => selectLevel(lvl.id)} 
                  className={`group relative flex flex-col items-center justify-center py-10 md:py-16 border-2 rounded-[2.5rem] bg-slate-900/60 font-neon transition-all ${isMyTurn() ? `${lvl.color} active:scale-95 hover:bg-white/5 hover:scale-105 shadow-2xl` : 'opacity-20 grayscale'}`}
                >
                  <span className="text-2xl md:text-4xl mb-2">{lvl.label}</span>
                  <span className="text-[10px] tracking-widest font-bold opacity-50 uppercase">{lvl.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {gameState.phase === GamePhase.CHOICE && (
          <div className="flex flex-col items-center space-y-12 w-full max-w-4xl px-6 animate-scale-up">
            <h2 className="text-3xl font-neon text-white tracking-widest">{isMyTurn() ? 'CHOOSE YOUR FATE' : 'OPPONENT IS CHOOSING'}</h2>
            <div className="flex flex-col md:flex-row gap-8 w-full">
              <button disabled={!isMyTurn()} onClick={() => selectType(GameType.TRUTH)} className="flex-1 py-16 md:py-24 border-2 border-cyan-400 rounded-[3rem] font-neon text-4xl md:text-6xl text-cyan-400 active:scale-95 hover:bg-cyan-500/5 hover:scale-105 transition-all shadow-2xl shadow-cyan-500/10">TRUTH</button>
              <button disabled={!isMyTurn()} onClick={() => selectType(GameType.DARE)} className="flex-1 py-16 md:py-24 border-2 border-pink-500 rounded-[3rem] font-neon text-4xl md:text-6xl text-pink-500 active:scale-95 hover:bg-pink-500/5 hover:scale-105 transition-all shadow-2xl shadow-pink-500/10">DARE</button>
            </div>
          </div>
        )}

        {gameState.phase === GamePhase.GRID && (
          <div className="flex flex-col items-center space-y-12 w-full px-6 animate-scale-up">
            <h2 className="text-3xl font-neon text-white tracking-widest">SELECT A CARD</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-6 w-full max-w-5xl">
              {gameState.gridContent.map((item, idx) => (
                <button 
                  key={idx} 
                  disabled={!isMyTurn()} 
                  onClick={() => selectGridItem(item, idx)} 
                  className={`aspect-[3/4] rounded-2xl bg-slate-900 border-2 md:border-4 relative overflow-hidden transition-all ${revealingIndex === idx ? 'animate-cinematic-pop border-pink-500' : 'border-slate-800'} active:scale-90 hover:border-slate-500 shadow-xl group`}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <div className="absolute inset-0 flex items-center justify-center font-neon text-5xl md:text-7xl text-slate-800/50 group-hover:text-slate-700 transition-colors">?</div>
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-pink-500 to-cyan-500 opacity-20"></div>
                </button>
              ))}
            </div>
          </div>
        )}

        {gameState.phase === GamePhase.RESULT && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 md:p-12 bg-slate-950/98 backdrop-blur-3xl animate-in fade-in duration-700">
            <div className="max-w-2xl w-full bg-slate-900 border-2 md:border-4 border-yellow-400 rounded-[3rem] md:rounded-[5rem] p-10 md:p-20 text-center shadow-[0_0_100px_rgba(250,204,21,0.3)] relative overflow-hidden">
              <div className="absolute inset-0 shimmer opacity-10"></div>
              <p className="text-slate-500 text-[10px] md:text-xs tracking-[0.5em] uppercase mb-6 font-bold">MISSION OBJECTIVE</p>
              <p className="text-3xl md:text-5xl text-white font-bold italic mb-16 leading-tight drop-shadow-2xl">"{gameState.selectedContent}"</p>
              <button 
                onClick={resetGame} 
                className="w-full py-5 md:py-8 border-2 md:border-4 border-white text-white rounded-full font-neon text-base md:text-2xl tracking-[0.3em] active:scale-95 hover:bg-white hover:text-slate-950 transition-all shadow-[0_0_40px_rgba(255,255,255,0.2)]"
              >
                NEXT ROUND 🚀
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="fixed bottom-6 w-full flex justify-center text-[8px] md:text-[10px] tracking-[0.3em] font-bold opacity-50 transition-opacity">
        <div className="flex gap-6 items-center bg-slate-900/80 backdrop-blur-xl px-8 py-2.5 rounded-full border border-slate-800 shadow-2xl">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${gameState.connected || !gameState.isOnline ? 'bg-green-500 shadow-[0_0_10px_green]' : 'bg-red-500 shadow-[0_0_10px_red]'}`}></div>
            <span className="uppercase">{gameState.isOnline ? (gameState.connected ? 'SYNCED' : 'OFFLINE') : 'LOCAL'}</span>
          </div>
          {gameState.peerId && <span className="text-slate-600">| ROOM: {gameState.peerId}</span>}
          <a href="mailto:kaustubhshende2024@gmail.com" className="pointer-events-auto text-slate-500 hover:text-white flex items-center gap-2 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
            SUPPORT
          </a>
        </div>
      </footer>
    </div>
  );
};

export default App;
