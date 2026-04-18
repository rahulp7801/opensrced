//! JSON extraction and change-parsing from LLM responses.

use regex::Regex;
use tracing::{info, warn};

use crate::core::models::{FileChange, RepoContext};

use super::engine::ContributionGenerator;
use super::fuzzy_match::apply_single_edit;

// ── JSON extraction ──────────────────────────────────────────────────────────

impl ContributionGenerator<'_> {
    /// Robustly extract JSON from LLM response.
    ///
    /// Three strategies (matching Python `_extract_json`):
    /// 1. Extract from ` ```json ` fences
    /// 2. Plain ` ``` ` fences containing a JSON object
    /// 3. Bracket-counting fallback from first `{"changes"`, `{`, or `[`
    pub fn extract_json(response: &str) -> Option<String> {
        // Strategy 1: ```json ... ``` fenced blocks
        if let Ok(re) = Regex::new(r"(?s)```json\s*\n(.*?)\n\s*```") {
            if let Some(cap) = re.captures(response) {
                if let Some(m) = cap.get(1) {
                    return Some(m.as_str().trim().to_string());
                }
            }
        }

        // Strategy 2: plain ``` ... ``` fence containing a JSON object
        if let Ok(re) = Regex::new(r"(?s)```\s*\n(\{.*?\})\s*\n\s*```") {
            if let Some(cap) = re.captures(response) {
                if let Some(m) = cap.get(1) {
                    return Some(m.as_str().trim().to_string());
                }
            }
        }

        // Strategy 3: bracket-counting — prefer `{"changes"` anchor, then first `[` or `{`
        // whichever comes first in the text (so bare arrays are not missed).
        let start = response.find(r#"{"changes""#).or_else(|| {
            let brace = response.find('{');
            let bracket = response.find('[');
            match (brace, bracket) {
                (Some(b), Some(k)) => Some(b.min(k)),
                (Some(b), None) => Some(b),
                (None, Some(k)) => Some(k),
                _ => None,
            }
        });

        let start = start?;

        let open_ch = response.as_bytes().get(start).copied()? as char;
        let close_ch = if open_ch == '{' { '}' } else { ']' };

        let mut depth: i32 = 0;
        let mut in_string = false;
        let mut prev_ch = '\0';

        for (i, ch) in response[start..].char_indices() {
            if ch == '"' && prev_ch != '\\' {
                in_string = !in_string;
            }
            if in_string {
                prev_ch = ch;
                continue;
            }
            if ch == open_ch {
                depth += 1;
            } else if ch == close_ch {
                depth -= 1;
                if depth == 0 {
                    let end = start + i + ch.len_utf8();
                    return Some(response[start..end].to_string());
                }
            }
            prev_ch = ch;
        }

        None
    }

    // ── Change parsing ───────────────────────────────────────────────────────

    /// Parse LLM response into FileChange objects.
    ///
    /// Supports two formats (matching Python engine):
    /// 1. `{"changes": [{"path":..., "edits": [{"search":..., "replace":...}]}]}`
    ///    — search/replace applied to original file content from `context`
    /// 2. `{"changes": [{"path":..., "content":..., "is_new_file": true}]}`
    ///    — full content for new files
    ///
    /// Falls back to bare JSON array `[{"path":..., "new_content":...}]` for
    /// backward compatibility.
    pub(crate) fn parse_changes(
        &self,
        response: &str,
        context: &RepoContext,
    ) -> Option<Vec<FileChange>> {
        let json_text = Self::extract_json(response)?;

        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&json_text) {
            // Try canonical `{"changes": [...]}` wrapper format first
            if let Some(raw_changes) = data.get("changes").and_then(|v| v.as_array()) {
                let changes = self.apply_changes_from_json(raw_changes, context);
                if !changes.is_empty() {
                    return Some(changes);
                }
            }

            // Bare array fallback: [{path, new_content, is_new_file}]
            if let Some(items) = data.as_array() {
                let changes = Self::parse_bare_array(items);
                if !changes.is_empty() {
                    return Some(changes);
                }
            }
        }

        None
    }

    /// Apply search/replace edits or full-content changes from JSON items.
    fn apply_changes_from_json(
        &self,
        items: &[serde_json::Value],
        context: &RepoContext,
    ) -> Vec<FileChange> {
        let mut changes: Vec<FileChange> = Vec::new();

        for item in items {
            let path = match item.get("path").and_then(|v| v.as_str()) {
                Some(p) => p.to_string(),
                None => continue,
            };

            // Path sanity: reject hallucinated absolute or out-of-repo paths.
            if !is_safe_repo_path(&path) {
                warn!(path = %path, "Rejected path: looks absolute / outside repo (hallucination)");
                continue;
            }

            // For brand-new files, require the parent directory to actually
            // exist in the repo. Without this, the LLM can invent a path
            // like "src/utils/newthing.py" in a repo that has neither `src/`
            // nor `utils/`, and we'd silently create it.
            let proposed_is_new = item
                .get("is_new_file")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                || (item.get("content").is_some()
                    && item.get("edits").is_none()
                    && item.get("append").is_none()
                    && item.get("prepend").is_none()
                    && item.get("insert_after_line").is_none());
            let path_in_tree = context
                .file_tree
                .iter()
                .any(|n| n.node_type == "blob" && n.path == path);
            if proposed_is_new && !path_in_tree {
                let parent = path.rsplit_once('/').map(|(p, _)| p);
                let parent_exists = match parent {
                    None => true, // top-level new file is allowed
                    Some(p) => context.file_tree.iter().any(|n| {
                        // Match either an exact tree-node (directory) or any
                        // blob whose path starts with `parent/`.
                        (n.node_type == "tree" && n.path == p)
                            || n.path.starts_with(&format!("{}/", p))
                    }),
                };
                if !parent_exists {
                    warn!(
                        path = %path,
                        parent = ?parent,
                        "Rejected new file: parent directory does not exist in repo"
                    );
                    continue;
                }
            }

            // Anchor-free additions: append, prepend, insert_after_line.
            // Picked first so the LLM can avoid the search-anchor failure mode
            // entirely for additive doc/changelog edits.
            let append = item.get("append").and_then(|v| v.as_str());
            let prepend = item.get("prepend").and_then(|v| v.as_str());
            let insert_after_line = item.get("insert_after_line").and_then(|v| v.as_u64());
            let insert_text = item.get("insert_text").and_then(|v| v.as_str());

            if append.is_some() || prepend.is_some() || (insert_after_line.is_some() && insert_text.is_some()) {
                let original = match context.relevant_files.get(&path) {
                    Some(c) => c.clone(),
                    None => {
                        warn!(path = %path, "No original content for anchor-free edit");
                        continue;
                    }
                };

                let mut new_content = original.clone();
                let mut applied_any = false;

                if let Some(text) = prepend {
                    if !text.is_empty() {
                        new_content = format!("{}{}", text, new_content);
                        applied_any = true;
                    }
                }
                if let (Some(line_no), Some(text)) = (insert_after_line, insert_text) {
                    if !text.is_empty() {
                        let mut out = String::with_capacity(new_content.len() + text.len() + 1);
                        let mut inserted = false;
                        for (i, line) in new_content.split_inclusive('\n').enumerate() {
                            out.push_str(line);
                            if !inserted && (i as u64 + 1) == line_no {
                                if !line.ends_with('\n') {
                                    out.push('\n');
                                }
                                out.push_str(text);
                                if !text.ends_with('\n') {
                                    out.push('\n');
                                }
                                inserted = true;
                            }
                        }
                        if inserted {
                            new_content = out;
                            applied_any = true;
                        } else {
                            warn!(path = %path, line_no, "insert_after_line beyond EOF; falling through to append");
                        }
                    }
                }
                if let Some(text) = append {
                    if !text.is_empty() {
                        if !new_content.ends_with('\n') {
                            new_content.push('\n');
                        }
                        new_content.push_str(text);
                        applied_any = true;
                    }
                }

                if !applied_any {
                    warn!(path = %path, "Anchor-free edit produced no change, skipping");
                    continue;
                }

                info!(path = %path, op = "anchor_free", "Anchor-free edit applied");
                changes.push(FileChange {
                    path,
                    original_content: Some(original),
                    new_content,
                    is_new_file: false,
                    is_deleted: false,
                });
                continue;
            }

            if let Some(edits) = item.get("edits").and_then(|v| v.as_array()) {
                // Search/replace mode — requires original file content
                let original = match context.relevant_files.get(&path) {
                    Some(c) => c.clone(),
                    None => {
                        warn!(path = %path, "No original content for search/replace edits");
                        continue;
                    }
                };

                let mut new_content = original.clone();
                let edits_total = edits.len();
                let mut edits_applied: usize = 0;

                for edit in edits {
                    let search = edit
                        .get("search")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let replace = edit
                        .get("replace")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    if search.is_empty() {
                        continue;
                    }

                    // Defensive: if the LLM copied the displayed "  42: ..." line-number
                    // prefix into the search text, strip it so the matcher can find the real content.
                    // Strip both old-style "  42: " and new-style "  42|" prefixes.
                    let line_prefix_rx = regex::Regex::new(r"(?m)^\s*\d+[:|]\s?").unwrap();
                    let stripped = line_prefix_rx.replace_all(&search, "").to_string();
                    let candidates: Vec<String> = if stripped != search {
                        vec![search.clone(), stripped]
                    } else {
                        vec![search.clone()]
                    };

                    let mut applied_this_edit = false;
                    for cand in &candidates {
                        if let Some(updated) =
                            apply_single_edit(&new_content, cand, &replace, &path)
                        {
                            new_content = updated;
                            edits_applied += 1;
                            applied_this_edit = true;
                            break;
                        }
                    }

                    if !applied_this_edit {
                        warn!(
                            path = %path,
                            search_len = search.len(),
                            search_preview = %&search[..search.len().min(80)].replace('\n', "\\n"),
                            "Search text not found (tried exact + 3 fuzzy strategies + line-prefix strip)"
                        );
                    }
                }

                info!(
                    path = %path,
                    applied = edits_applied,
                    total = edits_total,
                    "Edits applied"
                );

                if edits_applied == 0 {
                    warn!(path = %path, "No edits applied, skipping file");
                    continue;
                }

                changes.push(FileChange {
                    path,
                    original_content: Some(original),
                    new_content,
                    is_new_file: false,
                    is_deleted: false,
                });
            } else if let Some(content) = item.get("content").and_then(|v| v.as_str()) {
                // Full-content mode (new files or fallback). Cross-check
                // against the real repo so we don't silently clobber an
                // existing file by mis-labelling it as new.
                let exists_in_tree = context
                    .file_tree
                    .iter()
                    .any(|n| n.node_type == "blob" && n.path == path);

                if let Some(original) = context.relevant_files.get(&path).cloned() {
                    // File exists AND we have its original content — treat as
                    // a whole-file edit, not a new file.
                    changes.push(FileChange {
                        path,
                        original_content: Some(original),
                        new_content: content.to_string(),
                        is_new_file: false,
                        is_deleted: false,
                    });
                } else if exists_in_tree {
                    // File exists but we never fetched it. Overwriting blind
                    // would destroy its contents. Drop the change.
                    warn!(
                        path = %path,
                        "LLM returned full content for an existing file without original context; skipping to avoid clobbering"
                    );
                    continue;
                } else {
                    // Genuinely new file.
                    changes.push(FileChange {
                        path,
                        original_content: None,
                        new_content: content.to_string(),
                        is_new_file: true,
                        is_deleted: false,
                    });
                }
            }
        }

        // Enforce max files limit
        let max = self.config.max_changes_per_pr;
        if changes.len() > max {
            warn!(
                actual = changes.len(),
                limit = max,
                "Too many files changed, truncating"
            );
            changes.truncate(max);
        }

        // Dedupe by path. The LLM frequently emits multiple items targeting
        // the same file (each starting from the original content), which
        // surfaces in the dashboard as a chain of conflicting diffs. Keep
        // the entry with the largest |delta|, which is empirically the
        // most-refined attempt.
        let deduped = dedupe_by_path_keep_largest(changes);

        // Final guard: drop any .py change whose `new_content` is not a
        // valid Python module. qwen-7b's search/replace edits frequently
        // mangle indentation; surfacing a syntactically-broken file as a
        // PR draft is worse than producing nothing.
        validate_python_syntax(deduped)
    }

    /// Parse legacy bare-array format `[{"path":..., "new_content":..., "is_new_file":...}]`.
    fn parse_bare_array(items: &[serde_json::Value]) -> Vec<FileChange> {
        items
            .iter()
            .filter_map(|item| {
                let path = item.get("path")?.as_str()?.to_string();
                let new_content = item.get("new_content")?.as_str()?.to_string();
                let is_new_file = item
                    .get("is_new_file")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                Some(FileChange {
                    path,
                    original_content: None,
                    new_content,
                    is_new_file,
                    is_deleted: false,
                })
            })
            .collect()
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::generator::engine::tests::{mock_gen, test_context};

    #[test]
    fn test_extract_json_fenced() {
        let response = "some text\n```json\n{\"changes\": []}\n```\ntrailing text";
        let result = ContributionGenerator::extract_json(response);
        assert_eq!(result, Some("{\"changes\": []}".to_string()));
    }

    #[test]
    fn test_extract_json_raw() {
        let response = r#"Here is the fix: {"changes": [{"path": "x.py"}]}"#;
        let result = ContributionGenerator::extract_json(response);
        assert!(result.is_some());
        assert!(result.unwrap().contains("changes"));
    }

    #[test]
    fn test_extract_json_bare_array() {
        let response = r#"[{"path": "x.py", "new_content": "hello"}]"#;
        let result = ContributionGenerator::extract_json(response);
        assert!(result.is_some());
        assert!(result.unwrap().starts_with('['));
    }

    #[test]
    fn test_extract_json_none() {
        let result = ContributionGenerator::extract_json("no json here at all");
        assert!(result.is_none());
    }

    #[test]
    fn test_parse_changes_valid() {
        let gen = mock_gen();
        let ctx = test_context(HashMap::new());
        let response =
            r#"[{"path": "src/main.py", "new_content": "print('fixed')", "is_new_file": false}]"#;
        let changes = gen.parse_changes(response, &ctx);
        assert!(changes.is_some());
        assert_eq!(changes.unwrap().len(), 1);
    }

    #[test]
    fn test_parse_changes_invalid() {
        let gen = mock_gen();
        let ctx = test_context(HashMap::new());
        let response = "This is not valid JSON at all";
        let changes = gen.parse_changes(response, &ctx);
        assert!(changes.is_none());
    }

    #[test]
    fn test_parse_changes_search_replace() {
        let gen = mock_gen();
        let mut files = HashMap::new();
        files.insert(
            "src/main.py".to_string(),
            "def foo():\n    x = 1\n    return x\n".to_string(),
        );
        let ctx = test_context(files);

        let response = r#"{"changes": [{"path": "src/main.py", "is_new_file": false, "edits": [{"search": "x = 1", "replace": "x = 2"}]}]}"#;
        let changes = gen.parse_changes(response, &ctx);
        assert!(changes.is_some());
        let ch = changes.unwrap();
        assert_eq!(ch.len(), 1);
        assert!(ch[0].new_content.contains("x = 2"));
        assert!(!ch[0].new_content.contains("x = 1"));
    }
}


