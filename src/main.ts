import * as THREE from 'three';
import { XRDevice, metaQuest3 } from 'iwer';

const width = 256;
const height = 256;

// Initialize IWER XR Device
const xrDevice = new XRDevice(metaQuest3, {
  referenceSpaceType: 'local-floor'
});
xrDevice.installRuntime();

// Configure stereo rendering
xrDevice.stereoEnabled = true;
xrDevice.ipd = 0.063; // Inter-pupillary distance in meters

// Create renderer with WebXR support
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// Create render targets for left and right eyes
const renderTargetLeft = new THREE.WebGLRenderTarget(width, height, {
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
});

const renderTargetRight = new THREE.WebGLRenderTarget(width, height, {
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
});

// Create scene and camera
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1000);
camera.position.z = 2;

// Add a simple cube to the scene
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshBasicMaterial({ color: 0x00ff00 })
);
scene.add(cube);

// Add a ground plane
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshBasicMaterial({ color: 0x999999, side: THREE.DoubleSide })
);
ground.rotation.x = Math.PI / 2;
ground.position.y = -1;
scene.add(ground);

// Add a preview image to the page
const leftEyeImg = document.createElement('img');
leftEyeImg.width = width;
leftEyeImg.height = height;
leftEyeImg.style.border = '2px solid red';
leftEyeImg.style.margin = '5px';
document.body.appendChild(leftEyeImg);

const rightEyeImg = document.createElement('img');
rightEyeImg.width = width;
rightEyeImg.height = height;
rightEyeImg.style.border = '2px solid blue';
rightEyeImg.style.margin = '5px';
document.body.appendChild(rightEyeImg);

// Add XR button
const xrButton = document.createElement('button');
xrButton.id = 'xr-button';
xrButton.textContent = 'Enter XR';
xrButton.style.position = 'absolute';
xrButton.style.top = '20px';
xrButton.style.left = '50%';
xrButton.style.transform = 'translateX(-50%)';
xrButton.style.padding = '12px 24px';
xrButton.style.zIndex = '999';
document.body.appendChild(xrButton);

// Add connection status indicator
const statusEl = document.createElement('div');
statusEl.style.padding = '10px';
statusEl.style.fontFamily = 'monospace';
statusEl.style.position = 'absolute';
statusEl.style.top = '70px';
statusEl.style.left = '50%';
statusEl.style.transform = 'translateX(-50%)';
document.body.appendChild(statusEl);

// Connect to WebSocket
const ws = new WebSocket("ws://localhost:8000");

// Handle WebSocket events
ws.onopen = () => {
  statusEl.textContent = 'WebSocket Connected';
  statusEl.style.backgroundColor = '#4CAF50';
  statusEl.style.color = 'white';
};

ws.onclose = () => {
  statusEl.textContent = 'WebSocket Disconnected';
  statusEl.style.backgroundColor = '#F44336';
  statusEl.style.color = 'white';
};

ws.onerror = (error) => {
  console.error('WebSocket Error:', error);
  statusEl.textContent = 'WebSocket Error';
  statusEl.style.backgroundColor = '#FF9800';
  statusEl.style.color = 'white';
};

// Pixel buffers for left and right eyes
const pixelsLeft = new Uint8Array(width * height * 4);
const pixelsRight = new Uint8Array(width * height * 4);

let frame = 0;
let xrSession: XRSession | null = null;

// Handle XR button click
xrButton.addEventListener('click', async () => {
  if (!xrSession) {
    try {
      xrSession = await navigator.xr!.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor']
      });
      
      renderer.xr.setSession(xrSession);
      xrButton.textContent = 'Exit XR';
      
      xrSession.addEventListener('end', () => {
        xrSession = null;
        xrButton.textContent = 'Enter XR';
      });
    } catch (error) {
      console.error('Error entering XR:', error);
    }
  } else {
    xrSession.end();
  }
});

