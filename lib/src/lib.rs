//! SQL workspace integration boundary.
#[cfg(feature = "business")]
pub mod sql;
pub const TOOL_NAME: &str = "roc_desk-sql";
pub const TOOL_DESCRIPTION: &str = "SQL 工作台：数据源、查询与结果";
pub use roc_desk_core::database::{DatabaseKind, DataSourceProfile};
pub fn tool_info() -> (&'static str, &'static str) { (TOOL_NAME, TOOL_DESCRIPTION) }
pub fn data_source(id:&str,name:&str,kind:DatabaseKind,host:&str,database:&str)->DataSourceProfile { DataSourceProfile::new(id,name,kind,host,database) }

pub use roc_desk_core::database::{QueryCell, QueryColumn, QueryResult};

pub fn query_result(columns: Vec<QueryColumn>, rows: Vec<Vec<QueryCell>>, affected_rows: Option<u64>, truncated: bool) -> QueryResult { QueryResult { columns, rows, affected_rows, truncated } }
