import React, { useState, useEffect, useMemo } from 'react';
import mqtt from 'mqtt';
import './App.css';

/**
 * VITE CONFIGURATION
 * Using import.meta.env instead of process.env
 */
const BROKER_URL = import.meta.env.VITE_MQTT_URL;
const SUB_TOPIC = import.meta.env.VITE_MQTT_SUB_TOPIC;
const PUB_TOPIC = import.meta.env.VITE_MQTT_PUB_TOPIC;
//console.log("Vite Env Check:", import.meta.env);
//console.log(BROKER_URL,SUB_TOPIC,PUB_TOPIC);
const OFF_KEYS = ["a", "b", "c", "d", "e", "f", "g"];
const ON_KEYS = ["1", "2", "3", "4", "5", "6", "7"];

function App() {
  const [client, setClient] = useState(null);
  const [deviceStates, setDeviceStates] = useState(new Array(7).fill(false));
  const [status, setStatus] = useState('offline');

  // Smart logic: If any device is ON, the master button shows "All Off"
  const isAnyOn = useMemo(() => deviceStates.some(isOn => isOn), [deviceStates]);

  useEffect(() => {
    if (!BROKER_URL) {
      console.error("MQTT URL missing! Check your .env file and restart the server.");
      return;
    }

    const mqttClient = mqtt.connect(BROKER_URL, {
      clientId: `kameha_hub_${Math.random().toString(16).slice(2, 8)}`,
      reconnectPeriod: 2000,
      connectTimeout: 5000,
    });

    mqttClient.on('connect', () => {
      setStatus('connected');
      if (SUB_TOPIC) {
        mqttClient.subscribe(SUB_TOPIC, () => {
          // Request initial state from hardware if needed
          if (PUB_TOPIC) mqttClient.publish(PUB_TOPIC, "0");
        });
      }
    });

    mqttClient.on('offline', () => setStatus('offline'));
    mqttClient.on('error', (err) => {
      console.error("MQTT Error:", err);
      setStatus('offline');
    });

    mqttClient.on('message', (topic, message) => {
      const msg = message.toString();
      const onIdx = ON_KEYS.indexOf(msg);
      const offIdx = OFF_KEYS.indexOf(msg);
      
      setDeviceStates(prev => {
        const next = [...prev];
        if (onIdx !== -1) next[onIdx] = true;
        if (offIdx !== -1) next[offIdx] = false;
        return next;
      });
    });

    setClient(mqttClient);
    return () => {
      if (mqttClient) mqttClient.end();
    };
  }, []);

  const handleToggle = (index, forceState = null) => {
    if (status !== 'connected' || !client || !PUB_TOPIC) return;
    
    const currentState = deviceStates[index];
    const newState = forceState !== null ? forceState : !currentState;

    // Prevent redundant MQTT messages
    if (newState !== currentState) {
      const command = newState ? ON_KEYS[index] : OFF_KEYS[index];
      client.publish(PUB_TOPIC, command);
      
      // Optimistic UI update
      setDeviceStates(prev => {
        const next = [...prev];
        next[index] = newState;
        return next;
      });
    }
  };

  const handleMasterToggle = () => {
    const targetState = !isAnyOn; // Turn all OFF if any are ON, otherwise turn all ON
    deviceStates.forEach((_, i) => handleToggle(i, targetState));
  };

  return (
    <div className="app-shell">
      <main className="panel-container">
        {/* HEADER AREA */}
        <header className="hub-header">
          <div className="brand-group">
            <h1 className="hub-logo">KAMEHA</h1>
            <div className="room-indicator">
              <span>Main Room</span>
              <span className={`status-dot ${status}`}></span>
            </div>
          </div>
          
          <button 
            className={`master-btn ${isAnyOn ? 'mode-off' : 'mode-on'}`}
            onClick={handleMasterToggle}
            disabled={status !== 'connected'}
          >
            {isAnyOn ? 'All Off' : 'All On'}
          </button>
        </header>

        {/* TILES GRID */}
        <div className="hub-grid">
          {deviceStates.map((isOn, index) => (
            <button 
              key={index} 
              className={`hub-tile ${isOn ? 'active' : ''} ${status !== 'connected' ? 'locked' : ''}`} 
              onClick={() => handleToggle(index)}
              disabled={status !== 'connected'}
            >
              <div className="tile-icon">
                <img 
                  src={index === 5 ? '/fan-3.svg' : (isOn ? '/bright-light-bulb-svgrepo-com.svg' : '/light-bulb-svgrepo-com.svg')} 
                  className={index === 5 && isOn ? 'spin' : ''} 
                  alt="icon"
                />
              </div>
              <div className="tile-info">
                <span className="name">
                  {index === 5 ? "Ceiling Fan" : `Light 0${index + 1}`}
                </span>
                <span className="state">{isOn ? 'On' : 'Off'}</span>
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;