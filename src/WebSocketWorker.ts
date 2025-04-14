// WebSocketWorker.ts - Handles WebSocket connections and frame sending in a separate thread

// Message types for communication between the main thread and worker
export type WorkerIncomingMessage = 
  | { type: 'connect', url: string }
  | { type: 'close' }
  | { type: 'sendFrame', width: number, height: number, pixels: Uint8Array, timestamp: number, poseTimestamp?: number, poseId?: number }
  | { type: 'setAutoStartXR', autoStart: boolean };

export type WorkerOutgoingMessage =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'error', error: string }
  | { type: 'message', data: any }
  | { type: 'hmdPose', timestamp: number, poseId: number, matrix: number[][] };

// The actual worker code
const workerCode = () => {
  // WebSocket instance
  let ws: WebSocket | null = null;
  let latestTimestamp = 0;
  let latestPoseId: number | null = null;
  
  // Handle messages from the main thread
  self.onmessage = (event: MessageEvent<WorkerIncomingMessage>) => {
    const message = event.data;
    
    switch (message.type) {
      case 'connect':
        // Create WebSocket connection
        if (ws) {
          ws.close();
        }
        
        try {
          ws = new WebSocket(message.url);
          
          ws.onopen = () => {
            self.postMessage({ type: 'connected' } as WorkerOutgoingMessage);
          };
          
          ws.onclose = () => {
            self.postMessage({ type: 'disconnected' } as WorkerOutgoingMessage);
          };
          
          ws.onerror = (error) => {
            self.postMessage({ 
              type: 'error', 
              error: 'WebSocket error' 
            } as WorkerOutgoingMessage);
          };
          
          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              
              // Check if it's an HMD pose message
              if (data.mDeviceToAbsoluteTracking) {
                const timestamp = data.timestamp || 0;
                const poseId = data.id || 0;
                
                // Only forward the latest pose
                if (timestamp > latestTimestamp || !data.timestamp) {
                  latestTimestamp = timestamp;
                  latestPoseId = poseId;
                  
                  // Extract the rotation matrix for use in the frontend
                  const matrix = [
                    [data.mDeviceToAbsoluteTracking.m[0][0], data.mDeviceToAbsoluteTracking.m[0][1], data.mDeviceToAbsoluteTracking.m[0][2], data.mDeviceToAbsoluteTracking.m[0][3]],
                    [data.mDeviceToAbsoluteTracking.m[1][0], data.mDeviceToAbsoluteTracking.m[1][1], data.mDeviceToAbsoluteTracking.m[1][2], data.mDeviceToAbsoluteTracking.m[1][3]],
                    [data.mDeviceToAbsoluteTracking.m[2][0], data.mDeviceToAbsoluteTracking.m[2][1], data.mDeviceToAbsoluteTracking.m[2][2], data.mDeviceToAbsoluteTracking.m[2][3]]
                  ];
                  
                  self.postMessage({ 
                    type: 'hmdPose', 
                    timestamp, 
                    poseId,
                    matrix 
                  } as WorkerOutgoingMessage);
                }
              } else {
                // Forward other messages to main thread
                self.postMessage({ 
                  type: 'message', 
                  data 
                } as WorkerOutgoingMessage);
              }
            } catch (error) {
              console.error('Error processing WebSocket message:', error);
            }
          };
        } catch (error) {
          self.postMessage({ 
            type: 'error', 
            error: 'Failed to create WebSocket connection' 
          } as WorkerOutgoingMessage);
        }
        break;
        
      case 'close':
        // Close WebSocket connection
        if (ws) {
          ws.close();
          ws = null;
        }
        break;
        
      case 'sendFrame':
        // Send frame data over WebSocket
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            const { width, height, pixels, timestamp, poseTimestamp, poseId } = message;
            
            // Create metadata buffer with width, height, timestamp, poseTimestamp, poseId (32 bytes total)
            const metadataBuffer = new ArrayBuffer(32);
            const metadataView = new DataView(metadataBuffer);
            metadataView.setUint32(0, width, true); // littleEndian = true
            metadataView.setUint32(4, height, true); // littleEndian = true
            metadataView.setFloat64(8, timestamp, true); // Add timestamp (Float64, littleEndian)
            metadataView.setFloat64(16, poseTimestamp || timestamp, true); // Add pose timestamp or fallback to frame timestamp
            metadataView.setFloat64(24, poseId || latestPoseId || 0, true); // Add pose ID (very important for synchronization)
            
            // Create the final message: metadata + pixel data
            const frameData = new Uint8Array(metadataBuffer.byteLength + pixels.byteLength);
            
            // Copy data into the final buffer
            frameData.set(new Uint8Array(metadataBuffer), 0);
            frameData.set(pixels, metadataBuffer.byteLength);
            
            // Send the message
            ws.send(frameData);
          } catch (error) {
            console.error('Error sending frame data:', error);
          }
        }
        break;

      case 'setAutoStartXR':
        // This is handled in the main thread now
        break;
        
      default:
        console.warn('Unknown message type:', (message as any).type);
        break;
    }
  };
};

// Convert the worker function to a string that can be used with Blob
const workerBlob = new Blob(
  [`(${workerCode.toString()})()`],
  { type: 'application/javascript' }
);

// Create a URL for the worker code
export const workerUrl = URL.createObjectURL(workerBlob);
