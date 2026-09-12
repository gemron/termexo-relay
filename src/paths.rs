//! The data directory, and the permissions everything inside it is held at.
//!
//! The relay is an unattended service with no keyring: the SQLite database — console session
//! tokens, device secret digests, argon2 password hashes, the audit trail — and the self-signed
//! certificate's private key are protected by file permissions and nothing else. Under a default
//! umask both land on disk readable by every local account, which on a shared host hands them to
//! anyone with a shell. Each is therefore narrowed to the user the relay runs as.
//!
//! Windows has no mode bits: a file created there inherits the ACL of the directory it lands in,
//! which is the operator's to set, so the narrowing is a no-op outside Unix.

use std::path::{Path, PathBuf};

/// The permission rule itself, free of syscalls so it can be tested on every platform — including
/// the Windows machines the relay is developed on, where it never runs.
mod mode {
    #![cfg_attr(not(unix), allow(dead_code))]

    /// The owner's `rwx`. Narrowing to it leaves a directory at `0700` and a file at `0600` under
    /// any ordinary umask, which is exactly what the data directory and the private key need.
    const OWNER_BITS: u32 = 0o700;
    /// Everything `st_mode` carries besides the file type: the nine permission bits plus setuid,
    /// setgid and the sticky bit, all of which are cleared along with group and other.
    const PERMISSION_BITS: u32 = 0o7777;

    /// The mode to write, or `None` when nothing about `current` is too permissive.
    ///
    /// Bits are only ever removed: an operator who narrowed a key further — a private key left at
    /// `0400` — keeps that choice, and a restart that finds the permissions already right performs
    /// no write at all.
    pub fn tightened(current: u32) -> Option<u32> {
        let narrowed = current & OWNER_BITS;
        (current & PERMISSION_BITS != narrowed).then_some(narrowed)
    }
}

/// Creates the data directory when it is missing and narrows it to its owner.
///
/// Returns the absolute path, which is what the rest of the start-up opens and logs: `--data-dir`
/// defaults to a relative name, and a service manager whose working directory is `/` would
/// otherwise leave the operator guessing where their database went.
pub fn prepare_data_directory(path: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(path)
        .map_err(|error| format!("无法创建数据目录 {}：{error}", path.display()))?;
    // Applied to a directory that already existed too: an installation from a version that did not
    // do this has to be repaired on the next start rather than left open for the rest of its life.
    restrict_to_owner(path);
    Ok(absolute(path))
}

/// Resolves a path against the working directory without requiring it to exist.
pub fn absolute(path: &Path) -> PathBuf {
    // Lexical resolution rather than `canonicalize`: this has to work for a path that is about to
    // be created, and it must not rewrite the operator's spelling into one they cannot recognise.
    // Only an unreadable working directory can fail, and creating a relative directory would have
    // failed first.
    std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Takes every group and other permission off a path, leaving the owner's bits alone.
///
/// Safe to call on every start: a path that is already narrow enough is not written to.
#[cfg(unix)]
pub fn restrict_to_owner(path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    let current = match std::fs::metadata(path) {
        Ok(metadata) => metadata.permissions().mode(),
        Err(error) => {
            warn_still_readable(path, &error);
            return;
        }
    };
    let Some(narrowed) = mode::tightened(current) else {
        return;
    };
    if let Err(error) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(narrowed)) {
        warn_still_readable(path, &error);
    }
}

/// A filesystem that cannot express the permission is no reason to refuse to start: the relay
/// still works, it is only less protected from the other accounts on the same host.
#[cfg(unix)]
fn warn_still_readable(path: &Path, error: &std::io::Error) {
    tracing::warn!(
        path = %path.display(),
        %error,
        "无法收紧文件权限，同一台主机上的其他用户可能可以读取中继数据"
    );
}

