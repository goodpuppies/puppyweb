import * as THREE from 'three';
import { XRDevice, metaQuest3 } from 'iwer';

// --- Configuration ---
const SEND_FRAME_INTERVAL = 5;
const WS_URL = "ws://localhost:8000";
const AUTO_START_XR = true;

// --- IWER Setup ---
const xrDevice = new XRDevice(metaQuest3, {
  stereoEnabled: true,
  //ipd: 0.90,
  //fovy?
});
xrDevice.installRuntime();


function createGradientTexture() {
  const canvas = document.createElement('canvas');
  const width = 2;
  const height = 256;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    console.error("Failed to get 2D context for gradient");
    return null;
  }
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#1e4877');
  gradient.addColorStop(1, '#76b6c4');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// --- Three.js Setup ---
const scene = new THREE.Scene();
const backgroundTexture = createGradientTexture();
if (backgroundTexture) {
  scene.background = backgroundTexture;
} else {
  scene.background = new THREE.Color(0x333333);
}

const renderer = new THREE.WebGLRenderer({
  antialias: true
});
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
renderer.domElement.style.display = 'none';
renderer.setSize(window.innerWidth, window.innerHeight);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.6, 0);

// --- Scene Content ---
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.5, 0.5),
  new THREE.MeshBasicMaterial({ color: 0x00ff00 })
);
cube.position.z = -2;
scene.add(cube);
scene.add(new THREE.AmbientLight(0x404040));


// --- WebSocket Setup & Status (Unchanged) ---
const ws = new WebSocket(WS_URL);
const statusEl = document.createElement('div');
statusEl.style.padding = '10px';
statusEl.style.fontFamily = 'monospace';
statusEl.style.position = 'absolute';
statusEl.style.top = '10px';
statusEl.style.left = '10px';
statusEl.style.zIndex = '10';
statusEl.style.backgroundColor = '#607D8B';
statusEl.style.color = 'white';
statusEl.textContent = 'Connecting WebSocket...';
document.body.appendChild(statusEl);

ws.onopen = () => { 
  statusEl.textContent = 'WebSocket Connected';
  statusEl.style.backgroundColor = '#4CAF50';
  if (AUTO_START_XR) {
    console.log("WebSocket connected, attempting to auto-start XR...");
    startXrSession();
  }
};
ws.onclose = () => { 
  statusEl.textContent = 'WebSocket Disconnected';
  statusEl.style.backgroundColor = '#F44336';
  if (renderer.xr.getSession()) {
    renderer.setAnimationLoop(null);
  }
  statusEl.style.display = 'block';
};
ws.onerror = (error) => { 
  console.error('WebSocket Error:', error);
  statusEl.textContent = 'WebSocket Error';
  statusEl.style.backgroundColor = '#FF9800';
};

// --- Pixel Buffer & Dimensions ---
let pixels = new Uint8Array(0);
let currentWidth = 0;
let currentHeight = 0;
let frame = 0;

// --- Function to Start XR Session (Unchanged) ---
async function startXrSession() {
  if (!navigator.xr) {
    statusEl.textContent = 'WebXR not supported!';
    statusEl.style.backgroundColor = '#F44336';
    return;
  }
  if (!await navigator.xr.isSessionSupported('immersive-vr')) {
    statusEl.textContent = 'Immersive VR not supported!';
    statusEl.style.backgroundColor = '#F44336';
    return;
  }

  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor']
    });
    statusEl.textContent = 'XR Session Active';
    statusEl.style.backgroundColor = '#2196F3';


    session.addEventListener('end', () => {
      statusEl.textContent = 'XR Session Ended';
      statusEl.style.backgroundColor = '#607D8B';
      renderer.setAnimationLoop(null);

    });

    await renderer.xr.setSession(session);
    renderer.setAnimationLoop(xrRenderLoop);

  } catch (err) {
    console.error('XR session failed:', err);
    statusEl.textContent = `XR Error: ${(err as Error).message}`;
    statusEl.style.backgroundColor = '#F44336';
   
    
  }
}


