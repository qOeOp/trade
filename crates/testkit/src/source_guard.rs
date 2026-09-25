//! Reading a crate's production source, for guards that pin what production code may contain.
//!
//! A guard that reads "the source before the test module" has to know where production code
//! ends. Cutting at the first `#[cfg(test)]` is wrong when that attribute is indented (a test-only
//! method): every function after it goes unread, and the guard passes whatever they contain. So a
//! file is cut at its first *top-level* `#[cfg(test)]`, and every top-level item after the cut must
//! itself be test-only; a production item there is reported instead of skipped. Every `.rs` file
//! under the crate's `src` is read, so a new file cannot fall outside the guard.

use std::{
    fs,
    path::{Path, PathBuf},
};

/// Every `.rs` file under `<manifest_dir>/src`, each with its production part.
///
/// # Panics
///
/// Panics when `src` cannot be read, or when a top-level production item follows a file's first
/// top-level `#[cfg(test)]`: the guard could not see it.
#[must_use]
pub fn crate_production_sources(manifest_dir: &str) -> Vec<(PathBuf, String)> {
    let mut files = Vec::new();
    collect_rust_files(&Path::new(manifest_dir).join("src"), &mut files);
    files.sort();
    files
        .into_iter()
        .map(|path| {
            let source = fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
            let production = production_part(&source)
                .unwrap_or_else(|line| {
                    panic!(
                        "{}:{line}: a production item follows the first top-level #[cfg(test)], \
                         where a guard reading production code would not see it",
                        path.display()
                    )
                })
                .to_string();
            (path, production)
        })
        .collect()
}

fn collect_rust_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let entries =
        fs::read_dir(dir).unwrap_or_else(|e| panic!("read directory {}: {e}", dir.display()));

    for entry in entries {
        let path = entry
            .unwrap_or_else(|e| panic!("read directory {}: {e}", dir.display()))
            .path();

        if path.is_dir() {
            collect_rust_files(&path, files);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }
}

/// The part of `source` before its first top-level `#[cfg(test)]`, or the 1-based line of a
/// top-level item after that point which is not itself test-only.
///
/// # Errors
///
/// Returns the line of the first top-level production item that follows the cut.
pub fn production_part(source: &str) -> Result<&str, usize> {
    let Some(cut) = find_top_level_cfg_test(source) else {
        return Ok(source);
    };
    let first_line = source[..cut].lines().count() + 1;
    let mut test_only = false;

    for (offset, line) in source[cut..].lines().enumerate() {
        if line.is_empty() || line.starts_with(char::is_whitespace) || line.starts_with('}') {
            continue;
        }
        // Comments, and the lines that continue an item already opened: a signature rustfmt
        // wraps closes with `) -> T {` or a `where` clause at the start of a line.
        if line.starts_with("//") || line.starts_with([')', ']', '{']) || line.starts_with("where")
        {
            continue;
        }

        if line.starts_with("#[") {
            test_only |= line.starts_with("#[cfg(test)]");
            continue;
        }

        if !test_only {
            return Err(first_line + offset);
        }
        // An item that closes on its own line ends here; one that opens a block runs until a
        // top-level `}`, and every line inside it is indented.
        test_only = false;
    }
    Ok(&source[..cut])
}

fn find_top_level_cfg_test(source: &str) -> Option<usize> {
    if source.starts_with("#[cfg(test)]") {
        return Some(0);
    }
    source.find("\n#[cfg(test)]").map(|at| at + 1)
}

/// The process-clock reads a piece of source contains.
#[must_use]
pub fn process_clock_reads(source: &str) -> Vec<&'static str> {
    ["now_ms(", "SystemTime", "current_epoch_ms("]
        .into_iter()
        .filter(|read| source.contains(read))
        .collect()
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn an_indented_test_attribute_does_not_end_production() {
        let source = "fn a() {}\nimpl X {\n    #[cfg(test)]\n    fn pool() {}\n}\nfn late() { \
                      SystemTime::now(); }\n#[cfg(test)]\nmod tests {\n    fn t() {}\n}\n";
        let production = production_part(source).unwrap();
        assert!(production.contains("fn late()"));
        assert_eq!(process_clock_reads(production), ["SystemTime"]);
        assert!(!production.contains("mod tests"));
    }

    #[rstest]
    fn a_production_item_after_the_cut_is_reported_not_skipped() {
        let source = "fn a() {}\n\n#[cfg(test)]\nfn helper() {}\n\npub fn late() {\n    \
                      SystemTime::now();\n}\n\n#[cfg(test)]\nmod tests {}\n";
        assert_eq!(production_part(source), Err(6));
    }

    #[rstest]
    fn test_only_items_after_the_cut_are_allowed() {
        let source = "fn a() {}\n\n#[cfg(test)]\npub(super) fn helper() -> String {\n    \
                      String::new()\n}\n\n#[cfg(test)]\n#[allow(dead_code)]\nmod parser_tests {\n    \
                      use super::*;\n}\n";
        assert_eq!(production_part(source), Ok("fn a() {}\n\n"));
    }

    #[rstest]
    fn a_wrapped_test_only_signature_is_one_item() {
        let source = "fn a() {}\n#[cfg(test)]\nfn helper(\n    x: u8,\n) -> String\nwhere\n    \
                      u8: Copy,\n{\n    String::new()\n}\n";
        assert_eq!(production_part(source), Ok("fn a() {}\n"));
    }

    #[rstest]
    fn a_file_without_tests_is_all_production() {
        assert_eq!(production_part("fn a() {}\n"), Ok("fn a() {}\n"));
    }

    #[rstest]
    fn the_reading_sees_each_kind_of_process_clock() {
        for read in [
            "let now = SystemTime::now();",
            "let now = now_ms()?;",
            "let now = current_epoch_ms()?;",
        ] {
            assert_eq!(process_clock_reads(read).len(), 1, "{read}");
        }
        assert!(process_clock_reads("let now = database_now(&mut transaction).await?;").is_empty());
    }
}
