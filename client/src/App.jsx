import React, { useEffect, useState } from 'react';
import { useStore } from './lib/store.js';
import { api, cfg, getToken, setToken, setGate, loadAllSrd } from './lib/api.js';
import { D20Icon } from './lib/format.jsx';
import AuthScreen from './screens/AuthScreen.jsx';
import ResetScreen from './screens/ResetScreen.jsx';
import AccountSettings from './screens/AccountSettings.jsx';
import GateScreen from './screens/GateScreen.jsx';
import Lobby from './screens/Lobby.jsx';
import NewCampaign from './screens/NewCampaign.jsx';
import CampaignHome from './screens/CampaignHome.jsx';
import CharacterCreator from './creator/CharacterCreator.jsx';
import GameTable from './table/GameTable.jsx';
import Toasts from './components/Toasts.jsx';

export default function App() {
  const { user, route, setUser, setSrd } = useStore();
  const [needGate, setNeedGate] = useState(!cfg.gate);
  const [checking, setChecking] = useState(!!getToken());

  useEffect(() => {
    const onGate = () => { setGate(null); setNeedGate(true); };
    const onAuth = () => { setToken(null); setUser(null); };
    window.addEventListener('rp20:gate', onGate);
    window.addEventListener('rp20:auth', onAuth);
    return () => { window.removeEventListener('rp20:gate', onGate); window.removeEventListener('rp20:auth', onAuth); };
  }, [setUser]);

  useEffect(() => {
    if (needGate || !getToken()) { setChecking(false); return; }
    api('auth/me').then((r) => setUser(r.user)).catch(() => setToken(null)).finally(() => setChecking(false));
  }, [needGate, setUser]);

  useEffect(() => {
    if (user) loadAllSrd().then(setSrd).catch(() => {});
  }, [user, setSrd]);

  let screen;
  if (needGate) screen = <GateScreen onPass={() => setNeedGate(false)} />;
  else if (checking) screen = <Splash text="Lighting the torches…" />;
  else if (route.name === 'reset') screen = <ResetScreen token={route.token} />;
  else if (!user) screen = <AuthScreen />;
  else if (route.name === 'new') screen = <NewCampaign />;
  else if (route.name === 'campaign') screen = <CampaignHome id={route.id} />;
  else if (route.name === 'create') screen = <CharacterCreator campaignId={route.id} />;
  else if (route.name === 'play') screen = <GameTable id={route.id} />;
  else screen = <Lobby />;

  return (
    <>
      {screen}
      <Toasts />
    </>
  );
}

export function Splash({ text }) {
  return (
    <div className="auth-wrap">
      <div className="col" style={{ alignItems: 'center', gap: 14 }}>
        <D20Icon size={64} />
        <div className="row muted story" style={{ fontSize: 18 }}><span className="spinner" /> {text}</div>
      </div>
    </div>
  );
}

export function TopNav({ children }) {
  const go = useStore((s) => s.go);
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);
  const [account, setAccount] = useState(false);
  return (
    <div className="topnav">
      <div className="brand" onClick={() => go('#/')}><D20Icon size={26} /> Roleplay<b>20</b></div>
      <div className="spacer" />
      {children}
      {user && (
        <div className="row">
          <button className="btn ghost sm" title="Account settings: email and password" onClick={() => setAccount(true)}>👤 <b style={{ color: user.color }}>{user.displayName}</b>{!user.email && <i className="draft-dot" title="Add an email" />}</button>
          {account && <AccountSettings onClose={() => setAccount(false)} />}
          <button className="btn ghost sm" onClick={async () => { try { await api('auth/logout', { method: 'POST' }); } catch { /* ignore */ } setToken(null); setUser(null); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}