#[cfg(not(unix))]
pub fn restrict_to_owner(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    /// A directory of this test's own, in the place every other test in the crate puts one.
    fn temporary_directory() -> PathBuf {
        std::env::temp_dir().join(format!(
            "termexo-relay-paths-{}",
            crate::db::new_identifier()
                .expect("an identifier")
                .replace(['-', '_'], "")
        ))
    }

    #[test]
    fn a_mode_that_is_already_owner_only_is_left_untouched() {
        assert_eq!(mode::tightened(0o700), None);
        assert_eq!(mode::tightened(0o600), None);
        // An operator who went further than the relay asks for keeps their own choice.
        assert_eq!(mode::tightened(0o400), None);
    }

    #[test]
    fn group_and_other_lose_every_bit_while_the_owner_keeps_theirs() {
        assert_eq!(mode::tightened(0o755), Some(0o700));
        assert_eq!(mode::tightened(0o644), Some(0o600));
        assert_eq!(mode::tightened(0o640), Some(0o600));
        assert_eq!(mode::tightened(0o777), Some(0o700));
        // setgid on an inherited directory goes with them.
        assert_eq!(mode::tightened(0o2775), Some(0o700));
    }

    /// `st_mode` carries the file type in its high bits; only the permission bits may be compared,
    /// or every path would look wrong and be rewritten on every start.
    #[test]
    fn the_file_type_bits_are_not_mistaken_for_permissions() {
        assert_eq!(mode::tightened(0o100_644), Some(0o600));
        assert_eq!(mode::tightened(0o100_600), None);
        assert_eq!(mode::tightened(0o040_755), Some(0o700));
        assert_eq!(mode::tightened(0o040_700), None);
    }

    #[test]
    fn a_relative_data_directory_is_resolved_to_an_absolute_one() {
        let resolved = absolute(Path::new("relay-data"));

        assert!(
            resolved.is_absolute(),
            "{} 应当是绝对路径",
            resolved.display()
        );
        assert!(resolved.ends_with("relay-data"));
    }

    #[test]
    fn preparing_a_data_directory_creates_it_and_reports_where_it_is() {
        let directory = temporary_directory();

        let resolved = prepare_data_directory(&directory).expect("it should be created");

        assert!(directory.is_dir());
        assert!(resolved.is_absolute());
        // A second start must be able to run the very same preparation.
        prepare_data_directory(&directory).expect("a restart should change nothing");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[cfg(unix)]
    mod unix {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        fn mode_of(path: &Path) -> u32 {
            std::fs::metadata(path)
                .expect("the path should exist")
                .permissions()
                .mode()
                & 0o7777
        }

        /// The mode a directory is created with depends on the umask, so what is asserted is the
        /// invariant that holds under every one of them: nobody but the owner gets in.
        #[test]
        fn a_fresh_data_directory_is_reachable_only_by_its_owner() {
            let directory = temporary_directory();

            prepare_data_directory(&directory).expect("it should be created");

            assert_eq!(
                mode_of(&directory) & 0o077,
                0,
                "数据目录不应当对同组或其他用户开放"
            );
            let _ = std::fs::remove_dir_all(&directory);
        }

        /// An installation made before the relay narrowed its data directory must be repaired, not
        /// left world-readable for the rest of its life.
        #[test]
        fn a_data_directory_inherited_world_readable_is_narrowed_on_the_next_start() {
            let directory = temporary_directory();
            std::fs::create_dir_all(&directory).expect("the directory should be created");
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755))
                .expect("the mode should be set");

            prepare_data_directory(&directory).expect("it should be prepared");

            assert_eq!(mode_of(&directory), 0o700);
            let _ = std::fs::remove_dir_all(&directory);
        }

        #[test]
        fn a_file_keeps_only_the_owners_permissions() {
            let directory = temporary_directory();
            std::fs::create_dir_all(&directory).expect("the directory should be created");
            let file = directory.join("key.pem");
            std::fs::write(&file, b"-----BEGIN PRIVATE KEY-----").expect("it should be written");
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644))
                .expect("the mode should be set");

            restrict_to_owner(&file);
            assert_eq!(mode_of(&file), 0o600);
            restrict_to_owner(&file);
            assert_eq!(mode_of(&file), 0o600, "重复收紧不应当改变结果");

            let _ = std::fs::remove_dir_all(&directory);
        }

        /// A path that is not there at all must not take the relay down with it.
        #[test]
        fn a_missing_path_is_survivable() {
            restrict_to_owner(&temporary_directory().join("never-created"));
        }
    }
}
