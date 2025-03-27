import * as THREE from 'three';
import { XRDevice, metaQuest3 } from 'iwer';

// --- Configuration ---
const SEND_FRAME_INTERVAL = 5;
const WS_URL = "ws://localhost:8000";
const AUTO_START_XR = true;

// --- IWER Setup ---
const xrDevice = new XRDevice(metaQuest3, {
  // referenceSpaceType: 'local-floor' // Good to keep this explicit
  stereoEnabled: true // You had this, keep if needed for IWER behavior
});
xrDevice.installRuntime();

// --- Helper Canvas for Pixel Capture ---
// We need this again for drawImage/getImageData
const captureCanvas = document.createElement('canvas');
const ctx = captureCanvas.getContext('2d', {
  // Optional: May improve readback performance, but test compatibility
  // willReadFrequently: true
});
if (!ctx) {
  throw new Error("Could not create 2D context for capture");
}

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
if (backgroundTexture) { // Check if texture creation succeeded
  scene.background = backgroundTexture;
} else {
  scene.background = new THREE.Color(0x333333); // Fallback
}


const renderer = new THREE.WebGLRenderer({
  antialias: true,
  // If this method fails, we might need preserveDrawingBuffer: true
  // to read from renderer.domElement as a fallback test.
  // But for reading from IWER's canvas, it shouldn't be needed.
});
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
renderer.domElement.style.display = 'none'; // Keep hidden
// Set initial size based on window, XR might override
renderer.setSize(window.innerWidth, window.innerHeight);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
// Initial pose, XR controller will update this
camera.position.set(0, 1.6, 0);

// --- Scene Content ---
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.5, 0.5),
  new THREE.MeshBasicMaterial({ color: 0x00ff00 })
);
cube.position.z = -2;
scene.add(cube);
scene.add(new THREE.AmbientLight(0x404040));


// --- WebSocket Setup & Status (Mostly unchanged) ---
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
  if (!AUTO_START_XR) { // Only show button if it was manually hidden
    xrButton.style.display = 'block';
  }
  statusEl.style.display = 'block'; // Always show status on close?
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

// --- REMOVED Offscreen Render Target & Copy Scene ---
// const copyRenderTarget = ...
// const copyCamera = ...
// const copyScene = ...

// --- WebXR Button (Mostly unchanged) ---
const xrButton = document.createElement('button');
xrButton.id = 'xr-button';
xrButton.textContent = 'Enter XR';
xrButton.style.padding = '12px 24px';
xrButton.style.margin = '10px';
xrButton.style.position = 'absolute';
xrButton.style.top = '50px';
xrButton.style.left = '10px';
xrButton.style.zIndex = '10';
if (!AUTO_START_XR) {
  document.body.appendChild(xrButton);
}

// --- Function to Start XR Session (Unchanged) ---
async function startXrSession() {
  if (!navigator.xr) { /* ... error handling ... */ return; }
  if (!await navigator.xr.isSessionSupported('immersive-vr')) { /* ... error handling ... */ return; }

  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor']
    });
    statusEl.textContent = 'XR Session Active';
    statusEl.style.backgroundColor = '#2196F3';
    if (!AUTO_START_XR) {
      xrButton.style.display = 'none';
    }
    // statusEl.style.display = 'none'; // Optionally hide

    session.addEventListener('end', () => {
      statusEl.textContent = 'XR Session Ended';
      statusEl.style.backgroundColor = '#607D8B';
      renderer.setAnimationLoop(null);
      if (!AUTO_START_XR) {
        xrButton.style.display = 'block';
        xrButton.textContent = 'Enter XR';
      }
      // statusEl.style.display = 'block'; // Optionally show
    });

    await renderer.xr.setSession(session);
    // **CRITICAL**: Set size *after* session start often needed for XR layer init
    // Let's rely on the layer size detection within the loop for capture size.
    // renderer.setSize(window.innerWidth, window.innerHeight); // Re-evaluate if needed

    renderer.setAnimationLoop(xrRenderLoop);

  } catch (err) {
    console.error('XR session failed:', err);
    statusEl.textContent = `XR Error: ${err.message}`;
    statusEl.style.backgroundColor = '#F44336';
    if (AUTO_START_XR && !document.body.contains(xrButton)) {
      document.body.appendChild(xrButton);
    }
    if (!AUTO_START_XR || !document.body.contains(xrButton)) { // Ensure button exists if needed
      if (!document.body.contains(xrButton)) document.body.appendChild(xrButton);
      xrButton.style.display = 'block';
    } else if (document.body.contains(xrButton)) {
      xrButton.style.display = 'block';
    }

  }
}
// Add listener only if button is added
if (!AUTO_START_XR) {
  xrButton.addEventListener('click', startXrSession);
}


