//! SQL tool's own SQLite-backed storage: data source profiles, query
//! history, and workspace tab metadata. Built on top of
//! `roc_desk_core::db::{DbPool, migrate}` (the pool + generic migration
//! runner shared by all tool crates) but the schema/tables here are specific
//! to this tool, so they live in this crate rather than in `roc_desk_core`.

pub mod repo;

pub use roc_desk_core::db::DbPool;

// The `sql_agent_history` table (host migration 0021) is intentionally not
// included here yet: it belongs to the AI Agent feature, which this crate
// does not implement in this pass (see README "Migration status").
const MIGRATIONS: &[(&str, &str)] = &[(
    "0001_sql_desktop",
    include_str!("../../migrations/0001_sql_desktop.sql"),
)];

/// Opens (creating if needed) the SQL tool's SQLite database at `db_path` and
/// applies any migrations that haven't run yet.
pub fn open(db_path: &std::path::Path) -> Result<DbPool, roc_desk_core::error::AppError> {
    let pool = roc_desk_core::db::pool::create_pool(db_path)?;
    let conn = pool.get()?;
    roc_desk_core::db::migrate::apply_migrations(&conn, MIGRATIONS)?;
    Ok(pool)
}
