mod asr;
mod audio;
mod commands;
mod launch;

use tauri_plugin_sql::{Migration, MigrationKind};

/// Database file name; plugin-sql resolves it inside the app config directory.
pub const DB_URL: &str = "sqlite:markpdf.db";

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "mindmap",
            sql: include_str!("../migrations/0002_mindmap.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "text_box_style",
            sql: include_str!("../migrations/0003_text_box_style.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "deck_recordings",
            sql: include_str!("../migrations/0004_deck_recordings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "transcript_original_text",
            sql: include_str!("../migrations/0005_transcript_original_text.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: a second markpdf.exe (e.g. "Open with" on a
        // PDF while we run) hands its argv to this instance and exits.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            launch::on_second_instance(app, args, cwd);
        }))
        .manage(audio::AudioState::default())
        .manage(launch::LaunchFiles::default())
        .manage(asr::AsrState::default())
        .manage(asr::model_manager::ActiveDownloads::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .setup(|app| {
            launch::collect_startup_args(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch::take_launch_files,
            commands::file_sha256,
            commands::copy_file,
            commands::file_size,
            commands::write_bytes_b64,
            commands::print_file,
            audio::audio_start,
            audio::audio_pause,
            audio::audio_resume,
            audio::audio_stop,
            audio::audio_status,
            audio::wav_probe,
            audio::wav_repair,
            audio::audio_inject_wav,
            asr::model_manager::models_download,
            asr::model_manager::models_delete,
            asr::model_manager::models_check,
            asr::model_manager::models_verify,
            asr::model_manager::models_cancel,
            asr::model_manager::models_active,
            asr::asr_start,
            asr::asr_stop,
            asr::asr_bench,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MarkPDF");
}
