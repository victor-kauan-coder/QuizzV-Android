// Sem janela de console no Windows (release)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{webview::NewWindowResponse, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("QuizzV")
                .inner_size(1100.0, 760.0)
                .min_inner_size(380.0, 560.0)
                .center()
                // sem a barra do Windows: o app desenha a dele (TitleBar no App.js)
                .decorations(false)
                // Links externos (GitHub, releases…) abrem no navegador padrão
                .on_new_window(move |url, _| {
                    let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o QuizzV");
}
