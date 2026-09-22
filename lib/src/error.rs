//! Thin re-export so the code ported verbatim from the host (which uses
//! `crate::error::AppError` throughout) resolves unchanged in this crate.
pub use roc_desk_core::error::AppError;
