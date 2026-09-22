//! SQL 工作台：数据源、查询与结果
//! The business modules are kept behind `business` until their host adapters
//! are replaced by roc_desk-common interfaces.
#[cfg(feature = "business")]
pub mod sql;

pub const TOOL_NAME: &str = "roc_desk-sql";
pub const TOOL_DESCRIPTION: &str = "SQL 工作台：数据源、查询与结果";
pub fn tool_info() -> (&'static str, &'static str) { (TOOL_NAME, TOOL_DESCRIPTION) }
