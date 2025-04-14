import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useXR } from '@react-three/xr';
import { createXRStore } from '@react-three/xr';
import { workerUrl, type WorkerIncomingMessage, type WorkerOutgoingMessage } from './WebSocketWorker.ts';

// Constants
export const WS_URL = "ws://localhost:8000";
export const AUTO_START_XR = true;
export const xrStore = createXRStore();

// Track the latest timestamp for pose data
let lastPoseTimestamp = 0;

// WebSocket context type definition
type WebSocketContextType = {
  ws: Worker | null; 
  status: string;
  setStatus: (status: string) => void;
  sendFrame: (width: number, height: number, pixels: Uint8Array) => void;
};

// Create the context with default values
const WebSocketContext = React.createContext<WebSocketContextType>({
  ws: null,
  status: 'Connecting',
  setStatus: () => {},
  sendFrame: () => {}
});

// WebSocket provider component
export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [worker, setWorker] = useState<Worker | null>(null);
  const [status, setStatus] = useState('Connecting');
  const isConnected = useRef(false);

  // Create a function to send frames through the worker
  const sendFrame = (width: number, height: number, pixels: Uint8Array) => {
    if (worker && isConnected.current) {
      const pixelsCopy = new Uint8Array(pixels);
      
      worker.postMessage({
        type: 'sendFrame',
        width,
        height,
        pixels: pixelsCopy
      } as WorkerIncomingMessage, [pixelsCopy.buffer]);
    }
  };

  useEffect(() => {
    const newWorker = new Worker(workerUrl);
    
    newWorker.onmessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
      const message = event.data;
      
      switch (message.type) {
        case 'connected':
          setStatus('Connected');
          isConnected.current = true;
          console.log("WebSocket connected");
          
          if (AUTO_START_XR) {
            console.log("WebSocket connected, attempting to auto-start XR...");
            setTimeout(() => {
              xrStore.enterAR();
            }, 1000);
          }
          break;
          
        case 'disconnected':
          setStatus('Disconnected');
          isConnected.current = false;
          console.log("WebSocket disconnected");
          break;
          
        case 'error':
          console.error('WebSocket Error:', message.error);
          setStatus('Error');
          break;
          
        case 'hmdPose':
          if (message.timestamp > lastPoseTimestamp || !message.timestamp) {
            if (message.timestamp) {
              lastPoseTimestamp = message.timestamp;
            }
            
            setXRDeviceTransform(message.matrix);
          }
          break;
          
        case 'message':
          console.log("Received message from server:", message.data);
          break;
      }
    };
    
    newWorker.postMessage({
      type: 'connect',
      url: WS_URL
    } as WorkerIncomingMessage);
    
    setWorker(newWorker);
    
    return () => {
      if (newWorker) {
        newWorker.postMessage({ type: 'close' } as WorkerIncomingMessage);
        newWorker.terminate();
      }
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ ws: worker, status, setStatus, sendFrame }}>
      {children}
    </WebSocketContext.Provider>
  );
};

function setXRDeviceTransform(matrix: number[][]) {
  try {
    const position = {
      x: matrix[0][3],
      y: matrix[1][3],
      z: matrix[2][3]
    };

    const m = new THREE.Matrix4();
    m.set(
      matrix[0][0], matrix[0][1], matrix[0][2], 0,
      matrix[1][0], matrix[1][1], matrix[1][2], 0,
      matrix[2][0], matrix[2][1], matrix[2][2], 0,
      0, 0, 0, 1
    );

    const quaternion = new THREE.Quaternion();
    quaternion.setFromRotationMatrix(m);

    if (window.xrDevice) {
      window.xrDevice.position.set(position.x, position.y, position.z);
      window.xrDevice.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }
  } catch (error) {
    console.error("Error applying XR device transform:", error);
    throw new Error(`Failed to apply XR transform: ${error}`);
  }
}

export const useWebSocket = () => {
  const context = React.useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

export const sendFrameData = (width: number, height: number, pixels: Uint8Array, ws: Worker) => {
  if (!ws) return;
  
  const context = React.useContext(WebSocketContext);
  context.sendFrame(width, height, pixels);
};

export const StatusIndicator = ({ status }: { status: string }) => {
  return (
    <div>
      {status === 'Connected' ? 'WebSocket Connected' : 
       status === 'Disconnected' ? 'WebSocket Disconnected' : 
       status === 'Error' ? 'WebSocket Error' : 
       status === 'XR Session Active' ? 'XR Session Active' : 
       status === 'XR Session Ended' ? 'XR Session Ended' : 
       'Connecting WebSocket...'}
    </div>
  );
};

declare global {
  interface Window {
    xrDevice: any;
  }
}

export const XRSessionStatus = () => {
  const { setStatus } = useWebSocket();
  const session = useXR(state => state.session);
  useEffect(() => {
    if (session) {
      setStatus('XR Session Active');
      const handleSessionEnd = () => {
        setStatus('XR Session Ended');
      };
      session.addEventListener('end', handleSessionEnd);
      return () => {
        session.removeEventListener('end', handleSessionEnd);
      };
    }
  }, [session, setStatus]);
  return null;
};