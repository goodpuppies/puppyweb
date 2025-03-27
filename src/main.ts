import * as THREE from 'three';

const width = 256;
const height = 256;

const renderer = new THREE.WebGLRenderer({ antialias: true });
const renderTarget = new THREE.WebGLRenderTarget(width, height, {
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
});
renderer.setSize(width, height);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1000);
camera.position.z = 2;

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshBasicMaterial({ color: 0x00ff00 })
);
scene.add(cube);

const img = document.createElement('img');
img.width = width;
img.height = height;
img.style.border = '2px solid lime';
document.body.appendChild(img);

// Connect to WebSocket
const ws = new WebSocket("ws://localhost:8000");

// Add connection status indicator
const statusEl = document.createElement('div');
statusEl.style.padding = '10px';
statusEl.style.fontFamily = 'monospace';
document.body.appendChild(statusEl);

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

const canvas = document.createElement('canvas');
canvas.width = width;
canvas.height = height;
const ctx = canvas.getContext('2d')!;
const pixels = new Uint8Array(width * height * 4);

let frame = 0;

function renderLoop() {
  requestAnimationFrame(renderLoop);

  cube.rotation.y += 0.01;
  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);

  if (ws.readyState === WebSocket.OPEN && frame++ % 5 === 0) {
    renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels);

    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);

    canvas.toBlob((blob) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result!.toString().split(',')[1];
        ws.send(base64);
      };
      reader.readAsDataURL(blob!);
    }, 'image/jpeg', 0.6);
  }
}

renderLoop();
