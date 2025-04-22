// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// --- Add necessary imports ---
use byteorder::{LittleEndian, WriteBytesExt}; // Needed for binary writing
use parking_lot::Mutex;
use serde::Deserialize; // Needed for JSON deserialization
use std::{
    fs::{File, OpenOptions},
    io::{self, Cursor, Write}, // Cursor needed for in-memory writing
    sync::Arc,
};
use tauri::State;

// --- Define the state struct to hold the pipe connection ---
pub struct PipeState {
    pipe: Arc<Mutex<Option<File>>>,
}

// --- Define struct to deserialize the Frame Meta JSON ---
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")] // Match JS camelCase
struct FrameMeta {
    width: u32,
    height: u32,
}

impl PipeState {
    // Helper function to get or establish the pipe connection
    fn get_or_connect(&self) -> io::Result<File> {
        let mut pipe_guard = self.pipe.lock(); // Lock the mutex

        // If already connected and valid, clone the file handle and return
        if let Some(ref file) = *pipe_guard {
             match file.try_clone() {
                Ok(cloned_file) => return Ok(cloned_file),
                Err(e) => {
                    println!("[TAURI IPC] Failed to clone existing pipe handle, attempting reconnect: {}", e);
                    *pipe_guard = None; // Invalidate the stored handle
                }
            }
        }

        // If not connected (or clone failed), try to connect
        println!("[TAURI IPC] Attempting to connect to named pipe...");
        const PIPE_PATH: &str = r"\\.\pipe\petplay-ipc-frames";
        match OpenOptions::new().write(true).open(PIPE_PATH) {
            Ok(file) => {
                println!("[TAURI IPC] Connected to named pipe.");
                let file_clone = file.try_clone()?; // Clone for returning
                *pipe_guard = Some(file); // Store the original handle in the state
                Ok(file_clone) // Return the clone
            }
            Err(e) => {
                println!("[TAURI IPC] Failed to connect to named pipe: {}", e);
                Err(e)
            }
        }
    }

    // Helper function to write framed data (accepts pre-built Vec<u8>)
    // Tries to connect/reconnect if necessary
    fn write_prepared_data(&self, data: &[u8]) -> io::Result<()> { // Renamed for clarity
        let mut attempts = 0;
        loop {
            attempts += 1;
            // Get a valid connection (or attempt to establish one)
            let mut pipe_file = self.get_or_connect()?;

            // Send frame data
            match pipe_file.write_all(data) {
                Ok(_) => return Ok(()), // Success!
                Err(e) => {
                    println!("[TAURI IPC] Error writing data to pipe: {}", e);
                    // Invalidate the connection in state if write fails
                    self.pipe.lock().take(); // Set Option to None
                    if attempts >= 2 { return Err(e); } // Stop after 2 attempts
                }
            }
            // If write failed, loop will try get_or_connect again (max 1 retry)
            println!("[TAURI IPC] Retrying pipe write (attempt {})...", attempts + 1);
        }
    }
}

// The Tauri command
#[tauri::command]
fn upload(
    request: tauri::ipc::Request,
    pipe_state: State<'_, PipeState>, // Inject the state
) -> Result<(), String> {
    // --- 1. Extract Pixel Data ---
    let tauri::ipc::InvokeBody::Raw(pixel_data) = request.body() else {
        return Err("RequestBodyMustBeRaw".to_string());
    };

    // --- 2. Extract and Parse Metadata Header ---
    let meta_header = request
        .headers()
        .get("X-Frame-Meta")
        .ok_or_else(|| "MissingXFrameMetaHeader".to_string())?; // Error if header missing

    let meta_str = meta_header
        .to_str()
        .map_err(|e| format!("HeaderToStrError: {}", e))?; // Error if not valid UTF-8

    let meta: FrameMeta = serde_json::from_str(meta_str)
        .map_err(|e| format!("JsonParseError: {}", e))?; // Error if JSON invalid

    // --- 3. Construct the Full Payload (Metadata + Pixels) ---
    // Expected Size: 4(w) + 4(h) + pixels.len()
    let header_size = 4 + 4;
    let total_size = header_size + pixel_data.len();
    let mut final_payload = Vec::with_capacity(total_size);

    // Use Cursor to write binary data in memory easily
    let mut writer = Cursor::new(&mut final_payload);

    writer
        .write_u32::<LittleEndian>(meta.width)
        .map_err(|e| format!("WriteErrorWidth: {}", e))?;
    writer
        .write_u32::<LittleEndian>(meta.height)
        .map_err(|e| format!("WriteErrorHeight: {}", e))?;

    // Append pixel data directly
    writer
        .write_all(&pixel_data)
        .map_err(|e| format!("WriteErrorPixels: {}", e))?;

    // Drop the cursor to release the borrow on final_payload if needed, though it goes out of scope anyway.
    // drop(writer); // Not strictly necessary here

    // --- 4. Write the combined payload to the pipe ---
    match pipe_state.write_prepared_data(&final_payload) {
        Ok(_) => {
             // Optional: Log success less frequently? Or only size?
             // println!("[TAURI IPC] Forwarded frame ({} bytes total) via pipe.", final_payload.len());
            Ok(())
        }
        Err(e) => {
            println!("[TAURI IPC] Failed to forward frame via persistent pipe after retries: {}", e);
            // Decide if this should be a frontend error or just logged
            Err(format!("PipeWriteError: {}", e))
        }
    }
}


#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
         // --- Manage the PipeState ---
        .manage(PipeState { pipe: Arc::new(Mutex::new(None)) }) // Initialize state
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, upload])
        .setup(|_app| {
            // Print a message to indicate the app is running
            println!("Tauri application running. Press Ctrl+C to exit.");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
