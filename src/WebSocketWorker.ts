// WebSocketWorker.ts - Handles WebSocket connections and frame sending in a separate thread

// Message types for communication between the main thread and worker
export type WorkerIncomingMessage = 
  | { type: 'connect', url: string }
  | { type: 'close' }
  | { type: 'sendFrame', width: number, height: number, pixels: Uint8Array }
  | { type: 'setAutoStartXR', autoStart: boolean };

export type WorkerOutgoingMessage =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'error', error: string }
  | { type: 'message', data: any }
  | { type: 'hmdPose', timestamp: number, matrix: number[][] };

// The actual worker code
const workerCode = () => {
  // WebSocket instance
  let ws: WebSocket | null = null;
  let latestTimestamp = 0;
  
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
                
                // Only forward the latest pose
                if (timestamp > latestTimestamp || !data.timestamp) {
                  if (data.timestamp) {
                    latestTimestamp = data.timestamp;
                  }
                  
                  // Extract the matrix for more efficient transfer
                  const matrix = data.mDeviceToAbsoluteTracking.m;
                  
                  // Send the HMD pose to the main thread
                  self.postMessage({
                    type: 'hmdPose',
                    timestamp,
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
            const { width, height, pixels } = message;
            
            // Create metadata buffer with width, height (8 bytes total)
            const metadataBuffer = new ArrayBuffer(8);
            const metadataView = new DataView(metadataBuffer);
            metadataView.setUint32(0, width, true); // littleEndian = true
            metadataView.setUint32(4, height, true); // littleEndian = true
            
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
