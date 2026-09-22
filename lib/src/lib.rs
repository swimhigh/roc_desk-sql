//! SQL workspace tool: data source management, SQL execution, and result
//! browsing.
//!
//! ## Migration status (see the repository README for the full writeup)
//!
//! Ported and command-tested via `cargo check`:
//! - Data source CRUD + credential storage (`sql::service::SqlDataSourceService`)
//! - Session management / object browsing (`sql::service::SqlSessionManager`,
//!   `sql::adapter`)
//! - SQL execution, polling, cancellation, write confirmation
//!   (`sql::executor`, `sql::policy`)
//! - Table data browsing/editing (`sql::data_editor`)
//! - Query history (`db::repo::sql_query_history_repo`)
//! - Workspace tabs / local `.sql` file cache (`sql::workspace_cache`,
//!   `db::repo::sql_workspace_tabs_repo`)
//! - Export/import transfer (`sql::transfer`)
//! - Three database adapters: MySQL/TDSQL, PostgreSQL/openGauss, SQL Server
//!   (Oracle was already unimplemented in the host — `registry::create_adapter`
//!   returns a clear "not implemented" error for it, unchanged)
//!
//! **Not ported in this pass** (left as host-only, not stubbed with fake
//! implementations):
//! - The SQL Agent AI chat loop (host's `sql::agent`, `commands/sql_agent.rs`)
//!   and the AI generate/explain/optimize/fix-error assist panel (host's
//!   `sql::ai_assistant`, the `sql_ai_*` commands) and the accept/reject/undo
//!   change-staging commands built on `coding::ChangeStore`. All of these
//!   depend on host-only `crate::ai` (`AiProviderManager`, `AiChatClient`),
//!   `crate::agent_llm`, and `crate::coding` types that have not yet been
//!   extracted into `roc_desk_core`. Porting them is a follow-up task once
//!   that AI infrastructure has a home in `roc_desk_core`.

pub mod credential;
pub mod error;
#[cfg(feature = "business")]
pub mod db;
#[cfg(feature = "business")]
pub mod sql;

pub const TOOL_NAME: &str = "roc_desk-sql";
pub const TOOL_DESCRIPTION: &str = "SQL 工作台：数据源、查询与结果";

/// Returns the user-visible metadata used by the standalone shell and host launcher.
pub fn tool_info() -> (&'static str, &'static str) {
    (TOOL_NAME, TOOL_DESCRIPTION)
}

/// Shared state for the SQL tool's Tauri commands: connection pool-backed
/// services plus in-memory session/query-execution registries. Constructed
/// once at startup (see [`SqlAppState::new`]) and registered with
/// `tauri::Builder::manage`.
#[cfg(feature = "business")]
pub struct SqlAppState {
    pub data_source_service: std::sync::Arc<sql::service::SqlDataSourceService>,
    pub session_manager: std::sync::Arc<sql::service::SqlSessionManager>,
    pub executor: sql::executor::QueryExecutor,
    pub query_history: std::sync::Arc<db::repo::sql_query_history_repo::SqlQueryHistoryRepo>,
    pub workspace_tabs: std::sync::Arc<db::repo::sql_workspace_tabs_repo::SqlWorkspaceTabsRepo>,
    pub workspace_cache: std::sync::Arc<sql::workspace_cache::SqlWorkspaceCache>,
    pub transfer_manager: std::sync::Arc<sql::transfer::TransferManager>,
}

#[cfg(feature = "business")]
impl SqlAppState {
    /// `db_path` is this tool's own SQLite file (data sources / query
    /// history / workspace tab metadata); `cache_root` is the directory the
    /// per-data-source `.sql` tab cache is created under (a `sql/` subdir is
    /// appended, mirroring the host's `SqlWorkspaceCache::new`).
    pub fn new(db_path: &std::path::Path, cache_root: std::path::PathBuf) -> Result<Self, error::AppError> {
        let pool = db::open(db_path)?;
        let credential_store: std::sync::Arc<dyn credential::CredentialStore> =
            std::sync::Arc::new(credential::KeyringStore);
        let repo = std::sync::Arc::new(db::repo::sql_data_sources_repo::SqlDataSourcesRepo::new(pool.clone()));
        let data_source_service = std::sync::Arc::new(sql::service::SqlDataSourceService::new(repo, credential_store));
        let session_manager = std::sync::Arc::new(sql::service::SqlSessionManager::new(data_source_service.clone()));
        Ok(Self {
            data_source_service,
            session_manager,
            executor: sql::executor::QueryExecutor::new(),
            query_history: std::sync::Arc::new(db::repo::sql_query_history_repo::SqlQueryHistoryRepo::new(pool.clone())),
            workspace_tabs: std::sync::Arc::new(db::repo::sql_workspace_tabs_repo::SqlWorkspaceTabsRepo::new(pool)),
            workspace_cache: std::sync::Arc::new(sql::workspace_cache::SqlWorkspaceCache::new(cache_root)),
            transfer_manager: std::sync::Arc::new(sql::transfer::TransferManager::new()),
        })
    }
}

