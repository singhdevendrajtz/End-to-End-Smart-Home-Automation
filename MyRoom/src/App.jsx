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
  const [status, setStatus] = useState('offline');
  
  const pendingIndexRef = useRef(null); 
  const pendingBatchRef = useRef([]);
  const lastIntendedStateRef = useRef(null);
  const [syncTrigger, setSyncTrigger] = useState(0);

  const isSyncing = useMemo(() => {
    return pendingIndexRef.current !== null || pendingBatchRef.current.length > 0;
  }, [syncTrigger]);

  useEffect(() => {
    const mqttClient = mqtt.connect(BROKER_URL, {
      clientId: `kameha_local_${Math.random().toString(16).slice(2, 5)}`,
      reconnectPeriod: 1000, 
      connectTimeout: 5000,
      clean: true, // Crucial for offline/local stability
    });

    mqttClient.on('connect', () => {
      setStatus('connected');
      mqttClient.subscribe(SUB_TOPIC, () => mqttClient.publish(PUB_TOPIC, "0", { retain: false }));
    });

    mqttClient.on('offline', () => {
      setStatus('offline');
      // BUG FIX: Clear pending states if we go offline so UI doesn't hang
      pendingIndexRef.current = null;
      pendingBatchRef.current = [];
      setSyncTrigger(v => v + 1);
    });

    mqttClient.on('error', () => setStatus('offline'));

    mqttClient.on('message', (topic, message) => {
      const msg = message.toString();
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
              if (pendingBatchRef.current.length === 0 && pendingIndexRef.current === null) {
                lastIntendedStateRef.current = null;
              }
            } else {
              // Forced sync: if board reports wrong state, re-publish
              mqttClient.publish(PUB_TOPIC, lastIntendedStateRef.current ? ON_KEYS[incomingIdx] : OFF_KEYS[incomingIdx], { retain: false });
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

    setClient(mqttClient);
    return () => mqttClient.end();
  }, []);

  const handleToggle = (index) => {
    // BUG FIX: Check if client exists AND is actually connected to the broker
    if (!client || !client.connected || isSyncing) return;

    const newState = !deviceStates[index];
    pendingIndexRef.current = index;
    lastIntendedStateRef.current = newState;
    setSyncTrigger(v => v + 1);
    
    // Explicitly set retain: false to prevent "ghost" switching on reboot
    client.publish(PUB_TOPIC, newState ? ON_KEYS[index] : OFF_KEYS[index], { qos: 0, retain: false });
  };

  const executeMasterAction = async (targetState) => {
    if (!client || !client.connected || isSyncing) return;

    const targets = deviceStates.map((isOn, i) => isOn !== targetState ? i : null).filter(x => x !== null);
    if (targets.length === 0) return;

    pendingBatchRef.current = targets;
    lastIntendedStateRef.current = targetState;
    setSyncTrigger(v => v + 1);

    for (const index of targets) {
      // Check connection before each pulse in the batch
      if (client.connected) {
        client.publish(PUB_TOPIC, targetState ? ON_KEYS[index] : OFF_KEYS[index], { retain: false });
        await sleep(200); 
      }
    }
  };

  return (
    <div className="app-shell">
      <div className="glass-panel">
        <header className="main-header">
          <div className="brand-info">
            <h1 className="logo-text">KAMEHA</h1>
            <div className={`connection-pill ${status}`}>
              <span className="dot"></span>
              <span className="label">{status === 'connected' ? 'Local Link' : 'Offline'}</span>
            </div>
          </div>
          
          <div className="segmented-master">
            <button 
              className={`master-btn on ${isSyncing && lastIntendedStateRef.current === true ? 'loading' : ''}`}
              onClick={() => executeMasterAction(true)}
              disabled={status !== 'connected' || isSyncing}
            >
              All On
            </button>
            <button 
              className={`master-btn off ${isSyncing && lastIntendedStateRef.current === false ? 'loading' : ''}`}
              onClick={() => executeMasterAction(false)}
              disabled={status !== 'connected' || isSyncing}
            >
              All Off
            </button>
          </div>
        </header>

        {/* System Locked class helps visually indicate the board is unresponsive */}
        <div className={`control-grid ${status !== 'connected' ? 'system-locked' : ''}`}>
          {deviceStates.map((isOn, index) => {
            const isPending = pendingIndexRef.current === index || pendingBatchRef.current.includes(index);
            const isFan = index === 5;
            
            return (
              <button 
                key={index} 
                className={`smart-card ${isOn ? 'on' : 'off'} ${isPending ? 'syncing' : ''}`} 
                onClick={() => handleToggle(index)}
                disabled={status !== 'connected' || isSyncing}
              >
                <div className="ambient-glow"></div>
                <div className="icon-wrapper">
                  <img 
                    src={isFan ? '/fan-3.svg' : (isOn ? '/bright-light-bulb-svgrepo-com.svg' : '/light-bulb-svgrepo-com.svg')} 
                    className={(isFan && isOn) || isPending ? 'rotating-svg' : 'static-svg'} 
                    alt="icon"
                  />
                </div>
                <div className="card-details">
                  <span className="device-label">{isFan ? "Ceiling Fan" : `Light 0${index + 1}`}</span>
                  <span className="device-meta">{isPending ? 'Syncing...' : (isOn ? 'Online' : 'Standby')}</span>
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
