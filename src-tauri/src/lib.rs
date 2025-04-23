// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// --- Add necessary imports ---
use byteorder::{LittleEndian, ReadBytesExt}; 
use std::{
    io::{self, Cursor}, 
    sync::Arc,
    time::Duration, 
};
use tauri::{AppHandle, Emitter, State}; 
// --- Tokio Imports ---
use tokio::{
    net::windows::named_pipe::{ClientOptions, NamedPipeClient}, 
    io::{AsyncReadExt, AsyncWriteExt, BufReader}, 
    runtime::Runtime,
    sync::Mutex as TokioMutex, 
    time::sleep,
};
use serde::Serialize; // Add Serialize

// --- Define the state struct to hold the pipe connection ---
// Frame pipe state (now asynchronous)
pub struct FramePipeState {
    // Use Tokio's Mutex for async locking
    // Store the write half of the pipe if connection is successful
    pipe_writer: Arc<TokioMutex<Option<tokio::io::WriteHalf<NamedPipeClient>>>>,
    // Use a handle to the Tokio runtime
    rt: tokio::runtime::Handle,
}

// --- Define Payload Struct ---
#[derive(Clone, Serialize)]
struct TransformUpdatePayload {
    matrix: Vec<f32>, // The 16-element flat matrix
}

// --- Constants ---
const FRAME_PIPE_PATH: &str = r"\\.\pipe\petplay-ipc-frames";
const TRANSFORM_PIPE_PATH: &str = r"\\.\pipe\petplay-ipc-transform";
const TRANSFORM_DATA_SIZE: usize = 16 * 4; // 16 floats * 4 bytes/float

impl FramePipeState {
    // Initialize the state and spawn the connection loop
    fn new(rt: tokio::runtime::Handle) -> Self {
        let state = Self {
            pipe_writer: Arc::new(TokioMutex::new(None)),
            rt,
        };
        state.spawn_connection_loop();
        state
    }