// Function to send eye frame data to WebSocket
function sendEyeFrames() {
  if (ws.readyState !== WebSocket.OPEN) return;
  
  // Read pixels from left eye render target
  renderer.readRenderTargetPixels(renderTargetLeft, 0, 0, width, height, pixelsLeft);
  
  // Read pixels from right eye render target
  renderer.readRenderTargetPixels(renderTargetRight, 0, 0, width, height, pixelsRight);
  
  // Create metadata for left eye
  const metadataLeftBuffer = new ArrayBuffer(16);
  const metadataLeftView = new DataView(metadataLeftBuffer);
  metadataLeftView.setUint32(0, width, true);
  metadataLeftView.setUint32(4, height, true);
  metadataLeftView.setUint32(8, pixelsLeft.byteLength, true);
  metadataLeftView.setUint32(12, 1, true); // 1 chunk
  
  // Create chunk size buffer for left eye
  const chunkSizeLeftBuffer = new ArrayBuffer(4);
  const chunkSizeLeftView = new DataView(chunkSizeLeftBuffer);
  chunkSizeLeftView.setUint32(0, pixelsLeft.byteLength, true);
  
  // Combine left eye buffers
  const messageLeft = new Uint8Array(
    metadataLeftBuffer.byteLength + 
    chunkSizeLeftBuffer.byteLength + 
    pixelsLeft.byteLength
  );
  messageLeft.set(new Uint8Array(metadataLeftBuffer), 0);
  messageLeft.set(new Uint8Array(chunkSizeLeftBuffer), metadataLeftBuffer.byteLength);
  messageLeft.set(pixelsLeft, metadataLeftBuffer.byteLength + chunkSizeLeftBuffer.byteLength);
  
  // Send left eye data
  ws.send(messageLeft);
  
  // Create metadata for right eye
  const metadataRightBuffer = new ArrayBuffer(16);
  const metadataRightView = new DataView(metadataRightBuffer);
  metadataRightView.setUint32(0, width, true);
  metadataRightView.setUint32(4, height, true);
  metadataRightView.setUint32(8, pixelsRight.byteLength, true);
  metadataRightView.setUint32(12, 1, true); // 1 chunk
  
  // Create chunk size buffer for right eye
  const chunkSizeRightBuffer = new ArrayBuffer(4);
  const chunkSizeRightView = new DataView(chunkSizeRightBuffer);
  chunkSizeRightView.setUint32(0, pixelsRight.byteLength, true);
  
  // Combine right eye buffers
  const messageRight = new Uint8Array(
    metadataRightBuffer.byteLength + 
    chunkSizeRightBuffer.byteLength + 
    pixelsRight.byteLength
  );
  messageRight.set(new Uint8Array(metadataRightBuffer), 0);
  messageRight.set(new Uint8Array(chunkSizeRightBuffer), metadataRightBuffer.byteLength);
  messageRight.set(pixelsRight, metadataRightBuffer.byteLength + chunkSizeRightBuffer.byteLength);
  
  // Send right eye data
  ws.send(messageRight);
  
  // Update preview images
  updatePreviewImages(pixelsLeft, pixelsRight);
}

// Function to update preview images
function updatePreviewImages(leftData: Uint8Array, rightData: Uint8Array) {
  const canvasLeft = document.createElement('canvas');
  canvasLeft.width = width;
  canvasLeft.height = height;
  const ctxLeft = canvasLeft.getContext('2d')!;
  const imageDataLeft = ctxLeft.createImageData(width, height);
  imageDataLeft.data.set(leftData);
  ctxLeft.putImageData(imageDataLeft, 0, 0);
  leftEyeImg.src = canvasLeft.toDataURL();
  
  const canvasRight = document.createElement('canvas');
  canvasRight.width = width;
  canvasRight.height = height;
  const ctxRight = canvasRight.getContext('2d')!;
  const imageDataRight = ctxRight.createImageData(width, height);
  imageDataRight.data.set(rightData);
  ctxRight.putImageData(imageDataRight, 0, 0);
  rightEyeImg.src = canvasRight.toDataURL();
}

// Main render loop
function renderLoop() {
  requestAnimationFrame(renderLoop);
  
  // Animate the cube
  cube.rotation.y += 0.01;
  cube.rotation.x += 0.005;
  
  // Render to both eye targets
  renderer.setRenderTarget(renderTargetLeft);
  renderer.render(scene, camera);
  
  // Slightly offset camera for right eye
  camera.position.x += 0.063; // IPD offset
  renderer.setRenderTarget(renderTargetRight);
  renderer.render(scene, camera);
  camera.position.x -= 0.063; // Reset position
  
  // Reset render target
  renderer.setRenderTarget(null);
  
  // Send frames every few frames to limit bandwidth
  if (frame++ % 5 === 0) {
    sendEyeFrames();
  }
  
  // Render to the screen as well
  renderer.render(scene, camera);
}

// Start the render loop
renderLoop();