/// The `#[tauri::command]` functions must live in a submodule, not at the
/// crate root -- Tauri's command macro emits a `#[macro_export]` macro_rules
/// item *and* a self-referential `pub use` of the same name in the enclosing
/// scope, which collide at crate root (`E0255`). `standalone/src/main.rs`
/// and the host reference these as `roc_desk_sql::cmd::sql_execute`, etc.
#[cfg(feature = "business")]
pub mod cmd {
    use std::sync::Arc;

    use chrono::Utc;
    use serde::Serialize;
    use sqlparser::ast::Statement;
    use tauri::State;
    use uuid::Uuid;

    use crate::error::AppError;
    use crate::sql::adapter::{new_backend_handle_slot, AdapterSession};
    use crate::sql::data_editor::{self, AlterOp, CellInput, NamedCell};
    use crate::sql::model::*;
    use crate::sql::policy::{self, ExecutionKind};
    use crate::sql::registry;
    use crate::sql::transfer::{TransferFormat, TransferProgress};
    use crate::SqlAppState;

    fn require_writable(profile: &DataSourceProfile) -> Result<(), AppError> {
        if profile.readonly {
            return Err(AppError::PermissionDenied(
                "该数据源已开启只读模式，拒绝执行写操作".into(),
            ));
        }
        Ok(())
    }

    #[derive(Debug, Clone, Serialize)]
    #[serde(tag = "kind")]
    pub enum ExecuteOutcome {
        Started { query_id: Uuid },
        NeedsConfirmation,
        PendingWrite(PendingWrite),
    }

    const PENDING_WRITE_MAX_AGE_SECS: u64 = 10 * 60;
    const TEST_CONNECTION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

    fn statement_allows_readonly(statement: &Statement) -> bool {
        matches!(statement, Statement::Query(_) | Statement::Explain { .. })
    }

    async fn open_session(
        state: &State<'_, SqlAppState>,
        data_source_id: Uuid,
    ) -> Result<Arc<dyn AdapterSession>, AppError> {
        state.session_manager.sweep_stale_pending_writes(PENDING_WRITE_MAX_AGE_SECS).await;
        state.session_manager.get_or_open(data_source_id).await
    }

    fn require_data_source(state: &State<'_, SqlAppState>, id: Uuid) -> Result<DataSourceProfile, AppError> {
        state
            .data_source_service
            .get(id)?
            .ok_or_else(|| AppError::NotFound(format!("data source not found: {id}")))
    }

    // -----------------------------------------------------------------------
    // 数据源 CRUD
    // -----------------------------------------------------------------------

    #[tauri::command]
    pub fn sql_list_data_sources(state: State<'_, SqlAppState>) -> Result<Vec<DataSourceProfile>, AppError> {
        state.data_source_service.list()
    }

    #[tauri::command]
    pub async fn sql_save_data_source(
        state: State<'_, SqlAppState>,
        id: Option<Uuid>,
        input: DataSourceInput,
    ) -> Result<DataSourceProfile, AppError> {
        match id {
            Some(id) => state.data_source_service.update(id, input).await,
            None => state.data_source_service.create(input).await,
        }
    }

    #[tauri::command]
    pub async fn sql_delete_data_source(state: State<'_, SqlAppState>, id: Uuid) -> Result<(), AppError> {
        state.session_manager.close(id).await;
        state.data_source_service.delete(id).await
    }