    // Spawns the connection loop in the background
    fn spawn_connection_loop(&self) {
        let pipe_writer = Arc::clone(&self.pipe_writer);
        self.rt.spawn(async move {
            loop {
                println!("[Rust Frame Pipe] Attempting to connect to frame pipe: {}", FRAME_PIPE_PATH);
                match ClientOptions::new().open(FRAME_PIPE_PATH) {
                    Ok(client) => {
                        println!("[Rust Frame Pipe] Successfully connected to frame pipe.");
                        let (_reader, writer) = tokio::io::split(client);
                        let mut pipe_guard = pipe_writer.lock().await;
                        *pipe_guard = Some(writer);
                        // Basic disconnect monitoring: If a write fails later, the Option will be set back to None
                        // and the connection loop can be restarted if needed.
                        // For now, we just connect once.
                        break; // Exit loop once connected.
                    }
                    Err(e) => {
                        eprintln!("[Rust Frame Pipe] Failed to connect to frame pipe: {}. Retrying in 1 second...", e);
                        sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        });
    }
}


// --- Tauri Commands ---

// Modify send_frame_data to be async and use the Tokio Mutex/Pipe
#[tauri::command(async)] // Make the command async
async fn send_frame_data(
    request: tauri::ipc::Request<'_>, // Accept the full request
    state: State<'_, FramePipeState>, // Keep the state
) -> Result<(), String> {
    // --- Extract Raw Payload Data --- 
    let tauri::ipc::InvokeBody::Raw(payload) = request.body() else {
        return Err("RequestBodyMustBeRaw".to_string());
    };

    // Ensure the payload is large enough for the header
    if payload.len() < 8 {
        return Err("Payload too small for header".to_string());
    }

    // Parse width and height from the header
    let mut cursor = Cursor::new(&payload[..8]);
    let _width = match ReadBytesExt::read_u32::<LittleEndian>(&mut cursor) { // Keep parsing for potential logging/validation
        Ok(w) => w,
        Err(e) => return Err(format!("Failed to read width from payload: {}", e)),
    };
    let _height = match ReadBytesExt::read_u32::<LittleEndian>(&mut cursor) { // Keep parsing
        Ok(h) => h,
        Err(e) => return Err(format!("Failed to read height from payload: {}", e)),
    };

    // The rest of the payload is the image data (variable not strictly needed if writing full payload)
    // let _data = &payload[8..]; // Prefix unused variable

    // Lock the mutex asynchronously
    let mut pipe_guard = state.pipe_writer.lock().await;

    if let Some(writer) = pipe_guard.as_mut() {
        // Write the *entire original payload* (header + data) to the pipe
        if let Err(e) = writer.write_all(&payload).await { // Write the full payload
            eprintln!("[Rust Frame Pipe] Error writing frame payload: {}. Disconnecting and attempting reconnect.", e);
            // Clear the writer to signal disconnection
            *pipe_guard = None;
            // Spawn a new connection attempt
            state.spawn_connection_loop();
            return Err(format!("Error writing frame payload: {}", e));
        }
        // Optional: Log success with parsed dimensions
        // println!("[Rust Frame Pipe] Sent frame payload: {}x{} ({} bytes data)", _width, _height, payload.len() - 8);
        Ok(())
    } else {
        // eprintln!("[Rust Frame Pipe] Send failed: Not connected.");
        Err("Frame pipe not connected".to_string())
    }
}

// --- Transform Pipe Listener (ensure retry logic is similar) ---
async fn transform_pipe_listener(app_handle: AppHandle) { // Add app_handle parameter
    loop {
        println!("[Rust Transform Pipe] Attempting to connect to transform pipe: {}", TRANSFORM_PIPE_PATH);
        match ClientOptions::new().open(TRANSFORM_PIPE_PATH) {
            Ok(client) => {
                println!("[Rust Transform Pipe] Successfully connected.");
                let mut reader = BufReader::new(client);
                // Pass the reader and app_handle to the handler function
                handle_transform_connection(&mut reader, app_handle.clone()).await; // Pass app_handle
                // If handle_transform_connection returns, it means the client disconnected
                println!("[Rust Transform Pipe] Client disconnected. Attempting to reconnect...");
            }
            Err(e) => {
                eprintln!("[Rust Transform Pipe] Failed to connect: {}. Retrying in 1 second...", e);
                // Retry logic is already here
                sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

// --- Handle Transform Data --- Reads until disconnection or error
async fn handle_transform_connection<R: AsyncReadExt + Unpin>(reader: &mut R, app_handle: AppHandle) { // Add app_handle parameter
    let mut buffer = [0u8; TRANSFORM_DATA_SIZE];
    loop {
        match reader.read_exact(&mut buffer).await {
            Ok(n) if n == TRANSFORM_DATA_SIZE => {
                // --- Process the received transform data ---
                let matrix = deserialize_matrix(&buffer);
                // println!("[Rust Transform Pipe] Received Matrix: {:?}", matrix); // Keep this for debugging if needed

                // --- Emit event to frontend --- 
                let payload = TransformUpdatePayload { matrix };
                if let Err(e) = app_handle.emit("transform-update", payload) {
                     eprintln!("[Rust Transform Pipe] Error emitting transform-update event: {}", e);
                }
                // --- End Emit ---

                // Example: Call a function to update XR state
                // update_xr_transform(matrix);
            }
            Ok(_) => {
                // Incorrect number of bytes read, likely connection issue or bad data
                eprintln!("[Rust Transform Pipe] Incomplete data read. Disconnecting.");
                break; // Exit inner loop to reconnect
            }
            Err(ref e) if e.kind() == io::ErrorKind::UnexpectedEof => {
                // This is the expected error when the client disconnects gracefully
                println!("[Rust Transform Pipe] Client closed the connection.");
                break; // Exit inner loop to reconnect
            }
            Err(e) => {
                eprintln!("[Rust Transform Pipe] Error reading from pipe: {}. Disconnecting.", e);
                break; // Exit inner loop to reconnect
            }
        }
    }
}

 // Helper function to deserialize the matrix (assuming simple float array)
 fn deserialize_matrix(buffer: &[u8]) -> Vec<f32> {
    let mut matrix = Vec::with_capacity(16);
    let mut cursor = Cursor::new(buffer);
    for _ in 0..16 {
        // Read f32 using byteorder
        match ReadBytesExt::read_f32::<LittleEndian>(&mut cursor) { 
             Ok(val) => matrix.push(val),
             Err(e) => {
                 eprintln!("[Rust Transform Pipe] Error deserializing matrix float: {}", e);
                 // Handle error appropriately, maybe return an empty vec or default matrix
                 return vec![0.0; 16]; // Return default on error
             }
         }
    }
    matrix
}


// --- Tauri Setup ---
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create a Tokio runtime
    let rt = Runtime::new().expect("Failed to create Tokio runtime.");
    // Get a handle to the runtime
    let rt_handle = rt.handle().clone();

    tauri::Builder::default()
        .manage(FramePipeState::new(rt_handle.clone())) // Clone the handle here
        .invoke_handler(tauri::generate_handler![send_frame_data]) // Keep only send_frame_data for now
        .setup(move |app| {
            // Spawn the transform pipe listener using the runtime handle
            let app_handle = app.handle().clone(); // Use app handle if needed for events
            let transform_rt_handle = rt_handle.clone(); // Clone handle for transform task
             transform_rt_handle.spawn(async move {
                 transform_pipe_listener(app_handle).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
