import React, { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react';
import * as THREE from 'three';
import { useXR } from '@react-three/xr';
import { createXRStore } from '@react-three/xr';
import { core } from '@tauri-apps/api';

export const AUTO_START_XR = true;
export const xrStore = createXRStore();

// IPC context type definition
export type IpcContextType = {
  status: string;
  setStatus: (status: string) => void;
  sendFrame: (width: number, height: number, pixels: Uint8Array) => void;
};

// Create the context with default values
const IpcContext = createContext<IpcContextType>({
  status: 'Idle',
  setStatus: () => {},
  sendFrame: () => {}
});

// IPC provider component (no worker)
export const IpcProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState('Idle');

  // Send frame directly via Tauri IPC
  const sendFrame = useCallback((width: number, height: number, pixels: Uint8Array) => {
    const meta = {
      width,
      height
    };
    core.invoke('upload', pixels, {
      headers: {
        'X-Frame-Meta': JSON.stringify(meta)
      }
    }).then(() => {
      // Optionally update status or log
    }).catch((err) => {
      setStatus('Error');
      console.error('IPC Error:', err, meta);
    });
  }, []);

  // Effect for Auto Starting XR
  useEffect(() => {
    if (AUTO_START_XR) {
      console.log("IPC Provider mounted, attempting to auto-start XR...");
      // Use a timeout to give other systems a chance to initialize
      const timerId = setTimeout(() => {
        console.log("Calling xrStore.enterAR()...");
        // Make sure enterAR exists and is callable
        if (typeof xrStore.enterAR === 'function') {
             xrStore.enterAR().catch(err => {
                console.error("Failed to auto-enter AR:", err);
                setStatus('Error Starting XR'); // Update status on failure
             });
        } else {
            console.error("xrStore.enterAR is not a function. Cannot auto-start XR.");
        }
      }, 1000); // 1 second delay

      return () => clearTimeout(timerId); // Cleanup timeout on unmount
    }
  }, []); // Empty dependency array ensures this runs only once on mount

  return (
    <IpcContext.Provider value={{ status, setStatus, sendFrame }}>
      {children}
    </IpcContext.Provider>
  );
};

// Custom hook to use the IPC context
export const useIpc = () => {
  const context = useContext(IpcContext);
  if (!context) {
    throw new Error('useIpc must be used within an IpcProvider');
  }
  return context;
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

export const StatusIndicator = ({ status }: { status: string }) => {
  return (
    <div>
      {status === 'Connected' ? 'IPC Connected' : 
       status === 'Disconnected' ? 'IPC Disconnected' : 
       status === 'Error' ? 'IPC Error' : 
       status === 'XR Session Active' ? 'XR Session Active' : 
       status === 'XR Session Ended' ? 'XR Session Ended' : 
       'Connecting IPC...'}
    </div>
  );
};

declare global {
  interface Window {
    xrDevice: any;
  }
}

export const XRSessionStatus = () => {
  const { setStatus } = useIpc();
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