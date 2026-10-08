mod commands;
mod health_audit;
mod relocation_engine;
mod repair_engine;
mod storage_engine;
mod toolchain;
mod workspace_profile;
mod workspace_environment;
mod process_manager;
mod workstation_intelligence;

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::AppWorkspaceState {
            custom_roots: Mutex::new(Vec::new()),
        })
        .manage(storage_engine::StorageEngineState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let alt_space: Shortcut = "Alt+Space".parse().unwrap();
                        if shortcut == &alt_space {
                            if let Some(window) = app.get_webview_window("main") {
                                let is_visible = window.is_visible().unwrap_or(false);
                                if is_visible {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                    let _ = window.emit("mahi-shortcut-focus-search", ());
                                }
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let alt_space: Shortcut = "Alt+Space".parse().unwrap();
            let global_shortcut = app.global_shortcut();
            if let Err(err) = global_shortcut.register(alt_space) {
                eprintln!("Failed to register Alt+Space global shortcut: {}", err);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::discover_projects,
            commands::get_scan_roots,
            commands::set_scan_roots,
            commands::pick_scan_root,
            commands::get_onboarding_state,
            commands::set_onboarding_state,
            commands::get_appearance_settings,
            commands::set_appearance_settings,
            commands::get_project_details,
            commands::get_git_status,
            commands::open_path,
            commands::open_in_explorer,
            commands::open_in_terminal,
            commands::open_in_vscode,
            commands::check_vscode_available,
            commands::get_recent_projects,
            commands::save_recent_project,
            commands::toggle_app_visibility,
            commands::get_drives,
            commands::read_directory,
            commands::get_file_metadata,
            commands::get_user_locations,
            commands::copy_items,
            commands::move_items,
            commands::rename_item,
            commands::delete_to_recycle_bin,
            commands::delete_permanently,
            commands::create_directory,
            commands::get_detailed_properties,
            commands::read_text_preview,
            commands::read_image_preview,
            commands::get_system_clipboard_files,
            commands::set_system_clipboard_files,
            commands::copy_text_to_clipboard,
            commands::run_project_script,
            commands::stop_project_process,
            commands::get_running_processes,
            commands::get_pinned_projects,
            commands::toggle_pin_project,
            commands::get_project_workspace_config,
            commands::save_project_workspace_config,
            commands::toggle_pin_script,
            commands::get_debug_storage_info,
            commands::clean_debug_artifacts,
            storage_engine::get_storage_overview,
            storage_engine::scan_drive_storage_report,
            storage_engine::get_cleanup_preview,
            storage_engine::execute_safe_cleanup,
            storage_engine::get_cleanup_history,
            relocation_engine::detect_guided_relocation_candidates,
            relocation_engine::get_relocation_preview,
            relocation_engine::execute_guided_relocation, relocation_engine::execute_relocation_restore,
            relocation_engine::cancel_relocation,
            relocation_engine::get_relocation_history,
            health_audit::run_developer_environment_audit,
            health_audit::audit_project_compatibility,
            repair_engine::get_available_repairs,
            repair_engine::execute_developer_environment_repair,
            repair_engine::get_repair_history,
            repair_engine::get_restore_configuration_preview,
            repair_engine::execute_restore_configuration,
            toolchain::get_toolchain_installations,
            toolchain::resolve_project_toolchain,
            workspace_profile::get_workspace_profile,
            workspace_profile::save_workspace_profile,
            workspace_profile::delete_workspace_profile,
            workspace_profile::list_workspace_profiles,
            workspace_profile::validate_workspace_profile,
            workspace_environment::get_workspace_execution_plan,
            workspace_environment::preview_workspace_execution_plan,
            process_manager::start_workspace_execution,
            process_manager::get_workspace_process_status,
            process_manager::get_workspace_process_output,
            process_manager::stop_workspace_process,
            process_manager::list_workspace_processes,
            workstation_intelligence::get_workstation_findings,
            workstation_intelligence::get_workstation_intelligence_summary
        ])
        .run(tauri::generate_context!())
        .expect("error while running MAHI application");
}