// --- EXPERIMENTAL: XR Render Loop using IWER Canvas ---
function xrRenderLoop(timestamp, xrFrame) {
  const session = renderer.xr.getSession();
  if (!session) return;

  // --- Update Scene ---
  cube.rotation.y += 0.01;
  cube.rotation.x += 0.005;

  // --- 1. Render Application Scene to XR Layer (for display in headset) ---
  // This is still necessary for the XR device to see anything.
  renderer.render(scene, camera);
  // --- XR display render done ---


  // --- 2. Capture Frame from IWER's Canvas (if interval met) ---
  if (ws.readyState === WebSocket.OPEN && frame++ % SEND_FRAME_INTERVAL === 0) {

    const iwerContainer = xrDevice.canvasContainer;
    if (!iwerContainer) {
      // console.warn("IWER canvasContainer not found yet. Skipping capture.");
      return;
    }

    // Find the canvas *inside* the container
    const iwerCanvas = iwerContainer.querySelector('canvas');
    if (!iwerCanvas) {
      // console.warn("Canvas element not found inside IWER container. Skipping capture.");
      return;
    }

    // Get dimensions from IWER's canvas
    const iwerWidth = iwerCanvas.width;
    const iwerHeight = iwerCanvas.height;

    if (iwerWidth <= 0 || iwerHeight <= 0) {
      console.warn("IWER canvas has invalid dimensions (<=0). Skipping capture.");
      return;
    }

    // Resize our capture canvas and pixel buffer if needed
    if (captureCanvas.width !== iwerWidth || captureCanvas.height !== iwerHeight) {
      console.log(`Resizing capture canvas to match IWER canvas: ${iwerWidth}x${iwerHeight}`);
      captureCanvas.width = iwerWidth;
      captureCanvas.height = iwerHeight;
    }
    // Ensure pixel buffer matches
    const requiredSize = iwerWidth * iwerHeight * 4;
    if (pixels.byteLength !== requiredSize || currentWidth !== iwerWidth || currentHeight !== iwerHeight) {
      console.log(`Resizing pixel buffer for IWER capture: ${requiredSize} bytes`);
      pixels = new Uint8Array(requiredSize);
      currentWidth = iwerWidth;
      currentHeight = iwerHeight;
    }

    try {
      // --- Capture from IWER Canvas using 2D Context ---
      // 1. Draw the IWER canvas onto our helper 2D canvas
      ctx.drawImage(iwerCanvas, 0, 0, currentWidth, currentHeight);

      // 2. Read the pixels from the helper 2D canvas
      const imageData = ctx.getImageData(0, 0, currentWidth, currentHeight);

      // 3. Copy pixel data
      pixels.set(imageData.data);
      // --- Pixels read from IWER canvas ---

      // --- 4. Send Binary Message ---
      // (This part is identical to before, uses currentWidth, currentHeight, pixels)
      const metadataBuffer = new ArrayBuffer(16);
      const metadataView = new DataView(metadataBuffer);
      metadataView.setUint32(0, currentWidth, true);
      metadataView.setUint32(4, currentHeight, true);
      metadataView.setUint32(8, pixels.byteLength, true);
      metadataView.setUint32(12, 1, true);
      const chunkSizeBuffer = new ArrayBuffer(4);
      const chunkSizeView = new DataView(chunkSizeBuffer);
      chunkSizeView.setUint32(0, pixels.byteLength, true);
      const message = new Uint8Array(metadataBuffer.byteLength + chunkSizeBuffer.byteLength + pixels.byteLength);
      message.set(new Uint8Array(metadataBuffer), 0);
      message.set(new Uint8Array(chunkSizeBuffer), metadataBuffer.byteLength);
      message.set(pixels, metadataBuffer.byteLength + chunkSizeBuffer.byteLength);
      ws.send(message);

    } catch (e) {
      console.error("Error capturing from IWER canvas or sending:", e);
      // Log the canvas state if possible
      console.error("IWER canvas:", iwerCanvas);
    }
  }
}

// --- Window Resize Handler (Mostly unchanged, less critical if main canvas hidden) ---
window.addEventListener('resize', () => {
  if (!renderer.xr.getSession()) {
    // Update camera aspect ratio for potential non-XR view
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    // Update renderer size if it were visible
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  // IWER canvas size is likely managed internally by IWER
});