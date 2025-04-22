import { listen } from "jsr:@milly/namedpipe";

const PIPE_PATH = "\\\\.\\pipe\\your-own-name";
const listener = listen({ path: PIPE_PATH });
const FIXED_FRAME_SIZE = 6718464; // Define the constant frame size
const BUFFER_SIZE = FIXED_FRAME_SIZE * 2; // Pre-allocate buffer (e.g., 2 frames)

console.log(`Listening on named pipe: ${PIPE_PATH}`);

// --- Function to handle a single persistent connection with buffering ---
async function handlePersistentConnection(conn: any): Promise<void> {
  console.log("--- new persistent conn ---");
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let totalFramesReceived = 0;
  let connectionClosedCleanly = false;
  let logCounter = 0;

  // Pre-allocated buffer and pointers
  const buffer = new Uint8Array(BUFFER_SIZE);
  let readPos = 0;  // Start position of unread data
  let writePos = 0; // End position of unread data (where next read starts)

  try {
    reader = conn.readable.getReader();

    // Loop indefinitely, reading into the buffer
    while (true) {
      // --- Compact buffer if necessary --- 
      // If readPos > 0 and remaining data is significant, move it to the start
      if (readPos > 0 && writePos > readPos) {
         // Shift the unprocessed data to the beginning of the buffer
         buffer.set(buffer.subarray(readPos, writePos), 0);
         writePos -= readPos; // Adjust write position
         readPos = 0;         // Reset read position
      }
      // Check if buffer is full after compaction (shouldn't happen if BUFFER_SIZE >= FIXED_FRAME_SIZE)
      if (writePos === BUFFER_SIZE) {
          console.error("Buffer full, cannot read more data. Potential logic error or frame size issue.");
          return; // Exit, as we can't proceed
      }

      // --- Read more data into the buffer --- 
      try {
        // Read into the available space after writePos
        const { value, done } = await reader.read(); 
        // Note: reader.read() doesn't allow specifying *where* to read in the buffer directly.
        // We still get a *new* Uint8Array 'value'. We copy it into our buffer.

        if (done) {
          console.log("Stream ended.");
          if (writePos - readPos > 0) {
            console.warn(`Stream ended with ${writePos - readPos} unprocessed bytes in buffer.`);
          }
          connectionClosedCleanly = true;
          return; // Exit the handler
        }

        if (value) {
           // Check if the new data fits
           if (writePos + value.byteLength > BUFFER_SIZE) {
               console.error(`Read data (${value.byteLength} bytes) exceeds buffer capacity (${BUFFER_SIZE - writePos} available). Logic error or buffer too small?`);
               // Consider attempting to process existing frames before exiting?
               return; // Exit to prevent overflow
           }
           // Copy the newly read chunk into our buffer
           buffer.set(value, writePos);
           writePos += value.byteLength;
        }
      } catch (readError) {
        console.error("Error during reader.read():", readError);
        return; // Exit on read error
      }

      // --- Process all complete frames in the buffer --- 
      while (writePos - readPos >= FIXED_FRAME_SIZE) {
          // We have at least one full frame
          const frameDataView = new Uint8Array(buffer.buffer, buffer.byteOffset + readPos, FIXED_FRAME_SIZE);
          
          // TODO: Process the frameDataView (e.g., display, save, etc.)
          // IMPORTANT: If processing is async, make a copy: frameDataView.slice()

          readPos += FIXED_FRAME_SIZE; // Move read position past the processed frame
          totalFramesReceived++;
          logCounter++;

          // Log every N frames 
          if (logCounter >= 10) { 
              console.log(`[Conn] Processed ${totalFramesReceived} frames.`); 
              logCounter = 0;
          }
      }
    } // End of main loop

  } catch (err) {
    console.error("Error during persistent connection handling:", err);
    console.log(`--- persistent conn finished unexpectedly (received ${totalFramesReceived} frames) ---`);
  } finally {
     if (connectionClosedCleanly) {
       console.log(`--- persistent conn finished cleanly after ${totalFramesReceived} frames ---`);
     } else {
        console.log(`--- persistent conn finished unexpectedly (received ${totalFramesReceived} frames) ---`);
     }
    // Cleanup for this specific connection
    if (reader) {
      try {
        reader.releaseLock();
        // console.log("Reader lock released."); // Less verbose
      } catch (releaseError) {
         if (releaseError instanceof Error && (releaseError.message.includes("resource closed") || releaseError.message.includes("has no lock"))) {
             // Ignore expected errors
         } else {
           console.error("Error releasing reader lock:", releaseError);
         }
      }
    }
    try {
      await conn.close();
      // console.log("Server closed connection."); // Less verbose
    } catch (closeError) {
       if (closeError instanceof Error && (closeError.message.includes("operation canceled") || closeError.message.includes("resource closed"))) {
           // Ignore expected errors
       } else {
           console.error("Unexpected error during conn.close:", closeError);
       }
    }
    console.log("------------------------------------" );
  }
}

// --- Main Server Loop ---
async function startServer() {
  while (true) { // Keep listening indefinitely
    try {
      for await (const conn of listener) {
        // Handle each connection persistently, but don't wait for one to finish
        // before accepting the next (though typically only one client will connect)
        handlePersistentConnection(conn).catch(handlerError => {
           console.error("Error in detached connection handler:", handlerError);
           // Allow server to continue listening
        });
      }
    } catch (listenerError) {
      console.error("Listener error:", listenerError);
       if (listenerError instanceof Error && (listenerError.message.includes("operation canceled") || listenerError.message.includes("resource closed"))) {
         console.log("(Listener error likely due to pipe issue - Continuing)");
       } else {
          console.error("!!! Unrecoverable listener error - Stopping server !!!");
          break; // Exit the main loop on fatal listener errors
       }
      await new Promise(resolve => setTimeout(resolve, 1000)); // Delay before retry
    }
  }
  console.log("Server loop exited.");
}

startServer(); // Start the main server loop