#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use tauri::{Emitter, Manager};

/// Windows"打开方式"/双击已关联的 .sql 文件时，资源管理器把文件的完整路径
/// 直接拼进 argv（`roc_desk-sql.exe "C:\a\b.sql"`），不带任何前缀标记；这里
/// 只排除看起来像 flag 的参数（`-` 开头），防御性过滤，这个 exe 目前没有任何
/// 命令行 flag。和 host `roc_desk.exe` 的同名辅助函数（`roc_desk/src-tauri/
/// src/lib.rs::extract_open_paths`）逻辑一致，调用方各自负责跳过 argv[0]。
fn extract_open_paths(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|a| !a.starts_with('-'))
        .cloned()
        .collect()
}

/// 冷启动时带的待打开路径——前端挂载后调 `take_pending_open_paths` 取走并
/// 清空（和 host `AppState.pending_open_paths` 同一种模式）。
struct PendingOpenPaths(Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_open_paths(state: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// 读取一个 .sql 脚本文件的文本内容，供"打开方式"/双击关联打开时把内容灌进
/// 一个新查询标签页。这个工具的标签页模型是"内部实体 + 自己的草稿存储"
/// （`sql_workspace_tab_create`/`sql_tab_write_content`），不是直接绑定磁盘
/// 路径，所以需要单独这一个读盘命令——SQL 标准工作台本身没有注册通用的本地
/// 文件读取命令（不像 roc_desk-editor 复用了整套 `roc_desk_explorer::cmd`），
/// 犯不上为了这一个场景把整个 explorer crate 接进来，这里直接用
/// `std::fs::read` + UTF-8 宽松解码（.sql 脚本绝大多数是 UTF-8/ASCII；遇到
/// GBK 等非 UTF-8 编码时宽松解码好过直接报错打不开）。
#[tauri::command]
fn sql_read_external_file_text(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// See the identical helper in `roc_desk-ssh/standalone/src/main.rs` for the
/// full rationale -- if `table_name` already exists (this db file was
/// created by the full `roc_desk.exe` host's own migration set under a
/// different name), record `migration_name` as already-applied so this
/// crate's own migration doesn't try to re-run its `CREATE TABLE` against a
/// table that's already there.
fn bridge_migration_if_table_exists(
    db_path: &std::path::Path,
    migration_name: &str,
    table_name: &str,
) -> Result<(), roc_desk_core::error::AppError> {
    let pool = roc_desk_core::db::pool::create_pool(db_path)?;
    let conn = pool.get()?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;
    let table_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [table_name],
        |r| r.get(0),
    )?;
    if table_exists {
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (name) VALUES (?1)",
            [migration_name],
        )?;
    }
    Ok(())
}

fn main() {
    let mut builder = tauri::Builder::default();
    // 必须是第一个注册的插件（官方文档要求）：已有实例在跑时拦截这次启动，把
    // 新进程 argv 里的文件路径转发给已有窗口而不是真的再开一个窗口实例。
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        let paths = extract_open_paths(argv.get(1..).unwrap_or(&[]));
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        if !paths.is_empty() {
            let _ = app.emit("open-file-paths", paths);
        }
    }));

    // The main window is declared once in tauri.conf.json.
    builder
        .manage(PendingOpenPaths(Mutex::new(extract_open_paths(
            &std::env::args().skip(1).collect::<Vec<_>>(),
        ))))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Portable, exe-relative `.rock_desk` dir (see
            // `roc_desk_core::paths::portable_data_dir` docs) instead of
            // Tauri's OS AppData default — keeps this standalone tool's data
            // in the same place/layout the full `roc_desk.exe` host uses, so
            // copying several standalone tool exes into one directory makes
            // them share it automatically.
            let app_data_dir =
                roc_desk_core::paths::portable_data_dir().expect("resolve app data dir");
            // Same file the host's SQL desktop module reads/writes
            // (`roc_desk.db`, its main db -- see host `src-tauri/src/lib.rs`),
            // not a separate `roc_desk_sql.db` of this exe's own, so data
            // sources/query history saved in either place show up in both.
            let db_path = app_data_dir.join("roc_desk.db");
            bridge_migration_if_table_exists(&db_path, "0001_sql_desktop", "sql_data_sources")
                .expect("bridge legacy roc_desk.db migration state");
            let state = roc_desk_sql::SqlAppState::new(&db_path, app_data_dir)
                .expect("initialize SQL tool state");
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_open_paths,
            sql_read_external_file_text,
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
            // AI provider management.
            roc_desk_sql::cmd::ai_provider_list,
            roc_desk_sql::cmd::ai_provider_create,
            roc_desk_sql::cmd::ai_provider_update,
            roc_desk_sql::cmd::ai_provider_delete,
            roc_desk_sql::cmd::ai_provider_list_models,
            // SQL Agent.
            roc_desk_sql::cmd::sql_agent_start,
            roc_desk_sql::cmd::sql_agent_new_session,
            roc_desk_sql::cmd::sql_agent_close,
            roc_desk_sql::cmd::sql_agent_set_provider,
            roc_desk_sql::cmd::sql_agent_send_message,
            roc_desk_sql::cmd::sql_agent_cancel_turn,
            roc_desk_sql::cmd::sql_agent_resolve_confirm,
            roc_desk_sql::cmd::sql_agent_answer_question,
            roc_desk_sql::cmd::sql_agent_history_list,
            roc_desk_sql::cmd::sql_agent_history_get,
            roc_desk_sql::cmd::sql_agent_history_save,
            roc_desk_sql::cmd::sql_agent_history_resume,
            roc_desk_sql::cmd::sql_agent_history_rename,
            roc_desk_sql::cmd::sql_agent_history_delete,
            // AI assist panel (generate/explain/optimize/fix-error) + change staging.
            roc_desk_sql::cmd::sql_ai_generate,
            roc_desk_sql::cmd::sql_ai_explain,
            roc_desk_sql::cmd::sql_ai_optimize,
            roc_desk_sql::cmd::sql_ai_fix_error,
            roc_desk_sql::cmd::sql_accept_change,
            roc_desk_sql::cmd::sql_reject_change,
            roc_desk_sql::cmd::sql_undo_change,
            roc_desk_sql::cmd::sql_revert_turn,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run standalone tool");
}
