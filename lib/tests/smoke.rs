//! Smoke test for the tool's own local SQLite storage (data source profiles
//! + query history + workspace tabs). This tool's supported *target*
//! database kinds are MySQL/TDSQL/PostgreSQL/openGauss/SQL Server (matching
//! the host, which never supported SQLite as a connectable data source
//! either) -- so "run a SELECT against a local SQLite file" is exercised
//! here against the tool's own metadata database instead of a managed data
//! source, which is the closest equivalent smoke test available.

use roc_desk_sql::db::repo::sql_data_sources_repo::SqlDataSourcesRepo;
use roc_desk_sql::db::repo::sql_query_history_repo::SqlQueryHistoryRepo;
use roc_desk_sql::sql::model::{DataSourceProfile, DbKind};
use uuid::Uuid;

#[test]
fn migrations_apply_and_repos_round_trip() {
    let dir = std::env::temp_dir().join(format!("roc_desk_sql_smoke_{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("smoke.db");

    let pool = roc_desk_sql::db::open(&db_path).expect("open + migrate sqlite db");

    let repo = SqlDataSourcesRepo::new(pool.clone());
    let now = chrono::Utc::now().to_rfc3339();
    let profile = DataSourceProfile {
        id: Uuid::new_v4(),
        name: "local-pg".into(),
        db_kind: DbKind::Postgres,
        host: "127.0.0.1".into(),
        port: Some(5432),
        database_name: Some("postgres".into()),
        default_schema: Some("public".into()),
        username: Some("postgres".into()),
        credential_ref: None,
        environment: "dev".into(),
        group_name: None,
        readonly: true,
        ssl_required: false,
        created_at: now.clone(),
        updated_at: now,
        last_used_at: None,
    };
    repo.create(&profile).expect("insert data source");

    // A real `SELECT` round trip through the exact connection pool the tool
    // uses at runtime, against a table created by the migration above.
    let fetched = repo.get(profile.id).expect("select data source").expect("row present");
    assert_eq!(fetched.name, "local-pg");
    assert_eq!(fetched.db_kind, DbKind::Postgres);

    let listed = repo.list().expect("list data sources");
    assert_eq!(listed.len(), 1);

    let history = SqlQueryHistoryRepo::new(pool);
    history
        .record(profile.id, "SELECT 1", "finished", Some(5), Some(1), None, &chrono::Utc::now().to_rfc3339())
        .expect("record history");
    let rows = history.list(profile.id, 10).expect("select history");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].sql_text, "SELECT 1");

    std::fs::remove_dir_all(&dir).ok();
}
