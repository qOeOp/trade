//! Source-neutral filesystem custody helpers.

use std::path::Path;

#[cfg(unix)]
use rustix::fs::{FileType, Mode, OFlags};
#[cfg(unix)]
use std::{fs::File, io::Read, os::fd::OwnedFd, path::Component};

#[cfg(unix)]
fn directory_flags() -> OFlags {
    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC
}

/// Opaque capability for a directory opened without following symlinks.
#[derive(Debug)]
pub struct CustodiedDirectory {
    #[cfg(unix)]
    directory: OwnedFd,
}

/// Opens a real directory path one component at a time without following symlinks.
///
/// # Errors
///
/// Rejects unsafe components, symlinks, missing paths, and non-directories.
pub fn open_custodied_directory(path: &Path) -> anyhow::Result<CustodiedDirectory> {
    #[cfg(not(unix))]
    {
        let _ = path;
        anyhow::bail!("no-follow filesystem custody is unavailable on this platform");
    }

    #[cfg(unix)]
    {
        let mut directory = rustix::fs::open(
            if path.is_absolute() { "/" } else { "." },
            directory_flags(),
            Mode::empty(),
        )?;

        for component in path.components() {
            match component {
                Component::RootDir | Component::CurDir => {}
                Component::Normal(name) => {
                    directory =
                        rustix::fs::openat(&directory, name, directory_flags(), Mode::empty())?;
                }
                _ => anyhow::bail!("unsafe custody directory {}", path.display()),
            }
        }
        Ok(CustodiedDirectory { directory })
    }
}

/// Reads one bounded regular file relative to an already-open custodied directory.
///
/// # Errors
///
/// Rejects unsafe paths, symlinks, non-regular files, and objects beyond `limit`.
pub fn read_bounded_regular_at(
    root: &CustodiedDirectory,
    path: &Path,
    limit: u64,
) -> anyhow::Result<Vec<u8>> {
    #[cfg(not(unix))]
    {
        let _ = (root, path, limit);
        anyhow::bail!("no-follow filesystem custody is unavailable on this platform");
    }

    #[cfg(unix)]
    {
        let mut directory =
            rustix::fs::openat(&root.directory, ".", directory_flags(), Mode::empty())?;
        let mut components = path.components().peekable();
        let file = loop {
            let Some(Component::Normal(name)) = components.next() else {
                anyhow::bail!("unsafe custody object path {}", path.display());
            };

            if components.peek().is_none() {
                break rustix::fs::openat(
                    &directory,
                    name,
                    OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                    Mode::empty(),
                )?;
            }
            directory = rustix::fs::openat(&directory, name, directory_flags(), Mode::empty())?;
        };
        let stat = rustix::fs::fstat(&file)?;
        anyhow::ensure!(
            FileType::from_raw_mode(stat.st_mode) == FileType::RegularFile
                && u64::try_from(stat.st_size).is_ok_and(|size| size <= limit),
            "custody object is not a bounded regular file: {}",
            path.display()
        );
        let mut bytes = Vec::new();
        File::from(file)
            .take(limit.saturating_add(1))
            .read_to_end(&mut bytes)?;
        anyhow::ensure!(
            bytes.len() as u64 <= limit,
            "custody object exceeds {limit} bytes"
        );
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use rstest::rstest;

    use super::*;

    #[cfg(unix)]
    #[rstest]
    fn reads_only_bounded_regular_objects_without_following_links() {
        let root = tempfile::tempdir().unwrap();
        let canonical_root = fs::canonicalize(root.path()).unwrap();
        fs::create_dir(root.path().join("nested")).unwrap();
        fs::write(root.path().join("nested/object"), b"bound").unwrap();
        let directory = open_custodied_directory(&canonical_root).unwrap();
        assert_eq!(
            read_bounded_regular_at(&directory, Path::new("nested/object"), 5).unwrap(),
            b"bound"
        );
        assert_eq!(
            read_bounded_regular_at(&directory, Path::new("nested/object"), u64::MAX).unwrap(),
            b"bound"
        );
        assert!(read_bounded_regular_at(&directory, Path::new("nested/object"), 4).is_err());
        assert!(read_bounded_regular_at(&directory, Path::new("../object"), 5).is_err());

        std::os::unix::fs::symlink("nested/object", root.path().join("link")).unwrap();
        assert!(read_bounded_regular_at(&directory, Path::new("link"), 5).is_err());
        std::os::unix::fs::symlink("nested", root.path().join("linked-dir")).unwrap();
        assert!(open_custodied_directory(&canonical_root.join("linked-dir")).is_err());
    }

    #[cfg(not(unix))]
    #[rstest]
    fn custody_fails_closed_when_no_follow_open_is_unavailable() {
        assert!(open_custodied_directory(Path::new(".")).is_err());
        assert!(read_bounded_regular_at(&CustodiedDirectory {}, Path::new("object"), 1).is_err());
    }
}
