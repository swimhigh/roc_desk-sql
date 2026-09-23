#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    // The main window is declared once in tauri.conf.json.
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("create app data dir");
            let db_path = app_data_dir.join("roc_desk_sql.db");
            let state = roc_desk_sql::SqlAppState::new(&db_path, app_data_dir)
                .expect("initialize SQL tool state");
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            roc_desk_sql::cmd::sql_list_data_sources,
            roc_desk_sql::cmd::sql_save_data_source,
            roc_desk_sql::cmd::sql_delete_data_source,
            roc_desk_sql::cmd::sql_test_connection,
            roc_desk_sql::cmd::sql_preview_template,
            roc_desk_sql::cmd::sql_open_session,
            roc_desk_sql::cmd::sql_close_session,
            roc_desk_sql::cmd::sql_list_databases,
            roc_desk_sql::cmd::sql_current_database,
            roc_desk_sql::cmd::sql_switch_database,
            roc_desk_sql::cmd::sql_list_objects,
            roc_desk_sql::cmd::sql_describe_object,
            roc_desk_sql::cmd::sql_table_page,
            roc_desk_sql::cmd::sql_table_row_count,
            roc_desk_sql::cmd::sql_table_update_cell,
            roc_desk_sql::cmd::sql_table_delete_row,
            roc_desk_sql::cmd::sql_table_insert_row,
            roc_desk_sql::cmd::sql_generate_alter_table,
            roc_desk_sql::cmd::sql_execute,
            roc_desk_sql::cmd::sql_poll_query,
            roc_desk_sql::cmd::sql_cancel,
            roc_desk_sql::cmd::sql_confirm_write,
            roc_desk_sql::cmd::sql_rollback_write,
            roc_desk_sql::cmd::sql_explain,
            roc_desk_sql::cmd::sql_query_history,
            roc_desk_sql::cmd::sql_workspace_tabs_list,
            roc_desk_sql::cmd::sql_workspace_tab_create,
            roc_desk_sql::cmd::sql_workspace_tab_delete,
            roc_desk_sql::cmd::sql_workspace_tab_update_meta,
            roc_desk_sql::cmd::sql_tab_read_content,
            roc_desk_sql::cmd::sql_tab_write_content,
            roc_desk_sql::cmd::sql_export_start,
            roc_desk_sql::cmd::sql_export_poll,
            roc_desk_sql::cmd::sql_export_cancel,
            roc_desk_sql::cmd::sql_import_start,
            roc_desk_sql::cmd::sql_import_poll,
            roc_desk_sql::cmd::sql_import_cancel,
            roc_desk_sql::cmd::sql_write_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run standalone tool");
}
