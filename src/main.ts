import * as THREE from 'three';
import { XRDevice, metaQuest3 } from 'iwer';

// --- Configuration ---
const SEND_FRAME_INTERVAL = 5;
const WS_URL = "ws://localhost:8000";
const AUTO_START_XR = true; 

// --- IWER Setup ---
const xrDevice = new XRDevice(metaQuest3, { stereoEnabled: true});
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
scene.background = backgroundTexture;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

renderer.domElement.style.display = 'none'; 

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);

// --- Scene Content ---
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.5, 0.5),
  new THREE.MeshBasicMaterial({ color: 0x00ff00 })
);

cube.position.z = -2;
scene.add(cube);
scene.add(new THREE.AmbientLight(0x404040));


// --- WebSocket Setup & Status ---
const ws = new WebSocket(WS_URL);
const statusEl = document.createElement('div');
// Styles for status element (keep for initial feedback if needed)
statusEl.style.padding = '10px';
statusEl.style.fontFamily = 'monospace';
statusEl.style.position = 'absolute'; // Allow easy hiding later if kept
statusEl.style.top = '10px';
statusEl.style.left = '10px';
statusEl.style.zIndex = '10'; // Keep above hidden canvas
statusEl.style.backgroundColor = '#607D8B'; // Initial grey color
statusEl.style.color = 'white';
statusEl.textContent = 'Connecting WebSocket...';
document.body.appendChild(statusEl);

ws.onopen = () => {
  statusEl.textContent = 'WebSocket Connected';
  statusEl.style.backgroundColor = '#4CAF50';
  if (AUTO_START_XR) {
    console.log("WebSocket connected, attempting to auto-start XR...");
    startXrSession(); // Try starting XR automatically
  }
};
ws.onclose = () => {
  statusEl.textContent = 'WebSocket Disconnected';
  statusEl.style.backgroundColor = '#F44336';
  if (renderer.xr.getSession()) {
    renderer.setAnimationLoop(null);
  }
  // Show UI elements again if session ends and they were hidden
  xrButton.style.display = 'block';
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

// --- Offscreen Render Target & Copy Scene (Same as before) ---
const copyRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
});


// --- WebXR Button ---
const xrButton = document.createElement('button');
xrButton.id = 'xr-button';
xrButton.textContent = 'Enter XR';
xrButton.style.padding = '12px 24px';
xrButton.style.margin = '10px';
xrButton.style.position = 'absolute';
xrButton.style.top = '50px'; // Position below status
xrButton.style.left = '10px';
xrButton.style.zIndex = '10';
if (!AUTO_START_XR) { // Only add button if not auto-starting
  document.body.appendChild(xrButton);
}

// --- Function to Start XR Session ---
async function startXrSession() {
  // Ensure navigator.xr and requestSession exist
  if (!navigator.xr) {
    statusEl.textContent = "WebXR not supported by browser.";
    statusEl.style.backgroundColor = '#F44336';
    console.error("WebXR not supported");
    return;
  }
  if (!await navigator.xr.isSessionSupported('immersive-vr')) {
    statusEl.textContent = "'immersive-vr' mode not supported.";
    statusEl.style.backgroundColor = '#F44336';
    console.error("'immersive-vr' mode not supported.");
    return;
  }

  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor']
    });
    statusEl.textContent = 'XR Session Active';
    statusEl.style.backgroundColor = '#2196F3'; // Blue for active

    // --- HIDE UI ELEMENTS NOW ---
    if (!AUTO_START_XR) { // Keep button if auto-start fails? Or always hide? Let's hide.
      xrButton.style.display = 'none';
    }
    // Optionally hide status too, or keep it for feedback
    // statusEl.style.display = 'none';


    session.addEventListener('end', () => {
      statusEl.textContent = 'XR Session Ended';
      statusEl.style.backgroundColor = '#607D8B';
      renderer.setAnimationLoop(null);
      // img.src = ''; // No img element anymore

      // Show UI elements again
      if (!AUTO_START_XR) {
        xrButton.style.display = 'block';
        xrButton.textContent = 'Enter XR'; // Reset button text
      }
      // statusEl.style.display = 'block'; // Keep status visible?

    });

    await renderer.xr.setSession(session);
    renderer.setAnimationLoop(xrRenderLoop);

  } catch (err) {
    console.error('XR session failed:', err);
    statusEl.textContent = `XR Error: ${err.message}`;
    statusEl.style.backgroundColor = '#F44336';
    // Ensure button is visible if auto-start failed
    if (AUTO_START_XR && !document.body.contains(xrButton)) {
      document.body.appendChild(xrButton); // Add button if it wasn't there
    }
    xrButton.style.display = 'block';
  }
}

