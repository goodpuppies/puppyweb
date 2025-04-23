import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import * as THREE from 'three';
import { useXR } from '@react-three/xr';
import { createXRStore } from '@react-three/xr';
import { core } from '@tauri-apps/api';
import { listen } from '@tauri-apps/api/event';

export const AUTO_START_XR = true;
export const xrStore = createXRStore();

// Define the payload type received from Rust
type TransformUpdatePayload = {
  matrix: number[]; // Flat 16-element array (f32)
};

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
    // Create a buffer for metadata (width, height) + pixel data
    const metaSize = 4 + 4; // u32 width + u32 height
    const totalSize = metaSize + pixels.length;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // Write width and height as Little Endian Unsigned 32-bit integers
    view.setUint32(0, width, true); // true for littleEndian
    view.setUint32(4, height, true); // true for littleEndian

    // Copy pixel data after the metadata
    const framePayload = new Uint8Array(buffer);
    framePayload.set(pixels, metaSize);

    // Invoke the Tauri command with the combined payload
    core.invoke('send_frame_data', framePayload) // Send the combined ArrayBuffer
        .then(() => {
      // Optionally update status or log
      // console.log(`Frame sent: ${width}x${height}`);
    }).catch((err) => {
      setStatus('Error');
      console.error('IPC Error sending frame:', err, { width, height });
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

  // Effect for listening to Transform Updates from Rust
  useEffect(() => {
    let unlistenTransform: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlistenTransform = await listen<TransformUpdatePayload>('transform-update', (event) => {
          // console.log('Received transform-update:', event.payload.matrix); // Debugging
          const flatMatrix = event.payload.matrix;

          // Ensure we received 16 elements
          if (flatMatrix && flatMatrix.length === 16) {
             // Reshape the flat 16-element array into a 3x4 matrix (number[][])
             // Assuming row-major order as sent from webUpdater.ts
             const matrix3x4: number[][] = [
               [flatMatrix[0], flatMatrix[1], flatMatrix[2], flatMatrix[3]],
               [flatMatrix[4], flatMatrix[5], flatMatrix[6], flatMatrix[7]],
               [flatMatrix[8], flatMatrix[9], flatMatrix[10], flatMatrix[11]],
             ];
            // Call the function to update the frontend's XR device pose
            setXRDeviceTransform(matrix3x4);
          } else {
            console.error('Received invalid matrix data in transform-update event:', event.payload);
          }
        });
        console.log("[IPC Provider] Listening for 'transform-update' events from Rust.");
      } catch (error) {
        console.error("Failed to set up transform-update listener:", error);
        setStatus('Error Listening for Transforms');
      }
    };

    setupListener();

    // Cleanup function
    return () => {
      if (unlistenTransform) {
        unlistenTransform();
        console.log("[IPC Provider] Unlistened from 'transform-update' events.");
      }
    };
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
  // Check if the input is a 3x4 matrix
  if (!matrix || matrix.length !== 3 || matrix.some(row => row.length !== 4)) {
    console.error("setXRDeviceTransform received invalid matrix format. Expected 3x4 number[][].", matrix);
    throw new Error("Invalid matrix format provided to setXRDeviceTransform.");
  }
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
    // deno-lint-ignore no-explicit-any
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