    #[tauri::command]
    pub async fn sql_test_connection(
        state: State<'_, SqlAppState>,
        id: Option<Uuid>,
        input: DataSourceInput,
    ) -> Result<DbInfo, AppError> {
        let password = match &input.password {
            Some(p) if !p.is_empty() => Some(p.clone()),
            _ => match id {
                Some(id) => {
                    let existing = require_data_source(&state, id)?;
                    match existing.credential_ref {
                        Some(key) => {
                            // Resolve through the data source service so the
                            // same credential store instance is used.
                            let resolved = state.data_source_service.resolve(id).await?;
                            let _ = key;
                            resolved.password
                        }
                        None => None,
                    }
                }
                None => None,
            },
        };
        let resolved = ResolvedProfile {
            id: id.unwrap_or_else(Uuid::new_v4),
            db_kind: input.db_kind,
            host: input.host.clone(),
            port: input.port.unwrap_or_else(|| input.db_kind.default_port().unwrap_or(0)),
            database_name: input.database_name.clone(),
            default_schema: input.default_schema.clone(),
            username: input.username.clone(),
            password,
            ssl_required: input.ssl_required,
            readonly: input.readonly,
        };
        let adapter = registry::create_adapter(input.db_kind)?;
        match tokio::time::timeout(TEST_CONNECTION_TIMEOUT, adapter.test_connection(&resolved)).await {
            Ok(result) => result,
            Err(_) => Err(AppError::Connection(format!(
                "连接测试超时（{}s），请检查主机地址/端口/网络策略是否正确",
                TEST_CONNECTION_TIMEOUT.as_secs()
            ))),
        }
    }

    // -----------------------------------------------------------------------
    // 会话 / 对象浏览
    // -----------------------------------------------------------------------

    #[tauri::command]
    pub fn sql_preview_template(state: State<'_, SqlAppState>, data_source_id: Uuid, object: ObjectRef) -> Result<String, AppError> {
        let profile = require_data_source(&state, data_source_id)?;
        Ok(crate::sql::adapter::preview_sql(profile.db_kind, &object))
    }

    #[tauri::command]
    pub async fn sql_open_session(state: State<'_, SqlAppState>, data_source_id: Uuid) -> Result<(), AppError> {
        open_session(&state, data_source_id).await?;
        Ok(())
    }

    #[tauri::command]
    pub async fn sql_close_session(state: State<'_, SqlAppState>, data_source_id: Uuid) -> Result<(), AppError> {
        state.session_manager.close(data_source_id).await;
        Ok(())
    }

    #[tauri::command]
    pub async fn sql_list_databases(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
    ) -> Result<Vec<String>, AppError> {
        let session = open_session(&state, data_source_id).await?;
        session.list_databases().await
    }

    #[tauri::command]
    pub async fn sql_current_database(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
    ) -> Result<Option<String>, AppError> {
        state.session_manager.current_database_name(data_source_id).await
    }

    #[tauri::command]
    pub async fn sql_switch_database(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        database_name: String,
    ) -> Result<(), AppError> {
        state.session_manager.switch_database(data_source_id, database_name).await;
        Ok(())
    }

    #[tauri::command]
    pub async fn sql_list_objects(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
    ) -> Result<ObjectPage, AppError> {
        let session = open_session(&state, data_source_id).await?;
        let objects = session.list_objects().await?;
        Ok(ObjectPage { objects })
    }

    fn synthesize_ddl(def: &ObjectDefinition) -> String {
        if let Some(ddl) = &def.ddl {
            return ddl.clone();
        }
        let mut out = format!("-- {}.{} 列结构（自动生成的摘要，不是原始 DDL）\n", def.object.schema, def.object.name);
        for col in &def.columns {
            out.push_str(&format!(
                "{}  {}{}{}\n",
                col.name,
                col.data_type,
                if col.nullable { "" } else { " NOT NULL" },
                if col.is_primary_key { " PRIMARY KEY" } else { "" }
            ));
        }
        for idx in &def.indexes {
            out.push_str(&format!("-- INDEX {}: {}\n", idx.name, idx.definition));
        }
        out
    }

    #[tauri::command]
    pub async fn sql_describe_object(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        object: ObjectRef,
    ) -> Result<ObjectDefinition, AppError> {
        let session = open_session(&state, data_source_id).await?;
        let def = session.describe_object(&object).await?;
        let cache_text = synthesize_ddl(&def);
        let _ = state
            .workspace_cache
            .write_schema_ddl(data_source_id, &object.schema, &object.name, &cache_text);
        Ok(def)
    }

    // -----------------------------------------------------------------------
    // 表数据浏览 / 编辑
    // -----------------------------------------------------------------------