// Keep track of XR layer dimensions
let xrLayerWidth = 0;
let xrLayerHeight = 0;

// --- MODIFIED: XR Render Loop ---
function xrRenderLoop(timestamp, xrFrame) {
  const session = renderer.xr.getSession();
  if (!session) return;

  const layer = session.renderState.baseLayer;
  if (!layer) {
    // console.warn("No baseLayer found..."); // Reduce console spam
    return;
  }

  const currentLayerWidth = layer.framebufferWidth  || 512;
  const currentLayerHeight = layer.framebufferHeight || 512;

  if (currentLayerWidth !== xrLayerWidth || currentLayerHeight !== xrLayerHeight) {
    xrLayerWidth = currentLayerWidth;
    xrLayerHeight = currentLayerHeight;


    const eyeWidth = Math.floor(xrLayerWidth / 2);
    const eyeHeight = xrLayerHeight;

    if (eyeWidth > 0 && eyeHeight > 0) {
      if (copyRenderTarget.width !== eyeWidth || copyRenderTarget.height !== eyeHeight) {

        copyRenderTarget.setSize(eyeWidth, eyeHeight);
      }
      currentWidth = eyeWidth;
      currentHeight = eyeHeight;
      const requiredSize = currentWidth * currentHeight * 4;
      if (pixels.byteLength !== requiredSize) {

        pixels = new Uint8Array(requiredSize);
      }
    }
  }

  cube.rotation.y += 0.01;
  cube.rotation.x += 0.005;

  const currentRenderTarget = renderer.getRenderTarget();
  const currentXrEnabled = renderer.xr.enabled;
  renderer.render(scene, camera); // Render to XR display

  if (ws.readyState === WebSocket.OPEN && frame++ % SEND_FRAME_INTERVAL === 0 && xrLayerWidth > 0 && xrLayerHeight > 0 && copyRenderTarget.width > 0) {
    try {
      const xrCameras = renderer.xr.getCamera(camera);
      const leftEyeCamera = xrCameras.cameras[0];

      if (!leftEyeCamera) {
        renderer.setRenderTarget(currentRenderTarget);
        renderer.xr.enabled = currentXrEnabled;
        return;
      }

      renderer.setRenderTarget(copyRenderTarget);
      renderer.xr.enabled = false; // Disable XR for copy render
      renderer.render(scene, leftEyeCamera); // Render left eye to our target

      renderer.readRenderTargetPixels( // Read from our target
        copyRenderTarget, 0, 0, currentWidth, currentHeight, pixels
      );

      renderer.setRenderTarget(currentRenderTarget); // Restore state
      renderer.xr.enabled = currentXrEnabled;       // Restore state

      // --- Send Binary Message (Same as before) ---
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
      console.error("Error during double render capture or sending:", e);
      renderer.setRenderTarget(currentRenderTarget); // Restore state on error
      renderer.xr.enabled = currentXrEnabled;       // Restore state on error
    }
  } else {
    // Ensure state is correct if not capturing (likely redundant)
    renderer.setRenderTarget(currentRenderTarget);
    renderer.xr.enabled = currentXrEnabled;
  }
}
