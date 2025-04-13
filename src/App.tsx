import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { XR, createXRStore, useXR } from '@react-three/xr';
import { XRDevice, metaQuest3 } from 'iwer';
import * as THREE from 'three';
import { Scene } from './Scene.tsx'

// --- Configuration ---
const SEND_FRAME_INTERVAL = 5;
const WS_URL = "ws://localhost:8000";
const AUTO_START_XR = true;
const XR_RENDER_SCALE = 1; // Use 1.0 for native device resolution recommendation
const CAPTURE_WIDTH = 640; // Lower resolution for capture performance
const CAPTURE_HEIGHT = 480;

// --- IWER Setup ---
const xrDevice = new XRDevice(metaQuest3, {
  stereoEnabled: true,
  //ipd: 0.90,
  fovy: 2
});
xrDevice.installRuntime();

// Create XR store
const xrStore = createXRStore();

// Status component for WebSocket connection
const StatusIndicator = ({ status }: { status: string }) => {
  const getColor = () => {
    switch (status) {
      case 'Connected': return '#4CAF50';
      case 'Disconnected': return '#F44336';
      case 'Error': return '#FF9800';
      case 'XR Session Active': return '#2196F3';
      case 'XR Session Ended': return '#607D8B';
      default: return '#607D8B';
    }
  };

  return (
    <div style={{
      padding: '10px',
      fontFamily: 'monospace',
      position: 'absolute',
      top: '10px',
      left: '10px',
      zIndex: 10,
      backgroundColor: getColor(),
      color: 'white'
    }}>
      {status === 'Connected' ? 'WebSocket Connected' : 
       status === 'Disconnected' ? 'WebSocket Disconnected' : 
       status === 'Error' ? 'WebSocket Error' : 
       status === 'XR Session Active' ? 'XR Session Active' : 
       status === 'XR Session Ended' ? 'XR Session Ended' : 
       'Connecting WebSocket...'}
    </div>
  );
};

// WebSocket context to share WebSocket connection
type WebSocketContextType = {
  ws: WebSocket | null;
  status: string;
  setStatus: (status: string) => void;
};

const WebSocketContext = React.createContext<WebSocketContextType>({
  ws: null,
  status: 'Connecting',
  setStatus: () => {}
});

// WebSocket provider component
const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState('Connecting');

  useEffect(() => {
    const newWs = new WebSocket(WS_URL);
    
    newWs.onopen = () => {
      setStatus('Connected');
      console.log("WebSocket connected");
      
      if (AUTO_START_XR) {
        console.log("WebSocket connected, attempting to auto-start XR...");
        setTimeout(() => {
          xrStore.enterAR();
        }, 1000);
      }
    };

    newWs.onclose = () => {
      setStatus('Disconnected');
      console.log("WebSocket disconnected");
    };

    newWs.onerror = (error) => {
      console.error('WebSocket Error:', error);
      setStatus('Error');
    };

    newWs.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.mDeviceToAbsoluteTracking) {
        // Extract position and rotation from the transformation matrix
        const matrix = data.mDeviceToAbsoluteTracking.m;

        // Extract position from the 4th column of the matrix
        const position = {
          x: matrix[0][3],
          y: matrix[1][3],
          z: matrix[2][3]
        };

        // Convert the 3x3 rotation part of the matrix to a quaternion
        const m = new THREE.Matrix4();
        m.set(
          matrix[0][0], matrix[0][1], matrix[0][2], 0,
          matrix[1][0], matrix[1][1], matrix[1][2], 0,
          matrix[2][0], matrix[2][1], matrix[2][2], 0,
          0, 0, 0, 1
        );

        const quaternion = new THREE.Quaternion();
        quaternion.setFromRotationMatrix(m);

        // Update XR device position and orientation
        xrDevice.position.set(position.x, position.y, position.z);
        xrDevice.quaternion.copy(quaternion);

      } else if (data.x !== undefined && data.qw !== undefined) {
        // Keep backward compatibility with the old format
        xrDevice.position.set(data.x, data.y, data.z);
        xrDevice.quaternion.set(data.qx, data.qy, data.qz, data.qw);
      } else {
        console.log("Unknown WebSocket message:", data);
      }
    };

    setWs(newWs);

    return () => {
      newWs.close();
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ ws, status, setStatus }}>
      {children}
    </WebSocketContext.Provider>
  );
};

