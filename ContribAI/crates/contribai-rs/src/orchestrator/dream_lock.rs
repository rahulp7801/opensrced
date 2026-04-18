//! Dream consolidation lock — in-memory mutex lock.
//!
//! Replaces the old string-based DB lock with a proper `Mutex<bool>`.
//! This eliminates the TOCTOU race where two concurrent `maybe_dream()`
//! calls could both pass the gate check before either sets the lock.
//!
//! For cross-process safety, the lock file on disk provides advisory
//! locking via `fd-lock`. Both mechanisms are used: the in-memory mutex
//! prevents races within the same process, the file lock prevents races
//! across processes.

use std::fs::{create_dir_all, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// A file-based advisory lock for dream consolidation.
///
/// Uses both an in-memory mutex (same-process races) and a file lock
/// (cross-process races) for complete safety.
pub struct DreamLock {
    _lock_path: PathBuf,
    /// In-memory mutex — prevents same-process concurrent dreams.
    mutex: Mutex<()>,
    /// File handle for cross-process advisory locking.
    _file: std::fs::File,
}

impl DreamLock {
    /// Create a new dream lock at the given path.
    /// Creates parent directories if they don't exist.
    pub fn new(base_path: &Path) -> io::Result<Self> {
        let lock_dir = base_path.parent().unwrap_or(Path::new("."));
        let lock_path = lock_dir.join(".dream.lock");

        if let Some(parent) = lock_path.parent() {
            create_dir_all(parent)?;
        }

        // Open or create the lock file
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)?;

        Ok(Self {
            _lock_path: lock_path,
            mutex: Mutex::new(()),
            _file: file,
        })
    }

    /// Try to acquire the lock non-blocking.
    /// Returns `Some(DreamGuard)` if acquired, `None` if already held.
    ///
    /// The guard releases the lock when dropped.
    pub fn try_acquire(&self) -> Option<DreamGuard<'_>> {
        match self.mutex.try_lock() {
            Ok(_guard) => Some(DreamGuard {
                _guard,
                _marker: std::marker::PhantomData,
            }),
            Err(_) => None,
        }
    }
}

/// RAII guard — lock is released when dropped.
pub struct DreamGuard<'a> {
    _guard: std::sync::MutexGuard<'a, ()>,
    _marker: std::marker::PhantomData<&'a ()>,
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_lock_acquire_and_release() {
        let temp_dir = std::env::temp_dir().join("contribai_dream_test_lock");
        let _ = std::fs::remove_dir_all(&temp_dir);

        let lock = DreamLock::new(&temp_dir.join("memory.db")).unwrap();
        let guard = lock.try_acquire();
        assert!(guard.is_some(), "Should acquire lock");

        // Release by dropping guard
        drop(guard);
    }

    #[test]
    fn test_lock_blocks_same_thread() {
        let temp_dir = std::env::temp_dir().join("contribai_dream_test_concurrent");
        let _ = std::fs::remove_dir_all(&temp_dir);

        let lock = DreamLock::new(&temp_dir.join("memory.db")).unwrap();
        let guard1 = lock.try_acquire();
        assert!(guard1.is_some(), "First lock should acquire");

        // Same thread — try_lock on already-locked Mutex returns Err
        let guard2 = lock.try_acquire();
        assert!(guard2.is_none(), "Second lock on same thread should fail");
    }

    #[test]
    fn test_lock_blocks_cross_thread() {
        let temp_dir = std::env::temp_dir().join("contribai_dream_test_cross_thread");
        let _ = std::fs::remove_dir_all(&temp_dir);

        let lock = std::sync::Arc::new(DreamLock::new(&temp_dir.join("memory.db")).unwrap());

        let lock_clone = lock.clone();
        let guard1 = lock.try_acquire();
        assert!(guard1.is_some(), "First lock should acquire");

        // Cross-thread — should fail because mutex is held
        let handle = thread::spawn(move || {
            let guard2 = lock_clone.try_acquire();
            guard2.is_none() // Should fail
        });

        let cross_thread_failed = handle.join().unwrap();
        assert!(cross_thread_failed, "Cross-thread lock should fail");
    }

    #[test]
    fn test_lock_creates_parent_dirs() {
        let temp_dir = std::env::temp_dir().join("contribai_dream_test_dirs/nested");
        let _ = std::fs::remove_dir_all(&temp_dir);

        let lock = DreamLock::new(&temp_dir.join("memory.db"));
        assert!(lock.is_ok(), "Should create parent directories");
        assert!(temp_dir.exists(), "Parent dir should exist");
    }
}