    #[tauri::command]
    pub async fn sql_table_page(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        object: ObjectRef,
        limit: usize,
        offset: usize,
    ) -> Result<ExecuteResult, AppError> {
        let profile = require_data_source(&state, data_source_id)?;
        let session = open_session(&state, data_source_id).await?;
        let def = session.describe_object(&object).await?;
        let order_col = def.columns.iter().find(|c| c.is_primary_key).map(|c| c.name.clone());
        let sql = data_editor::build_page_query(profile.db_kind, &object, order_col.as_deref(), limit, offset);
        session.execute_sql(&sql, limit, new_backend_handle_slot()).await
    }

    #[tauri::command]
    pub async fn sql_table_row_count(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        object: ObjectRef,
    ) -> Result<u64, AppError> {
        let profile = require_data_source(&state, data_source_id)?;
        let session = open_session(&state, data_source_id).await?;
        let sql = data_editor::build_count_query(profile.db_kind, &object);
        let result = session.execute_sql(&sql, 1, new_backend_handle_slot()).await?;
        let text = result
            .rows
            .first()
            .and_then(|r| r.first())
            .map(|c| c.text.clone())
            .unwrap_or_default();
        Ok(text.parse().unwrap_or(0))
    }

    #[tauri::command]
    pub async fn sql_table_update_cell(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        object: ObjectRef,
        pk: Vec<NamedCell>,
        column: String,
        value: CellInput,
    ) -> Result<(), AppError> {
        let profile = require_data_source(&state, data_source_id)?;
        require_writable(&profile)?;
        let session = open_session(&state, data_source_id).await?;
        let sql = data_editor::build_update_cell(profile.db_kind, &object, &pk, &column, &value);
        session.execute_sql(&sql, 0, new_backend_handle_slot()).await?;
        record_history(&state, data_source_id, &sql, "finished", None, Some(1), None);
        Ok(())
    }

    #[tauri::command]
    pub async fn sql_table_delete_row(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        object: ObjectRef,
        pk: Vec<NamedCell>,
    ) -> Result<(), AppError> {
        let profile = require_data_source(&state, data_source_id)?;
        require_writable(&profile)?;
        let session = open_session(&state, data_source_id).await?;
        let sql = data_editor::build_delete_row(profile.db_kind, &object, &pk);
        session.execute_sql(&sql, 0, new_backend_handle_slot()).await?;
        record_history(&state, data_source_id, &sql, "finished", None, Some(1), None);
        Ok(())
    }

    #[tauri::command]
    pub async fn sql_table_insert_row(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        object: ObjectRef,
        values: Vec<NamedCell>,
    ) -> Result<(), AppError> {
        let profile = require_data_source(&state, data_source_id)?;
        require_writable(&profile)?;
        let session = open_session(&state, data_source_id).await?;
        let sql = data_editor::build_insert_row(profile.db_kind, &object, &values);
        session.execute_sql(&sql, 0, new_backend_handle_slot()).await?;
        record_history(&state, data_source_id, &sql, "finished", None, Some(1), None);
        Ok(())
    }

    #[tauri::command]
    pub fn sql_generate_alter_table(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        object: ObjectRef,
        ops: Vec<AlterOp>,
    ) -> Result<Vec<String>, AppError> {
        let profile = require_data_source(&state, data_source_id)?;
        Ok(data_editor::build_alter_table(profile.db_kind, &object, &ops))
    }

    // -----------------------------------------------------------------------
    // 执行 / 取消 / 写操作确认
    // -----------------------------------------------------------------------

    #[tauri::command]
    pub async fn sql_execute(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        sql: String,
        confirmed: bool,
    ) -> Result<ExecuteOutcome, AppError> {
        let profile = require_data_source(&state, data_source_id)?;
        let (statement, execution_kind) = policy::parse_and_classify(&sql, profile.db_kind)?;

        if profile.readonly && !statement_allows_readonly(&statement) {
            return Err(AppError::PermissionDenied(
                "该数据源已开启只读模式，拒绝执行写操作".into(),
            ));
        }

        let session = open_session(&state, data_source_id).await?;

        match execution_kind {
            ExecutionKind::Transaction => {
                let pending = session.begin_write(&sql).await?;
                record_history(
                    &state,
                    data_source_id,
                    &sql,
                    "pending_confirm",
                    None,
                    pending.rows_affected.map(|n| n as i64),
                    None,
                );
                Ok(ExecuteOutcome::PendingWrite(pending))
            }
            ExecutionKind::Confirm if !confirmed => Ok(ExecuteOutcome::NeedsConfirmation),
            ExecutionKind::Normal | ExecutionKind::Confirm => {
                record_history(&state, data_source_id, &sql, "started", None, None, None);
                let query_id = state.executor.spawn_with_backend_handle(move |slot| {
                    let session = session.clone();
                    let sql = sql.clone();
                    async move { session.execute_sql(&sql, 1000, slot).await }
                });
                Ok(ExecuteOutcome::Started { query_id })
            }
        }
    }