// Hook to use WebSocket context
const useWebSocket = () => {
  const context = React.useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

// XR Session Status component
const XRSessionStatus = () => {
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

// Function to send frame data over WebSocket
const sendFrameData = (width: number, height: number, pixels: Uint8Array, ws: WebSocket) => {
  if (ws.readyState !== WebSocket.OPEN) return;
  
  try {
    const metadataBuffer = new ArrayBuffer(16);
    const metadataView = new DataView(metadataBuffer);
    metadataView.setUint32(0, width, true);
    metadataView.setUint32(4, height, true);
    metadataView.setUint32(8, pixels.byteLength, true);
    metadataView.setUint32(12, 1, true);

    const chunkSizeBuffer = new ArrayBuffer(4);
    const chunkSizeView = new DataView(chunkSizeBuffer);
    chunkSizeView.setUint32(0, pixels.byteLength, true);

    // Create the final message ArrayBuffer
    const message = new Uint8Array(metadataBuffer.byteLength + chunkSizeBuffer.byteLength + pixels.byteLength);

    // Copy data into the final buffer
    message.set(new Uint8Array(metadataBuffer), 0);
    message.set(new Uint8Array(chunkSizeBuffer), metadataBuffer.byteLength);
    message.set(pixels, metadataBuffer.byteLength + chunkSizeBuffer.byteLength);

    // Send the combined message
    ws.send(message);
  } catch (e) {
    console.error("Error sending frame data:", e);
  }
};

// Direct XR Frame Capture using session.requestAnimationFrame
const DirectXRFrameCapture_SessionLoop = () => {
  const { ws } = useWebSocket();
  const session = useXR(state => state.session);
  const { gl } = useThree();

  // Refs for persistent data across frames
  const pixelsRef = useRef<Uint8Array | null>(null);
  const currentWidthRef = useRef<number>(0);
  const currentHeightRef = useRef<number>(0);
  const frameIdRef = useRef<number | null>(null); // For cancelling the loop
  const frameCounterRef = useRef<number>(0); // Simple frame counter

  // The core capture logic, designed to run inside requestAnimationFrame
  const captureFrame = (_timestamp: DOMHighResTimeStamp, xrFrame: XRFrame | undefined) => {
    // Re-request the next frame immediately
    frameIdRef.current = session?.requestAnimationFrame(captureFrame) ?? null;

    frameCounterRef.current++;

    if (!session || !ws || ws.readyState !== WebSocket.OPEN || !xrFrame) {
      return;
    }

    if (frameCounterRef.current % SEND_FRAME_INTERVAL !== 0) {
      return;
    }

    let captureSuccess = false;
    let errorMsg = "";

    const layer = session.renderState.baseLayer;
    const glContext = gl.getContext() as WebGLRenderingContext | WebGL2RenderingContext;

    if (!glContext || !layer) {
      errorMsg = "WebGL context or XRWebGLLayer not available in rAF.";
    } else {
      let W = layer.framebufferWidth;
      let H = layer.framebufferHeight;

      if (W <= 0 || H <= 0) {
        errorMsg = `Invalid framebuffer dimensions in rAF: ${W}x${H}`;
      } else {
        // Ensure buffer exists and has the correct size
        const requiredSize = W * H * 4;
        if (!pixelsRef.current || pixelsRef.current.byteLength !== requiredSize) {
          console.log(`Resizing pixel buffer for rAF readPixels: ${W}x${H}`);
          try {
            pixelsRef.current = new Uint8Array(requiredSize);
            currentWidthRef.current = W;
            currentHeightRef.current = H;
          } catch (allocError) {
            console.error("Failed to allocate pixel buffer in rAF:", allocError);
            errorMsg = "Pixel buffer allocation failed in rAF.";
            pixelsRef.current = null; // Mark buffer as invalid
            W = 0; H = 0; // Prevent readPixels
          }
        }

        // Perform readPixels if buffer is valid
        if (pixelsRef.current && W > 0 && H > 0) {
          try {
            // Try reading directly without explicit bind first
            glContext.readPixels(
              0, 0, W, H,
              glContext.RGBA,
              glContext.UNSIGNED_BYTE,
              pixelsRef.current
            );

            const glError = glContext.getError();
            if (glError !== glContext.NO_ERROR) {
              errorMsg = `gl.readPixels error in rAF: ${glError}`;
              console.error(errorMsg);
            } else {
              captureSuccess = true;
              // Debug log
              let nonZeroCount = 0;
              for (let i = 0; i < 100; i++) {
                if (pixelsRef.current[i] > 0) nonZeroCount++;
              }
              console.log(`Direct rAF pixels non-zero count: ${nonZeroCount}/100`);
            }
          } catch (e) {
            errorMsg = `Error during gl.readPixels in rAF: ${e}`;
            console.error(errorMsg, e);
          }
        }
      }
    }

    // Send data if successful
    if (captureSuccess && pixelsRef.current) {
      sendFrameData(
        currentWidthRef.current,
        currentHeightRef.current,
        pixelsRef.current,
        ws
      );
    } else if (errorMsg) {
      // Log errors periodically
      if (frameCounterRef.current % 60 === 1) {
        console.warn(`Frame capture failed in rAF: ${errorMsg}`);
      }
    }
  };

  // Effect to start/stop the requestAnimationFrame loop
  useEffect(() => {
    if (session) {
      console.log("Starting session.requestAnimationFrame loop for capture...");
      // Reset counter when session starts
      frameCounterRef.current = 0;
      // Start the loop
      frameIdRef.current = session.requestAnimationFrame(captureFrame);

      // Cleanup function
      return () => {
        console.log("Stopping session.requestAnimationFrame loop.");
        if (frameIdRef.current !== null) {
          session.cancelAnimationFrame(frameIdRef.current);
          frameIdRef.current = null;
        }
      };
    } else {
      // Ensure loop stops if session ends unexpectedly
      if (frameIdRef.current !== null) {
        // Need a way to cancel if session disappears without triggering cleanup?
        // This might be tricky. The session object itself might be needed.
        // For now, assume the component unmounts or session triggers cleanup.
        console.warn("Session ended, but cancelAnimationFrame might need session object.");
      }
    }
  }, [session]); // Rerun when session changes

  return null; // This component doesn't render anything itself
};

// Scene component with WebXR functionality
const Scenealt = () => {
  const cubeRef = useRef<THREE.Mesh>(null);
  
  // Animation loop for the cube (R3F's useFrame is fine for scene updates)
  useFrame(() => {
    if (cubeRef.current) {
      cubeRef.current.rotation.y += 0.1; // Faster rotation
      cubeRef.current.rotation.x += 0.05;
    }
  });

  return (
    <>

      <gridHelper args={[10, 10]} />
      <ambientLight intensity={0.5} />
      <mesh ref={cubeRef} position={[0, 0, -2]} scale={0.5}> {/* Adjusted position/scale */}
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={0x00ffff} roughness={0.5} metalness={0.1} /> {/* Changed material */}
      </mesh>
    </>
  );
};

const App = () => {
  return (
    <WebSocketProvider>
      <AppContent />
    </WebSocketProvider>
  );
};

const AppContent = () => {
  const { status } = useWebSocket();
  
  return (
    <>
      <StatusIndicator status={status} />
      <button 
        onClick={() => xrStore.enterAR()} 
        style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '12px 24px',
          zIndex: 999
        }}
      >
        Enter AR
      </button>
      <Canvas
        camera={{ position: [0, 1.6, 0], fov: 70, near: 0.1, far: 1000 }}
        gl={{
          antialias: true,
          preserveDrawingBuffer: true, 
        }}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <XR store={xrStore}>
          <XRSessionStatus />
          <DirectXRFrameCapture_SessionLoop /> {/* <-- Use the session rAF capture */}
          <Scene />
        </XR>
      </Canvas>
    </>
  );
};

export default App;
