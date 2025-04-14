import { useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import { useWebSocket } from './WebSocketContext.tsx';

// Configuration options
const SEND_FRAME_INTERVAL = 3; // How many frames to skip between sends
const DOWNSAMPLE_FACTOR = 0.5; // Reduce resolution by this factor (0.5 = half width/height = 1/4 total pixels)
const USE_DOWNSAMPLING = true; // Set to true to enable downsampling

export const DirectXRFrameCapture_SessionLoop = () => {
  const { ws, sendFrame } = useWebSocket();
  const session = useXR(state => state.session);
  const { gl } = useThree();

  // Refs for persistent data across frames
  const pixelsRef = useRef<Uint8Array | null>(null);
  const downsampledPixelsRef = useRef<Uint8Array | null>(null);
  const currentWidthRef = useRef<number>(0);
  const currentHeightRef = useRef<number>(0);
  const downsampledWidthRef = useRef<number>(0);
  const downsampledHeightRef = useRef<number>(0);
  const frameIdRef = useRef<number | null>(null);
  const frameCounterRef = useRef<number>(0);

  // The core capture logic, designed to run inside requestAnimationFrame
  const captureFrame = (_timestamp: DOMHighResTimeStamp, xrFrame: XRFrame | undefined) => {
    // Re-request the next frame immediately
    frameIdRef.current = session?.requestAnimationFrame(captureFrame) ?? null;

    frameCounterRef.current++;

    if (!session || !ws || !xrFrame) {
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
        // Calculate downsized dimensions if downsampling is enabled
        const targetWidth = USE_DOWNSAMPLING ? Math.floor(W * DOWNSAMPLE_FACTOR) : W;
        const targetHeight = USE_DOWNSAMPLING ? Math.floor(H * DOWNSAMPLE_FACTOR) : H;
        
        // Ensure original buffer exists and has the correct size
        const requiredSize = W * H * 4;
        if (!pixelsRef.current || pixelsRef.current.byteLength !== requiredSize) {
          console.log(`Resizing pixel buffer for rAF readPixels: ${W}x${H}`);
          try {
            pixelsRef.current = new Uint8Array(requiredSize);
            currentWidthRef.current = W;
            currentHeightRef.current = H;
            
            // Also create the downsized buffer if needed
            if (USE_DOWNSAMPLING) {
              const downsampledSize = targetWidth * targetHeight * 4;
              downsampledPixelsRef.current = new Uint8Array(downsampledSize);
              downsampledWidthRef.current = targetWidth;
              downsampledHeightRef.current = targetHeight;
            }
          } catch (allocError) {
            console.error("Failed to allocate pixel buffer in rAF:", allocError);
            errorMsg = "Pixel buffer allocation failed in rAF.";
            pixelsRef.current = null;
            downsampledPixelsRef.current = null;
            W = 0; H = 0;
          }
        }

        // Perform readPixels if buffer is valid
        if (pixelsRef.current && W > 0 && H > 0) {
          try {
            // Read pixels from framebuffer
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
      if (USE_DOWNSAMPLING && downsampledPixelsRef.current) {
        // Downsample the image
        downsampleImage(
          pixelsRef.current,
          currentWidthRef.current,
          currentHeightRef.current,
          downsampledPixelsRef.current,
          downsampledWidthRef.current,
          downsampledHeightRef.current
        );
        
        // Send the downsampled image using the sendFrame method from context
        sendFrame(
          downsampledWidthRef.current,
          downsampledHeightRef.current,
          downsampledPixelsRef.current
        );
      } else {
        // Send the original image if downsampling is disabled
        sendFrame(
          currentWidthRef.current,
          currentHeightRef.current,
          pixelsRef.current
        );
      }
    } else if (errorMsg) {
      // Log errors periodically
      if (frameCounterRef.current % 60 === 1) {
        console.warn(`Frame capture failed in rAF: ${errorMsg}`);
      }
    }
  };

  // Function to downsample an image
  const downsampleImage = (
    sourcePixels: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetPixels: Uint8Array,
    targetWidth: number,
    targetHeight: number
  ) => {
    // Simple box sampling - average of pixels in each box
    const xRatio = sourceWidth / targetWidth;
    const yRatio = sourceHeight / targetHeight;
    
    for (let y = 0; y < targetHeight; y++) {
      for (let x = 0; x < targetWidth; x++) {
        // Source coordinates
        const srcX = Math.floor(x * xRatio);
        const srcY = Math.floor(y * yRatio);
        
        // Get pixel from source (simple approach, not averaging)
        const srcPos = (srcY * sourceWidth + srcX) * 4;
        const dstPos = (y * targetWidth + x) * 4;
        
        // Copy RGBA values
        targetPixels[dstPos] = sourcePixels[srcPos];
        targetPixels[dstPos + 1] = sourcePixels[srcPos + 1];
        targetPixels[dstPos + 2] = sourcePixels[srcPos + 2];
        targetPixels[dstPos + 3] = sourcePixels[srcPos + 3];
      }
    }
  };

  // Effect to start/stop the requestAnimationFrame loop
  useEffect(() => {
    if (session) {
      console.log("Starting session.requestAnimationFrame loop for capture...");
      console.log(`Downsampling: ${USE_DOWNSAMPLING ? 'Enabled' : 'Disabled'}, Factor: ${DOWNSAMPLE_FACTOR}`);
      
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
        console.warn("Session ended, but cancelAnimationFrame might need session object.");
      }
    }
  }, [session]); // Rerun when session changes

  return null; // This component doesn't render anything itself
};
