//! Filesystem snapshot tracking for undo support.
//!
//! Records file contents before and after code generation,
//! enabling `contribai undo` to rollback changes.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::info;

use crate::core::error::Result;

/// A snapshot of a file before/after changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSnapshot {
    pub repo: String,
    pub path: String,
    pub before: Option<String>,
    pub after: String,
    pub timestamp: String,
    pub run_id: Option<i64>,
}

/// Snapshot manager for undo support.
pub struct SnapshotManager {
    db: Connection,
}

impl SnapshotManager {
    /// Open or create the snapshot database.
    pub fn new(db_path: &Path) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(db_path).map_err(|e| {
            crate::core::error::ContribError::Database(format!("Snapshot DB open: {}", e))
        })?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS file_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repo TEXT NOT NULL,
                path TEXT NOT NULL,
                before TEXT,
                after TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                run_id INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_snapshots_repo ON file_snapshots(repo);
            CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON file_snapshots(timestamp DESC);",
        )
        .map_err(|e| {
            crate::core::error::ContribError::Database(format!("Snapshot schema: {}", e))
        })?;

        Ok(Self { db: conn })
    }

    /// Record a snapshot of a file change.
    pub fn record(&self, snapshot: &FileSnapshot) -> Result<i64> {
        let id = self
            .db
            .prepare(
                "INSERT INTO file_snapshots (repo, path, before, after, timestamp, run_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|e| {
                crate::core::error::ContribError::Database(format!("Snapshot insert: {}", e))
            })?
            .insert(params![
                snapshot.repo,
                snapshot.path,
                snapshot.before,
                snapshot.after,
                snapshot.timestamp,
                snapshot.run_id,
            ])
            .map_err(|e| {
                crate::core::error::ContribError::Database(format!("Snapshot insert exec: {}", e))
            })?;

        info!(
            repo = %snapshot.repo,
            path = %snapshot.path,
            "Snapshot recorded"
        );
        Ok(id)
    }

    /// Get the latest snapshot for a repo, optionally filtered by path.
    pub fn get_latest(&self, repo: &str, path: Option<&str>) -> Result<Option<FileSnapshot>> {
        let query = if path.is_some() {
            "SELECT repo, path, before, after, timestamp, run_id
             FROM file_snapshots
             WHERE repo = ?1 AND path = ?2
             ORDER BY id DESC LIMIT 1"
        } else {
            "SELECT repo, path, before, after, timestamp, run_id
             FROM file_snapshots
             WHERE repo = ?1
             ORDER BY id DESC LIMIT 50"
        };

        if let Some(p) = path {
            let row = self
                .db
                .query_row(query, params![repo, p], |r| {
                    Ok(FileSnapshot {
                        repo: r.get(0)?,
                        path: r.get(1)?,
                        before: r.get(2)?,
                        after: r.get(3)?,
                        timestamp: r.get(4)?,
                        run_id: r.get(5)?,
                    })
                })
                .optional()
                .map_err(|e| {
                    crate::core::error::ContribError::Database(format!("Snapshot query: {}", e))
                })?;
            Ok(row)
        } else {
            let mut stmt = self.db.prepare(query).map_err(|e| {
                crate::core::error::ContribError::Database(format!("Snapshot prepare: {}", e))
            })?;
            let rows = stmt
                .query_map(params![repo], |r| {
                    Ok(FileSnapshot {
                        repo: r.get(0)?,
                        path: r.get(1)?,
                        before: r.get(2)?,
                        after: r.get(3)?,
                        timestamp: r.get(4)?,
                        run_id: r.get(5)?,
                    })
                })
                .map_err(|e| {
                    crate::core::error::ContribError::Database(format!("Snapshot query: {}", e))
                })?;

            let snapshots: Vec<FileSnapshot> = rows.filter_map(|r| r.ok()).collect();
            Ok(snapshots.into_iter().next())
        }
    }

    /// Delete snapshots for a repo (cleanup after undo).
    pub fn clear_repo(&self, repo: &str) -> Result<usize> {
        let count = self
            .db
            .execute("DELETE FROM file_snapshots WHERE repo = ?1", params![repo])
            .map_err(|e| {
                crate::core::error::ContribError::Database(format!("Snapshot delete: {}", e))
            })?;
        info!(repo, count, "Snapshots cleared");
        Ok(count)
    }

    /// Get total snapshot count.
    pub fn count(&self) -> Result<i64> {
        self.db
            .query_row("SELECT COUNT(*) FROM file_snapshots", [], |r| r.get(0))
            .map_err(|e| {
                crate::core::error::ContribError::Database(format!("Snapshot count: {}", e))
            })
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_manager() -> SnapshotManager {
        let path = std::env::temp_dir().join(format!(
            "test_snapshots_{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        SnapshotManager::new(&path).unwrap()
    }

    #[test]
    fn test_record_and_retrieve() {
        let mgr = temp_manager();
        let snap = FileSnapshot {
            repo: "owner/repo".into(),
            path: "src/main.rs".into(),
            before: Some("fn main() {}".into()),
            after: "fn main() { println!(\"hello\"); }".into(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            run_id: Some(1),
        };

        let id = mgr.record(&snap).unwrap();
        assert!(id > 0);

        let latest = mgr.get_latest("owner/repo", Some("src/main.rs")).unwrap();
        assert!(latest.is_some());
        let snap = latest.unwrap();
        assert_eq!(snap.after, "fn main() { println!(\"hello\"); }");
        assert_eq!(snap.before.as_deref(), Some("fn main() {}"));
    }

    #[test]
    fn test_clear_repo() {
        let mgr = temp_manager();
        let snap = FileSnapshot {
            repo: "owner/repo".into(),
            path: "src/main.rs".into(),
            before: None,
            after: "new content".into(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            run_id: Some(1),
        };
        mgr.record(&snap).unwrap();
        mgr.record(&snap).unwrap();

        let count = mgr.clear_repo("owner/repo").unwrap();
        assert_eq!(count, 2);
        assert_eq!(mgr.count().unwrap(), 0);
    }

    #[test]
    fn test_count() {
        let mgr = temp_manager();
        assert_eq!(mgr.count().unwrap(), 0);

        let snap = FileSnapshot {
            repo: "test/repo".into(),
            path: "file.txt".into(),
            before: None,
            after: "content".into(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            run_id: None,
        };
        mgr.record(&snap).unwrap();
        mgr.record(&snap).unwrap();

        assert_eq!(mgr.count().unwrap(), 2);
    }
}