    fn record_history(
        state: &State<'_, SqlAppState>,
        data_source_id: Uuid,
        sql: &str,
        status: &str,
        duration_ms: Option<i64>,
        row_count: Option<i64>,
        error_message: Option<&str>,
    ) {
        let _ = state.query_history.record(
            data_source_id,
            sql,
            status,
            duration_ms,
            row_count,
            error_message,
            &Utc::now().to_rfc3339(),
        );
    }

    #[tauri::command]
    pub async fn sql_poll_query(state: State<'_, SqlAppState>, query_id: Uuid) -> Result<QueryPoll, AppError> {
        state.executor.poll(query_id).await
    }

    #[tauri::command]
    pub async fn sql_cancel(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        query_id: Uuid,
    ) -> Result<(), AppError> {
        let backend_handle = state.executor.abort(query_id);
        if let Some(handle) = backend_handle {
            let session = open_session(&state, data_source_id).await?;
            session.kill_backend(&handle).await?;
        }
        Ok(())
    }

    #[tauri::command]
    pub async fn sql_confirm_write(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        pending_id: Uuid,
    ) -> Result<ExecuteResult, AppError> {
        let session = open_session(&state, data_source_id).await?;
        session.commit_write(pending_id).await
    }

    #[tauri::command]
    pub async fn sql_rollback_write(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        pending_id: Uuid,
    ) -> Result<(), AppError> {
        let session = open_session(&state, data_source_id).await?;
        session.rollback_write(pending_id).await
    }

    #[tauri::command]
    pub async fn sql_explain(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        sql: String,
    ) -> Result<ExecuteResult, AppError> {
        let profile = require_data_source(&state, data_source_id)?;
        if matches!(profile.db_kind, DbKind::SqlServer) {
            return Err(AppError::Internal(
                "SQL Server 的执行计划获取暂未实现（需要单独的 SET SHOWPLAN 会话开关）".into(),
            ));
        }
        let session = open_session(&state, data_source_id).await?;
        let explain_sql = format!("EXPLAIN {sql}");
        let slot = crate::sql::adapter::new_backend_handle_slot();
        session.execute_sql(&explain_sql, 1000, slot).await
    }

    #[tauri::command]
    pub fn sql_query_history(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        limit: i64,
    ) -> Result<Vec<QueryHistoryEntry>, AppError> {
        state.query_history.list(data_source_id, limit)
    }

    // -----------------------------------------------------------------------
    // 工作区标签页
    // -----------------------------------------------------------------------

    #[tauri::command]
    pub fn sql_workspace_tabs_list(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
    ) -> Result<Vec<WorkspaceTab>, AppError> {
        state.workspace_tabs.list_for_data_source(data_source_id)
    }

    #[tauri::command]
    pub fn sql_workspace_tab_create(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        title: String,
    ) -> Result<WorkspaceTab, AppError> {
        let tab_id = Uuid::new_v4();
        let file_path = state.workspace_cache.create_tab_file(data_source_id, tab_id)?;
        let now = Utc::now().to_rfc3339();
        let tab = WorkspaceTab {
            id: tab_id,
            data_source_id,
            title,
            file_path,
            result_view_mode: "table".to_string(),
            cursor_json: None,
            sort_order: 0,
            updated_at: now,
        };
        state.workspace_tabs.create(&tab)?;
        Ok(tab)
    }

    #[tauri::command]
    pub fn sql_workspace_tab_delete(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        tab_id: Uuid,
    ) -> Result<(), AppError> {
        if let Some(tab) = state.workspace_tabs.get(tab_id)? {
            let _ = state.workspace_cache.delete_tab_file(data_source_id, &tab.file_path);
        }
        state.workspace_tabs.delete(tab_id)
    }