// --- XR Render Loop ---
function xrRenderLoop(timestamp, xrFrame) {
  const session = renderer.xr.getSession();
  if (!session || !xrFrame) return; // Ensure xrFrame exists

  // --- Update Scene ---
  cube.rotation.y += 0.01;
  cube.rotation.x += 0.005;

  // --- 1. Render Application Scene to XR Layer ---
  // This remains necessary for the headset display.
  renderer.render(scene, camera);
  // --- XR display render done ---


  // --- 2. Capture Frame (if interval met) ---
  if (ws.readyState === WebSocket.OPEN && frame++ % SEND_FRAME_INTERVAL === 0) {

    let captureSuccess = false;
    let errorMsg = "";

    // --- Attempt using readPixels ---
    const gl = renderer.getContext();
    const layer = session.renderState.baseLayer;

    if (!gl || !layer) {
      errorMsg = "WebGL context or XRWebGLLayer not available.";
    } else {
      const W = layer.framebufferWidth;
      const H = layer.framebufferHeight;

      if (W <= 0 || H <= 0) {
        errorMsg = `Invalid framebuffer dimensions: ${W}x${H}`;
      } else {
        // Resize pixel buffer if needed
        const requiredSize = W * H * 4;
        if (pixels.byteLength !== requiredSize || currentWidth !== W || currentHeight !== H) {
          console.log(`Resizing pixel buffer for readPixels: ${W}x${H} (${requiredSize} bytes)`);
          try {
            pixels = new Uint8Array(requiredSize);
            currentWidth = W;
            currentHeight = H;
          } catch (allocError) {
            console.error("Failed to allocate pixel buffer:", allocError);
            errorMsg = "Pixel buffer allocation failed.";
            // Reset dimensions to prevent repeated allocation attempts for this size
            currentWidth = 0;
            currentHeight = 0;
            pixels = new Uint8Array(0);
            // Skip capture this frame
            W = 0; H = 0; // Prevent readPixels call
          }
        }

        if (W > 0 && H > 0) { // Check again in case allocation failed
          try {
            // **CRITICAL**: Ensure correct framebuffer is bound.
            // This is the biggest uncertainty. Three.js might leave the
            // XR layer FB bound, or it might switch back to the default (null).
            // Let's *assume* it's readable without explicit binding first.
            // If this doesn't work, you might need:
            // gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); // Requires knowing the exact FB, layer.framebuffer might not be correct/accessible
            // or maybe reading from the default buffer works if preserveDrawingBuffer=true?
            // gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            // Perform the readPixels operation
            gl.readPixels(
              0,          // x
              0,          // y
              currentWidth, // width
              currentHeight,// height
              gl.RGBA,      // format
              gl.UNSIGNED_BYTE, // type
              pixels        // target buffer
            );

            // Check for GL errors (optional but good practice)
            const glError = gl.getError();
            if (glError !== gl.NO_ERROR) {
              errorMsg = `gl.readPixels error: ${glError}`;
              console.error(errorMsg);
            } else {
              captureSuccess = true;
              // Pixels are now in the 'pixels' Uint8Array
            }

          } catch (e) {
            errorMsg = `Error during gl.readPixels: ${e}`;
            console.error(errorMsg, e);
          }
        }
      }
    }

    

    // --- 3. Send Binary Message (if capture was successful) ---
    if (captureSuccess && currentWidth > 0 && currentHeight > 0) {
      try {
        const metadataBuffer = new ArrayBuffer(16); // w, h, len, chunks=1
        const metadataView = new DataView(metadataBuffer);
        metadataView.setUint32(0, currentWidth, true);       // width
        metadataView.setUint32(4, currentHeight, true);      // height
        metadataView.setUint32(8, pixels.byteLength, true); // data length
        metadataView.setUint32(12, 1, true);                  // number of chunks

        const chunkSizeBuffer = new ArrayBuffer(4);
        const chunkSizeView = new DataView(chunkSizeBuffer);
        chunkSizeView.setUint32(0, pixels.byteLength, true); // Size of this chunk

        // Create the final message ArrayBuffer
        const message = new Uint8Array(metadataBuffer.byteLength + chunkSizeBuffer.byteLength + pixels.byteLength);

        // Copy data into the final buffer
        message.set(new Uint8Array(metadataBuffer), 0);
        message.set(new Uint8Array(chunkSizeBuffer), metadataBuffer.byteLength);
        message.set(pixels, metadataBuffer.byteLength + chunkSizeBuffer.byteLength);

        // Send the combined message
        ws.send(message);

      } catch (e) {
        console.error("Error constructing or sending WebSocket message:", e);
        // Don't necessarily stop the loop, maybe it's a temporary WS issue
      }
    } else if (errorMsg) {
      // Only log errors periodically to avoid flooding console
      if (frame % 60 === 1) { // Log roughly once per second if errors persist
        console.warn(`Frame capture failed ${errorMsg}`);
      }
    }
  }
}