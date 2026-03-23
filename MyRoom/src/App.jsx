import React, { useState, useEffect, useMemo, useRef } from 'react';
import mqtt from 'mqtt';
import './App.css';

const BROKER_URL = import.meta.env.VITE_MQTT_URL;
const SUB_TOPIC = import.meta.env.VITE_MQTT_SUB_TOPIC;
const PUB_TOPIC = import.meta.env.VITE_MQTT_PUB_TOPIC;

const OFF_KEYS = ["a", "b", "c", "d", "e", "f", "g"];
const ON_KEYS = ["1", "2", "3", "4", "5", "6", "7"];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function App() {
  const [client, setClient] = useState(null);
  const [deviceStates, setDeviceStates] = useState(new Array(7).fill(false));
  const [boardStatus, setBoardStatus] = useState('offline'); 
  
  const watchdogRef = useRef(null);
  const pendingIndexRef = useRef(null); 
  const pendingBatchRef = useRef([]);
  const lastIntendedStateRef = useRef(null);
  const [syncTrigger, setSyncTrigger] = useState(0);

  const isSyncing = useMemo(() => {
    return pendingIndexRef.current !== null || pendingBatchRef.current.length > 0;
  }, [syncTrigger]);

  const markBoardActive = () => {
    setBoardStatus('online');
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => setBoardStatus('offline'), 15000);
  };

  useEffect(() => {
    const mqttClient = mqtt.connect(BROKER_URL, {
      clientId: `kameha_vfinal_${Math.random().toString(16).slice(2, 5)}`,
      reconnectPeriod: 1000,
      clean: true,
    });

    mqttClient.on('connect', () => {
      mqttClient.subscribe(SUB_TOPIC, () => mqttClient.publish(PUB_TOPIC, "0"));
    });

    mqttClient.on('message', (topic, message) => {
      const msg = message.toString();
      markBoardActive();

      const onIdx = ON_KEYS.indexOf(msg);
      const offIdx = OFF_KEYS.indexOf(msg);
      const incomingIdx = onIdx !== -1 ? onIdx : offIdx;
      const isIncomingOn = onIdx !== -1;

      if (incomingIdx !== -1) {
        if (lastIntendedStateRef.current !== null) {
          const isTargeted = pendingIndexRef.current === incomingIdx || pendingBatchRef.current.includes(incomingIdx);
          if (isTargeted) {
            if (isIncomingOn === lastIntendedStateRef.current) {
              if (pendingIndexRef.current === incomingIdx) pendingIndexRef.current = null;
              pendingBatchRef.current = pendingBatchRef.current.filter(id => id !== incomingIdx);
              if (pendingBatchRef.current.length === 0 && pendingIndexRef.current === null) lastIntendedStateRef.current = null;
            } else {
              mqttClient.publish(PUB_TOPIC, lastIntendedStateRef.current ? ON_KEYS[incomingIdx] : OFF_KEYS[incomingIdx]);
              return; 
            }
          }
        }
        setDeviceStates(prev => {
          const next = [...prev];
          next[incomingIdx] = isIncomingOn;
          return next;
        });
        setSyncTrigger(v => v + 1);
      }
    });

    mqttClient.on('offline', () => setBoardStatus('offline'));
    setClient(mqttClient);

    const pollInterval = setInterval(() => {
      if (mqttClient.connected) mqttClient.publish(PUB_TOPIC, "0");
    }, 10000);

    return () => {
      mqttClient.end(true);
      clearInterval(pollInterval);
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
    };
  }, []);

  const handleToggle = (index) => {
    if (!client?.connected || isSyncing || boardStatus === 'offline') return;
    const newState = !deviceStates[index];
    pendingIndexRef.current = index;
    lastIntendedStateRef.current = newState;
    setSyncTrigger(v => v + 1);
    client.publish(PUB_TOPIC, newState ? ON_KEYS[index] : OFF_KEYS[index]);
  };

  const executeMasterAction = async (targetState) => {
    if (!client?.connected || isSyncing || boardStatus === 'offline') return;
    const targets = deviceStates.map((isOn, i) => isOn !== targetState ? i : null).filter(x => x !== null);
    if (targets.length === 0) return;

    pendingBatchRef.current = targets;
    lastIntendedStateRef.current = targetState;
    setSyncTrigger(v => v + 1);

    for (const index of targets) {
      if (client.connected) {
        client.publish(PUB_TOPIC, targetState ? ON_KEYS[index] : OFF_KEYS[index]);
        await sleep(200);
      }
    }
  };

  return (
    <div className="app-shell">
      <div className="glass-panel">
        <header className="main-header">
          <div className="top-bar">
            <h1 className="logo-text">KAMEHA</h1>
            <div className="header-line"></div>
          </div>
          
          <div className="action-bar">
            <div className={`connection-pill ${boardStatus === 'online' ? 'connected' : 'offline'}`}>
              <span className="dot"></span>
              <span className="label">Board: {boardStatus === 'online' ? 'Link' : 'Lost'}</span>
            </div>

            <div className="segmented-master">
              <button className="master-btn" onClick={() => executeMasterAction(true)} disabled={boardStatus === 'offline' || isSyncing}>All On</button>
              <div className="button-separator"></div>
              <button className="master-btn" onClick={() => executeMasterAction(false)} disabled={boardStatus === 'offline' || isSyncing}>All Off</button>
            </div>
          </div>
        </header>

        <div className={`control-grid ${boardStatus === 'offline' ? 'system-locked' : ''}`}>
          {deviceStates.map((isOn, index) => {
            const isPending = pendingIndexRef.current === index || pendingBatchRef.current.includes(index);
            const isFan = index === 5;
            
            return (
              <button key={index} className={`smart-card ${isOn ? 'on' : 'off'} ${isPending ? 'syncing' : ''}`} onClick={() => handleToggle(index)} disabled={boardStatus === 'offline' || isSyncing}>
                <div className="icon-wrapper">
                  <img src={isFan ? '/fan-3.svg' : (isOn ? '/bright-light-bulb-svgrepo-com.svg' : '/light-bulb-svgrepo-com.svg')} className={(isFan && isOn) || isPending ? 'rotating-svg' : ''} alt="icon" />
                </div>
                <div className="card-details">
                  <span className="device-label">{isFan ? "Ceiling Fan" : `Light 0${index + 1}`}</span>
                  <span className="device-meta">
                    {isPending ? <span className="sync-text">Syncing...</span> : isOn ? <span className="status-active">{isFan ? "Spinning" : "Illuminated"}</span> : <span className="status-dim">{isFan ? "Stationary" : "Powered Off"}</span>}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default App;