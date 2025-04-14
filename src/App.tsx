import React from 'react';
import { Canvas } from '@react-three/fiber';
import { XR } from '@react-three/xr';
import { XRDevice, metaQuest3 } from 'iwer';
import { Scene } from './Scene.tsx'
import { 
  WebSocketProvider, 
  StatusIndicator, 
  XRSessionStatus, 
  xrStore,
  useWebSocket
} from './WebSocketContext.tsx';
import { DirectXRFrameCapture_SessionLoop } from './FrameCapture.tsx';

const xrDevice = new XRDevice(metaQuest3, {
  stereoEnabled: true,
  //ipd: 0.90,
  fovy: 2
});
xrDevice.installRuntime();

// Make xrDevice available globally for WebSocketContext
window.xrDevice = xrDevice;

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
        type="button"  
        onClick={() => xrStore.enterAR()} 
      >Enter AR
      </button>
      <Canvas
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <XR store={xrStore}>
          <XRSessionStatus />
          <DirectXRFrameCapture_SessionLoop />
          <Scene />
        </XR>
      </Canvas>
    </>
  );
};

export default App;