/// Group `changes` by `path` and keep, per path, the entry whose
/// `new_content.len() - original_content.len()` is largest in absolute value.
/// Larger deltas are empirically the LLM's most-refined attempt; trivial
/// "near-no-op" attempts get dropped.
fn dedupe_by_path_keep_largest(changes: Vec<FileChange>) -> Vec<FileChange> {
    use std::collections::HashMap;
    let mut by_path: HashMap<String, FileChange> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for ch in changes {
        let delta = (ch.new_content.len() as i64
            - ch.original_content.as_deref().map(|s| s.len() as i64).unwrap_or(0))
            .abs();
        match by_path.get(&ch.path) {
            Some(existing) => {
                let existing_delta = (existing.new_content.len() as i64
                    - existing.original_content.as_deref().map(|s| s.len() as i64).unwrap_or(0))
                    .abs();
                if delta > existing_delta {
                    by_path.insert(ch.path.clone(), ch);
                }
            }
            None => {
                order.push(ch.path.clone());
                by_path.insert(ch.path.clone(), ch);
            }
        }
    }
    order
        .into_iter()
        .filter_map(|p| by_path.remove(&p))
        .collect()
}

/// For every Python (.py) file change, verify the new content parses with
/// Python's AST. Drops broken changes with a warning. Requires `python` (or
/// `python3`) on PATH; if neither exists, the check is silently skipped so
/// non-Python projects keep working.
fn validate_python_syntax(changes: Vec<FileChange>) -> Vec<FileChange> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    fn pick_python() -> Option<&'static str> {
        for cmd in &["python", "python3", "py"] {
            let probe = Command::new(cmd)
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
            if let Ok(mut child) = probe {
                let _ = child.wait();
                return Some(*cmd);
            }
        }
        None
    }

    let py_cmd = match pick_python() {
        Some(c) => c,
        None => return changes,
    };

    let mut out: Vec<FileChange> = Vec::with_capacity(changes.len());
    for ch in changes {
        let is_python = ch
            .path
            .rsplit('.')
            .next()
            .map(|s| s.eq_ignore_ascii_case("py"))
            .unwrap_or(false);
        if !is_python {
            out.push(ch);
            continue;
        }

        let child = Command::new(py_cmd)
            .arg("-c")
            .arg("import ast,sys; ast.parse(sys.stdin.read())")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = match child {
            Ok(c) => c,
            Err(_) => {
                out.push(ch);
                continue;
            }
        };
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(ch.new_content.as_bytes());
        }
        match child.wait_with_output() {
            Ok(output) if output.status.success() => out.push(ch),
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let msg = stderr.lines().last().unwrap_or("(no message)");
                warn!(
                    path = %ch.path,
                    error = %msg,
                    "Rejected: generated Python file does not parse (likely indentation mangled by LLM search/replace)"
                );
            }
            Err(_) => out.push(ch),
        }
    }
    out
}

fn is_safe_repo_path(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    if path.starts_with('/') || path.starts_with('~') || path.starts_with('\\') {
        return false;
    }
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return false;
    }
    for seg in path.split('/') {
        if seg == ".." {
            return false;
        }
    }
    let lower = path.to_ascii_lowercase();
    for prefix in &[
        "usr/", "etc/", "var/", "opt/", "tmp/", "root/", "proc/", "sys/", "dev/",
        "home/", "users/", "windows/", "program files/", "appdata/",
    ] {
        if lower.starts_with(prefix) {
            return false;
        }
    }
    true
}