    #[tauri::command]
    #[allow(clippy::too_many_arguments)]
    pub fn sql_workspace_tab_update_meta(
        state: State<'_, SqlAppState>,
        tab_id: Uuid,
        title: String,
        result_view_mode: String,
        cursor_json: Option<String>,
        sort_order: i64,
    ) -> Result<(), AppError> {
        state.workspace_tabs.update_meta(
            tab_id,
            &title,
            &result_view_mode,
            cursor_json.as_deref(),
            sort_order,
            &Utc::now().to_rfc3339(),
        )
    }

    #[tauri::command]
    pub fn sql_tab_read_content(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        tab_id: Uuid,
    ) -> Result<String, AppError> {
        let tab = state
            .workspace_tabs
            .get(tab_id)?
            .ok_or_else(|| AppError::NotFound(format!("tab not found: {tab_id}")))?;
        state.workspace_cache.read_tab_content(data_source_id, &tab.file_path)
    }

    #[tauri::command]
    pub fn sql_tab_write_content(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        tab_id: Uuid,
        content: String,
    ) -> Result<(), AppError> {
        let tab = state
            .workspace_tabs
            .get(tab_id)?
            .ok_or_else(|| AppError::NotFound(format!("tab not found: {tab_id}")))?;
        state
            .workspace_cache
            .write_tab_content(data_source_id, &tab.file_path, &content)?;
        state.workspace_tabs.update_meta(
            tab_id,
            &tab.title,
            &tab.result_view_mode,
            tab.cursor_json.as_deref(),
            tab.sort_order,
            &Utc::now().to_rfc3339(),
        )
    }

    // -----------------------------------------------------------------------
    // 导出 / 导入
    // -----------------------------------------------------------------------

    #[tauri::command]
    pub async fn sql_export_start(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        object: ObjectRef,
        format: TransferFormat,
        file_path: String,
        resume: bool,
    ) -> Result<Uuid, AppError> {
        let profile = require_data_source(&state, data_source_id)?;
        let session = open_session(&state, data_source_id).await?;
        let def = session.describe_object(&object).await?;
        let order_col = def.columns.iter().find(|c| c.is_primary_key).map(|c| c.name.clone());
        state
            .transfer_manager
            .start_export(session, profile.db_kind, object, order_col, format, file_path, resume)
            .await
    }

    #[tauri::command]
    pub fn sql_export_poll(state: State<'_, SqlAppState>, export_id: Uuid) -> Result<TransferProgress, AppError> {
        state.transfer_manager.poll(export_id)
    }

    #[tauri::command]
    pub fn sql_export_cancel(state: State<'_, SqlAppState>, export_id: Uuid) -> Result<(), AppError> {
        state.transfer_manager.cancel(export_id);
        Ok(())
    }

    #[tauri::command]
    #[allow(clippy::too_many_arguments)]
    pub async fn sql_import_start(
        state: State<'_, SqlAppState>,
        data_source_id: Uuid,
        object: ObjectRef,
        file_path: String,
        has_header: bool,
        resume: bool,
    ) -> Result<Uuid, AppError> {
        let profile = require_data_source(&state, data_source_id)?;
        require_writable(&profile)?;
        let session = open_session(&state, data_source_id).await?;
        let columns = if has_header {
            read_csv_header(&file_path)?
        } else {
            let def = session.describe_object(&object).await?;
            def.columns.into_iter().map(|c| c.name).collect()
        };
        state
            .transfer_manager
            .start_import(session, profile.db_kind, object, columns, file_path, has_header, resume)
            .await
    }

    fn read_csv_header(file_path: &str) -> Result<Vec<String>, AppError> {
        use std::io::BufRead;
        let file = std::fs::File::open(file_path)?;
        let mut reader = std::io::BufReader::new(file);
        let mut line = String::new();
        reader.read_line(&mut line)?;
        Ok(line.trim_end_matches(['\r', '\n']).split(',').map(|s| s.trim().to_string()).collect())
    }

    #[tauri::command]
    pub fn sql_import_poll(state: State<'_, SqlAppState>, import_id: Uuid) -> Result<TransferProgress, AppError> {
        state.transfer_manager.poll(import_id)
    }

    #[tauri::command]
    pub fn sql_import_cancel(state: State<'_, SqlAppState>, import_id: Uuid) -> Result<(), AppError> {
        state.transfer_manager.cancel(import_id);
        Ok(())
    }

    #[tauri::command]
    pub async fn sql_write_text_file(path: String, content: String) -> Result<(), AppError> {
        tokio::fs::write(&path, content).await?;
        Ok(())
    }
}
