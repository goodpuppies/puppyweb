// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|_app| {
            // Print a message to indicate the app is running
            println!("Tauri application running. Press Ctrl+C to exit.");
            Ok(())
        });

    // Run the application
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
