// Frame receiver worker
let isConnected = false;
let wsServer: Deno.HttpServer | null = null;
let wsConnection: WebSocket | null = null;

const worker = self as unknown as Worker;

async function startWebSocketServer(port: number) {
  try {
    wsServer = Deno.serve({ port }, (req) => {
      if (req.headers.get("upgrade") !== "websocket") {
        return new Response(null, { status: 501 });
      }
      
      const { socket, response } = Deno.upgradeWebSocket(req);
      
      socket.addEventListener("open", () => {
        console.log("WebSocket client connected!");
        wsConnection = socket;
        isConnected = true;
        worker.postMessage({ type: 'connected' });
      });
      
      socket.addEventListener("message", (event) => {
        // Process incoming frame data from WebSocket
        try {
          const base64Data = event.data as string;
          // Convert base64 to binary
          const binaryData = base64ToUint8Array(base64Data);
          
          // Create a frame object similar to what we had with TCP
          const frameStart = performance.now();
          const receiveTime = performance.now() - frameStart;
          
          // Extract width and height from the image data
          // For simplicity, we'll use fixed dimensions for now
          // In a real implementation, you might want to send this as metadata
          const width = 256;
          const height = 256;
          
          worker.postMessage({ 
            type: 'frame', 
            data: binaryData,
            width: width,
            height: height,
            receiveTime 
          });
        } catch (err) {
          console.error("Error processing WebSocket message:", err);
        }
      });
      
      socket.addEventListener("close", () => {
        console.log("WebSocket client disconnected");
        wsConnection = null;
        isConnected = false;
      });
      
      socket.addEventListener("error", (event) => {
        console.error("WebSocket error:", event);
      });
      
      return response;
    });
    
    worker.postMessage({ type: 'listening', port });
    console.log(`WebSocket server started on port ${port}`);
    
  } catch (err) {
    worker.postMessage({ type: 'error', error: (err as Error).message });
  }
}

// Helper function to convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  // Remove data URL prefix if present
  const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
  
  // Convert base64 to binary string
  const binaryString = atob(base64Data);
  
  // Create Uint8Array from binary string
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes;
}

worker.onmessage = async (e: MessageEvent) => {
  const { type, port } = e.data;
  
  if (type === 'connect') {
    await startWebSocketServer(port);
  } else if (type === 'stop') {
    isConnected = false;
    
    if (wsConnection) {
      wsConnection.close();
      wsConnection = null;
    }
    
    if (wsServer) {
      wsServer.shutdown();
      wsServer = null;
    }
    
    worker.postMessage({ type: 'stopped' });
  }
};
