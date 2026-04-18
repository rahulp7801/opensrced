//! LLM-powered contribution generator.
//!
//! Port from Python `generator/engine.py`.
//! Takes findings from analysis and generates actual code changes,
//! tests, and commit messages that follow the target repo's conventions.

use chrono::Utc;
use regex::Regex;
use std::sync::LazyLock;
use tracing::{info, warn};

use crate::core::prompt_sanitize::{hardened_system_prompt, sanitize_for_prompt, SanitizeResult};
use crate::core::safe_truncate;

static RE_SLUG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^a-z0-9]+").unwrap());

use crate::core::config::ContributionConfig;
use crate::core::error::Result;
use crate::core::models::{Contribution, ContributionType, FileChange, Finding, RepoContext};
use crate::github::guidelines::{adapt_pr_title, extract_scope_from_path, RepoGuidelines};
use crate::llm::provider::LlmProvider;

// ── Generator struct ─────────────────────────────────────────────────────────

/// Generate code contributions from analysis findings.
pub struct ContributionGenerator<'a> {
    pub(crate) llm: &'a dyn LlmProvider,
    pub(crate) config: &'a ContributionConfig,
    /// Enable LLM self-review gate after generation (default: true).
    pub(crate) self_review_enabled: bool,
    /// Optional independent reviewer LLM. When set, the self-review step
    /// uses this provider instead of `llm` — much more reliable than asking
    /// a small code-gen model to grade its own output.
    pub(crate) reviewer_llm: Option<&'a dyn LlmProvider>,
}

impl<'a> ContributionGenerator<'a> {
    pub fn new(llm: &'a dyn LlmProvider, config: &'a ContributionConfig) -> Self {
        Self {
            llm,
            config,
            self_review_enabled: true,
            reviewer_llm: None,
        }
    }

    /// Attach an independent reviewer LLM used for the self-review gate.
    pub fn with_reviewer(mut self, reviewer: &'a dyn LlmProvider) -> Self {
        self.reviewer_llm = Some(reviewer);
        self
    }

    /// Disable self-review (useful for batch pipelines where latency matters).
    pub fn without_self_review(mut self) -> Self {
        self.self_review_enabled = false;
        self
    }

    /// Generate a contribution for a single finding.
    ///
    /// Pipeline:
    /// 1. Build context-aware prompt
    /// 2. Get LLM to generate the fix
    /// 3. Parse structured output into FileChanges (with search/replace)
    /// 4. Generate commit message
    /// 5. Optional self-review LLM gate
    pub async fn generate(
        &self,
        finding: &Finding,
        context: &RepoContext,
    ) -> Result<Option<Contribution>> {
        self.generate_with_guidelines(finding, context, None).await
    }

    /// Generate a contribution, optionally adapting PR title to repo guidelines.
    pub async fn generate_with_guidelines(
        &self,
        finding: &Finding,
        context: &RepoContext,
        guidelines: Option<&RepoGuidelines>,
    ) -> Result<Option<Contribution>> {
        // 1. Build prompts
        let system = self.build_system_prompt(context);
        let prompt = self.build_generation_prompt(finding, context);

        // 2. Generate with retry (max 1 retry = 2 attempts)
        let mut changes: Option<Vec<FileChange>> = None;
        let mut last_error = String::new();

        for attempt in 0..2 {
            let actual_prompt = if attempt > 0 {
                format!(
                    "{}\n\n## IMPORTANT: Your previous attempt failed.\n\
                     Error: {}\n\
                     Please fix the issue and return ONLY valid JSON \
                     with no markdown fences or extra text.",
                    prompt, last_error
                )
            } else {
                prompt.clone()
            };

            let response = self
                .llm
                .complete(&actual_prompt, Some(&system), Some(0.2), None)
                .await?;

            // 3. Parse changes (search/replace or full-content format)
            match self.parse_changes(&response, context) {
                Some(c) if !c.is_empty() => {
                    // Topic guard: when the issue clearly identifies a source-file
                    // edit target (via finding.file_path or pre-attached source files),
                    // reject changes that only touch doc/reference files. The model
                    // tried to be lazy and edit README; fail fast so the retry
                    // can correct course.
                    let has_source_target = !context.relevant_files.is_empty()
                        && context.relevant_files.keys().any(|p| {
                            let ext = p
                                .rsplit('.')
                                .next()
                                .map(|s| s.to_ascii_lowercase())
                                .unwrap_or_default();
                            !matches!(
                                ext.as_str(),
                                "md" | "markdown" | "rst" | "txt" | "adoc"
                            ) && !p.starts_with("docs/")
                                && !p.starts_with("doc/")
                        });
                    let all_changes_are_docs = c.iter().all(|fc| {
                        let ext = fc
                            .path
                            .rsplit('.')
                            .next()
                            .map(|s| s.to_ascii_lowercase())
                            .unwrap_or_default();
                        matches!(
                            ext.as_str(),
                            "md" | "markdown" | "rst" | "txt" | "adoc"
                        ) || fc.path.starts_with("docs/")
                            || fc.path.starts_with("doc/")
                    });
                    if has_source_target && all_changes_are_docs {
                        warn!(
                            "Rejected: model edited only doc files when source target was provided"
                        );
                        last_error = "You edited only documentation files. The issue \
                            requires a code change in one of the source files listed under \
                            \"Edit Target File(s)\". Edit the source file directly — do NOT \
                            modify README, CONTRIBUTING, or any .md file."
                            .into();
                        continue;
                    }

                    if self.validate_changes(&c) {
                        changes = Some(c);
                        break;
                    } else {
                        last_error = "Generated code failed syntax validation \
                                     (unbalanced brackets or empty edits)"
                            .into();
                    }
                }
                _ => {
                    last_error = "No valid changes could be parsed from JSON output".into();
                }
            }
        }

        let changes = match changes {
            Some(c) => c,
            None => {
                warn!(title = %finding.title, "No valid changes after retries");
                return Ok(None);
            }
        };

        // 4. Generate commit message
        let commit_msg = self.generate_commit_message(finding, &changes);

        // 5. Generate branch name
        let branch_name = Self::generate_branch_name(finding);

        // 6. Generate PR title (adapted to guidelines if available)
        let pr_title = Self::generate_pr_title_with_guidelines(finding, guidelines);

        let contribution = Contribution {
            finding: finding.clone(),
            contribution_type: finding.finding_type.clone(),
            title: pr_title,
            description: finding.description.clone(),
            changes,
            commit_message: commit_msg,
            tests_added: vec![],
            branch_name,
            generated_at: Utc::now(),
        };

        // 7. Optional self-review LLM gate. If the reviewer rejects, we get
        //    one shot to regenerate with the rejection reasoning fed back as
        //    a constraint — that catches "you edited the wrong file" or
        //    "your change is unrelated to the issue" without humans in the loop.
        //
        //    Override: when CONTRIBAI_DISABLE_SELF_REVIEW is set, skip the
        //    gate entirely. Useful with weak local models that reject their
        //    own output too aggressively — the dashboard's draft-preview UI
        //    is the real human review gate in that case.
        // When a dedicated reviewer LLM is configured, always run self-review
        // (the whole point is to use a stronger reviewer). Only honor the
        // env-var disable when we'd otherwise be asking the same weak model
        // to grade its own output.
        let env_disabled = std::env::var("CONTRIBAI_DISABLE_SELF_REVIEW")
            .map(|v| !v.is_empty() && v != "0" && !v.eq_ignore_ascii_case("false"))
            .unwrap_or(false);
        let self_review_active = self.self_review_enabled
            && (self.reviewer_llm.is_some() || !env_disabled);
        let mut contribution = contribution;
        if self_review_active {
            let (approved, reason) = self.self_review_with_reason(&contribution, context).await;
            if !approved {
                warn!(
                    title = %finding.title,
                    reason = %reason.as_deref().unwrap_or("(no reason)"),
                    "Self-review rejected contribution; attempting one regeneration with feedback"
                );

                // Regeneration prompt: keep it short and self-contained so
                // the model doesn't get tangled. Lead with the rejection
                // reason, restate the goal, then re-include the original
                // generation prompt at the end.
                let feedback_prompt = format!(
                    "## Your previous attempt was REJECTED by the code reviewer\n\n\
                     Reviewer's reason:\n```\n{reason}\n```\n\n\
                     ## What you must do now\n\
                     1. Read the reviewer's reason carefully.\n\
                     2. Produce a DIFFERENT change that directly addresses the issue: **{title}**.\n\
                     3. If the reviewer said you edited the wrong file, pick the file shown under \"Edit Target File(s)\" below and edit ONLY that file.\n\
                     4. If the reviewer said your change was unrelated, find the symbol named in the issue inside the edit target and modify it.\n\
                     5. Output VALID JSON only — no markdown fences, no prose, no comments. The JSON shape is `{{\"changes\": [...]}}` exactly as specified below.\n\n\
                     ---\n\n{original_prompt}",
                    reason = reason.as_deref().unwrap_or("(no specific reason given — your change did not resolve the issue)"),
                    title = finding.title,
                    original_prompt = self.build_generation_prompt(finding, context),
                );

                let response = self
                    .llm
                    .complete(&feedback_prompt, Some(&system), Some(0.2), None)
                    .await?;

                if let Some(retry_changes) = self.parse_changes(&response, context) {
                    if !retry_changes.is_empty() && self.validate_changes(&retry_changes) {
                        // Rebuild the contribution with the retry's changes.
                        let retry_commit = self.generate_commit_message(finding, &retry_changes);
                        contribution.changes = retry_changes;
                        contribution.commit_message = retry_commit;

                        // Re-run self-review on the new attempt.
                        let (approved2, reason2) =
                            self.self_review_with_reason(&contribution, context).await;
                        if !approved2 {
                            warn!(
                                title = %finding.title,
                                reason = %reason2.as_deref().unwrap_or("(no reason)"),
                                "Self-review rejected the regeneration attempt too; giving up"
                            );
                            return Ok(None);
                        }
                        info!(title = %finding.title, "Self-review approved regeneration");
                    } else {
                        warn!(title = %finding.title, "Regeneration produced no valid changes");
                        return Ok(None);
                    }
                } else {
                    warn!(title = %finding.title, "Regeneration produced no parseable JSON");
                    return Ok(None);
                }
            }
        }

        info!(
            title = %contribution.title,
            files = contribution.total_files_changed(),
            "Generated contribution"
        );

        Ok(Some(contribution))
    }

    // ── Prompt builders ──────────────────────────────────────────────────────

    /// Build system prompt with repo context and style guidance.
    fn build_system_prompt(&self, context: &RepoContext) -> String {
        let base_prompt = String::from(
            "You are a senior open-source contributor who writes production-ready \
             code. You understand that PRs are judged by maintainers who value \
             minimal, focused, and convention-matching changes.\n\n\
             RULES FOR GENERATING CHANGES:\n\
             1. Match existing code style EXACTLY (indentation, naming, patterns)\n\
             2. Make the SMALLEST change that correctly fixes the issue\n\
             3. Include proper error handling consistent with the codebase\n\
             4. Do NOT break existing functionality\n\
             5. Do NOT add unnecessary dependencies or imports\n\
             6. Do NOT refactor adjacent code — fix only the reported issue\n\
             7. Do NOT add comments explaining what the code does\n\
             8. Do NOT modify files unrelated to the finding\n\n\
             OUTPUT FORMAT RULES (CRITICAL):\n\
             - Return ONLY raw JSON — no markdown fences, no ```json blocks\n\
             - No explanatory text before or after the JSON\n\
             - The response must be valid, parseable JSON and nothing else\n\n\
             ACCEPTANCE CRITERIA:\n\
             - Would a busy maintainer merge this in under 30 seconds?\n\
             - Is the change obviously correct with no side effects?\n",
        );

        let mut prompt = hardened_system_prompt(&base_prompt);

        if let Some(style) = &context.coding_style {
            // Sanitize coding style before embedding
            let SanitizeResult {
                content: safe_style,
                ..
            } = sanitize_for_prompt(style);
            prompt.push_str(&format!(
                "\nCODEBASE STYLE:\n{}\n\
                 You MUST match these conventions exactly.\n",
                safe_style
            ));
        }

        prompt.push_str(&format!(
            "\nREPOSITORY: {}\nLanguage: {}\n",
            context.repo.full_name,
            context.repo.language.as_deref().unwrap_or("unknown")
        ));

        prompt
    }

    /// Build the generation prompt based on finding.
    ///
    /// Uses search/replace format for existing files (matching Python engine).
    fn build_generation_prompt(&self, finding: &Finding, context: &RepoContext) -> String {
        // Pick which files the LLM should treat as edit targets.
        // Priority 1: the exact `finding.file_path` if we have its contents.
        // Priority 2: every other file pre-attached to `relevant_files`
        //   (populated by solve.rs's candidate-file scan for issues whose
        //   `file_path` comes back as "unknown").
        let mut edit_targets: Vec<(String, String)> = Vec::new();
        if let Some(c) = context.relevant_files.get(&finding.file_path) {
            edit_targets.push((finding.file_path.clone(), c.clone()));
        }
        for (path, content) in &context.relevant_files {
            if path == &finding.file_path {
                continue;
            }
            edit_targets.push((path.clone(), content.clone()));
        }
        let current_content = edit_targets
            .first()
            .map(|(_, c)| c.as_str())
            .unwrap_or("");

        let suggestion_line = finding
            .suggestion
            .as_deref()
            .map(|s| format!("- **Suggestion**: {}\n", s))
            .unwrap_or_default();

        // Classify pre-attached files into primary edit targets (source code)
        // and reference-only context (docs/config). Without this split, weak
        // models pick the easiest file (usually README) and ignore the actual
        // code change the issue is asking for.
        let is_doc_path = |p: &str| {
            matches!(
                p.rsplit('.')
                    .next()
                    .map(|s| s.to_ascii_lowercase())
                    .as_deref(),
                Some("md" | "markdown" | "rst" | "txt" | "adoc")
            ) || p.eq_ignore_ascii_case("README")
                || p.eq_ignore_ascii_case("CONTRIBUTING")
                || p.eq_ignore_ascii_case("CHANGELOG")
                || p.eq_ignore_ascii_case("LICENSE")
                || p.starts_with("docs/")
                || p.starts_with("doc/")
        };
        let is_test_path = |p: &str| {
            p.starts_with("tests/")
                || p.starts_with("test/")
                || p.contains("/tests/")
                || p.contains("/test/")
                || p.split('/').next_back().map(|s| {
                    s.starts_with("test_") || s.ends_with("_test.py") || s.ends_with(".test.ts")
                        || s.ends_with(".test.tsx") || s.ends_with(".test.js")
                        || s.ends_with(".spec.ts") || s.ends_with(".spec.tsx")
                        || s.ends_with(".spec.js")
                }).unwrap_or(false)
        };

        // If the solver pointed at a specific file AND we have its content,
        // that file is THE edit target. Everything else (including other
        // non-doc files like tests) becomes reference-only. This is the
        // strongest signal we have for "edit here, not there."
        let solver_pinned: bool = !finding.file_path.is_empty()
            && finding.file_path != "unknown"
            && context.relevant_files.contains_key(&finding.file_path);

        let (primary_targets, reference_targets): (Vec<_>, Vec<_>) = if solver_pinned {
            edit_targets
                .iter()
                .cloned()
                .partition(|(p, _)| p == &finding.file_path)
        } else {
            edit_targets
                .iter()
                .cloned()
                .partition(|(p, _)| !is_doc_path(p) && !is_test_path(p))
        };

        // If we have any source files, the issue is *probably* a code fix.
        // If we only have doc files, treat them as the primary targets.
        let issue_is_doc_only = primary_targets.is_empty();
        let active_targets: Vec<(String, String)> = if issue_is_doc_only {
            reference_targets.clone()
        } else {
            primary_targets.clone()
        };

        let primary_paths_csv = active_targets
            .iter()
            .map(|(p, _)| p.clone())
            .collect::<Vec<_>>()
            .join(", ");
        let reference_paths_csv = if issue_is_doc_only {
            String::new()
        } else {
            reference_targets
                .iter()
                .map(|(p, _)| p.clone())
                .collect::<Vec<_>>()
                .join(", ")
        };

        let target_hint = if !finding.file_path.is_empty() && finding.file_path != "unknown"
        {
            format!(
                "- **Solver-identified file**: `{}` (start here unless this file is not in the list below)\n",
                finding.file_path
            )
        } else {
            String::new()
        };

        let mut prompt = format!(
            "# Goal\n\
             Resolve this specific issue and ONLY this issue. Do NOT make \
             unrelated changes (no doc tweaks, no refactoring, no formatting).\n\n\
             ## The Issue\n\
             - **Title**: {title}\n\
             - **Severity**: {severity}\n\
             - **What it asks for**: {description}\n\
             {suggestion}\n\
             ## Where to make the change\n\
             {target_hint}\
             - **Edit target file(s)**: {primary_paths}\n\
             {reference_line}\n\
             ## Hard rules — read before producing JSON\n\
             1. The change you produce MUST directly address the issue title above. \
                If you cannot make a change that does that, return an empty `changes` array — \
                do NOT pad the response with unrelated edits.\n\
             2. Edit ONLY the file(s) listed under \"Edit target file(s)\". The \
                reference-only files are shown for context — DO NOT modify them.\n\
             3. Find the symbol or behavior named in the issue title inside the \
                edit-target file(s). Make the smallest possible change to that \
                symbol that satisfies the issue.\n\
             4. Do NOT add a Contributing section, do NOT add badges, do NOT \
                update README, do NOT touch CHANGELOG unless the issue \
                explicitly asks for it.\n\
             5. Do NOT create new files unless the issue explicitly says to. \
                Modifying an existing file is almost always the right answer.\n\n",
            title = finding.title,
            severity = finding.severity,
            description = finding.description,
            suggestion = suggestion_line,
            target_hint = target_hint,
            primary_paths = if primary_paths_csv.is_empty() {
                "(no specific file pre-identified — pick the single best file from the contents shown below)".to_string()
            } else {
                primary_paths_csv.clone()
            },
            reference_line = if reference_paths_csv.is_empty() {
                String::new()
            } else {
                format!("- **Reference-only (do NOT edit)**: {}\n", reference_paths_csv)
            },
        );

        // Cross-file pattern injection deliberately skipped here. For
        // single-issue solve runs it usually duplicates the primary edit
        // target and burns 3K+ tokens with marginal value. The pinned-target
        // workflow already shows the right file in full; if we ever support
        // multi-file contributions we can re-enable this with a flag.

        // v5.6: Type-aware generation — inject type signatures of referenced symbols
        {
            let type_sigs: Vec<String> = context
                .symbol_map
                .values()
                .flatten()
                .filter(|s| {
                    matches!(
                        s.kind,
                        crate::core::models::SymbolKind::Function
                            | crate::core::models::SymbolKind::Struct
                            | crate::core::models::SymbolKind::Interface
                            | crate::core::models::SymbolKind::Class
                    )
                })
                .take(20)
                .map(|s| {
                    format!(
                        "{:?} {} ({}:L{}-L{})",
                        s.kind, s.name, s.file_path, s.line_start, s.line_end
                    )
                })
                .collect();

            if !type_sigs.is_empty() {
                let joined = type_sigs.join("\n");
                let ctx = safe_truncate(&joined, 2000);
                prompt.push_str(&format!(
                    "\n## Type Context (referenced symbols)\n```\n{}\n```\n\n",
                    ctx
                ));
            }
        }

        // v5.8.1: Cross-file resolved imports (separate from symbol_map)
        {
            let cross_sigs: Vec<String> = context
                .resolved_imports
                .values()
                .flatten()
                .take(20)
                .map(|s| format!("{} ({})", s.name, s.file_path))
                .collect();

            if !cross_sigs.is_empty() {
                let joined = cross_sigs.join("\n");
                let ctx = safe_truncate(&joined, 1500);
                prompt.push_str(&format!(
                    "\n## Cross-file Imports (resolved)\n```\n{}\n```\n\n",
                    ctx
                ));
            }
        }

        prompt.push_str("\n## Output Format\nReturn your changes as a JSON object.\n\n");

        if !edit_targets.is_empty() {
            // Budget the per-file snippet aggressively. With a smart model
            // (Gemini) ~4K chars is plenty to find and modify a function.
            // Going larger just burns daily-quota tokens for little benefit.
            let active_count = active_targets.len().max(1);
            let per_file_budget = if active_count == 1 {
                4500
            } else {
                (6000 / active_count).max(1500)
            };

            prompt.push_str(&format!(
                "## Edit Target File(s) — modify these to resolve the issue\n\n\
                 File contents are shown with `LINE_NUMBER|` prefixes for reference. \
                 The line-number prefix is NOT part of the file content — never include \
                 it in any `search` field.\n\n\
                 You MUST edit one of the {} file(s) below. Locate the symbol or behavior \
                 named in the issue title, then make the smallest possible change.\n\n",
                active_targets.len()
            ));

            for (path, content) in &active_targets {
                let raw_snippet = safe_truncate(content, per_file_budget);
                let SanitizeResult {
                    content: snippet,
                    injection_detected,
                    ..
                } = sanitize_for_prompt(raw_snippet);
                if injection_detected {
                    warn!(
                        file = %path,
                        "⚠️ Prompt injection in file content — sanitized before LLM"
                    );
                }
                let numbered: String = snippet
                    .lines()
                    .enumerate()
                    .map(|(i, l)| format!("{:>4}|{}", i + 1, l))
                    .collect::<Vec<_>>()
                    .join("\n");
                prompt.push_str(&format!("### {}\n```\n{}\n```\n\n", path, numbered));
            }

            if !issue_is_doc_only && !reference_targets.is_empty() {
                prompt.push_str(
                    "## Reference-only Files — DO NOT EDIT\n\n\
                     The following files are listed only so you understand the surrounding \
                     project. They are NOT permitted edit targets. Any change you produce \
                     for these paths will be rejected.\n\n",
                );
                for (path, _) in &reference_targets {
                    prompt.push_str(&format!("- `{}`\n", path));
                }
                prompt.push('\n');
            }

            prompt.push_str(
                "These files already exist. Make SMALL, TARGETED edits. \
                 DO NOT rewrite any file from scratch. DO NOT return the full \
                 contents of any file shown above. Only change what the issue \
                 requires — leave the rest of each file untouched.\n\n\
                 Pick the simplest action for the change you need:\n\n\
                 **A. APPEND** — add content to the end of a file (best for new doc sections, changelog entries, new test cases at end):\n\
                 ```json\n\
                 {{\n  \"changes\": [\n    {{\n\
                       \"path\": \"<one of the paths above>\",\n\
                       \"is_new_file\": false,\n\
                       \"append\": \"## New Section\\n\\nText to add at the bottom of the file.\\n\"\n\
                   }}\n  ]\n}}\n\
                 ```\n\n\
                 **B. PREPEND** — add content to the very top of a file (rare; e.g. license header):\n\
                 ```json\n\
                 {{ \"path\": \"<path>\", \"is_new_file\": false, \"prepend\": \"// Copyright ...\\n\" }}\n\
                 ```\n\n\
                 **C. INSERT AT LINE** — add content after a specific line number (use the line numbers shown in the file content above):\n\
                 ```json\n\
                 {{ \"path\": \"<path>\", \"is_new_file\": false, \"insert_after_line\": 42, \"insert_text\": \"new line(s) here\\n\" }}\n\
                 ```\n\n\
                 **D. SEARCH/REPLACE** — only when modifying or deleting existing text:\n\
                 ```json\n\
                 {{\n     \"path\": \"<path>\",\n\
                       \"is_new_file\": false,\n\
                       \"edits\": [\n        {{\n\
                           \"search\": \"EXACT substring copied verbatim from the file above\",\n\
                           \"replace\": \"replacement text (empty string deletes)\"\n\
                       }}\n      ]\n   }}\n\
                 ```\n\n\
                 RULES:\n\
                 - For ADDING content: prefer `append`, `prepend`, or `insert_after_line`. They never fail because they need no anchor.\n\
                 - For MODIFYING existing content: use `edits`, and `search` MUST be an exact substring copied character-for-character from the file shown above (including whitespace and newlines).\n\
                 - Pick ONE action type per change object. Do NOT combine `edits` with `append` in the same object.\n\
                 - Keep each change small and focused; prefer multiple small changes over one large one.\n\
                 - Do NOT emit a `\"content\"` field; do NOT set `is_new_file: true` for any path listed above.\n",
            );
        } else {
            prompt.push_str(
                "Since this is a NEW file, provide the full content:\n\n\
                 ```json\n\
                 {{\n  \"changes\": [\n    {{\n\
                       \"path\": \"path/to/file\",\n\
                       \"content\": \"full content of the new file\",\n\
                       \"is_new_file\": true\n\
                   }}\n  ]\n}}\n\
                 ```\n",
            );
        }

        // Suppress unused-variable warning when edit_targets is empty.
        let _ = current_content;

        prompt
    }

    // ── Commit / branch / PR title ───────────────────────────────────────────

    /// Generate a conventional commit message.
    fn generate_commit_message(&self, finding: &Finding, changes: &[FileChange]) -> String {
        let prefix = match finding.finding_type {
            ContributionType::SecurityFix => "fix(security)",
            ContributionType::CodeQuality => "refactor",
            ContributionType::DocsImprove => "docs",
            ContributionType::PerformanceOpt => "perf",
            ContributionType::FeatureAdd => "feat",
            ContributionType::Refactor => "refactor",
            ContributionType::UiUxFix => "fix(ui)",
        };

        // Extract scope from first changed file path (matching Python logic)
        let scope = changes.first().and_then(|c| {
            let parts: Vec<&str> = c.path.split('/').collect();
            if parts.len() >= 2 && matches!(parts[0], "src" | "packages" | "apps" | "libs") {
                Some(parts[1].to_string())
            } else {
                None
            }
        });

        let title = finding.title.to_lowercase();
        let title = safe_truncate(&title, 50);
        let files: String = changes
            .iter()
            .take(3)
            .map(|c| c.path.split('/').next_back().unwrap_or(&c.path))
            .collect::<Vec<_>>()
            .join(", ");

        if let Some(s) = scope {
            format!(
                "{}({}): {}\n\n{}\n\nAffected files: {}",
                prefix, s, title, finding.description, files
            )
        } else {
            format!(
                "{}: {}\n\n{}\n\nAffected files: {}",
                prefix, title, finding.description, files
            )
        }
    }

    /// Generate a natural-looking branch name.
    pub fn generate_branch_name(finding: &Finding) -> String {
        let prefix = match finding.finding_type {
            ContributionType::SecurityFix => "fix/security",
            ContributionType::CodeQuality => "improve/quality",
            ContributionType::DocsImprove => "docs",
            ContributionType::PerformanceOpt => "perf",
            ContributionType::FeatureAdd => "feat",
            ContributionType::Refactor => "refactor",
            ContributionType::UiUxFix => "fix/ui",
        };

        let lower = finding.title.to_lowercase();
        let slug = RE_SLUG.replace_all(&lower, "-");
        let slug = slug.trim_matches('-');
        let slug = safe_truncate(slug, 40);

        format!("contribai/{}/{}", prefix, slug)
    }

    /// Generate a PR title using the default label format.
    pub fn generate_pr_title(finding: &Finding) -> String {
        Self::generate_pr_title_with_guidelines(finding, None)
    }

    /// Generate a PR title adapted to repo guidelines if available.
    ///
    /// If `guidelines` is `Some` and `has_guidelines()` returns true, delegates to
    /// `adapt_pr_title` + `extract_scope_from_path` from `guidelines.rs`.
    /// Otherwise falls back to the default label-based format.
    pub fn generate_pr_title_with_guidelines(
        finding: &Finding,
        guidelines: Option<&RepoGuidelines>,
    ) -> String {
        if let Some(g) = guidelines {
            if g.has_guidelines() {
                let scope = extract_scope_from_path(&finding.file_path, g);
                let type_str = match finding.finding_type {
                    ContributionType::SecurityFix => "security_fix",
                    ContributionType::CodeQuality => "code_quality",
                    ContributionType::DocsImprove => "docs_improve",
                    ContributionType::UiUxFix => "ui_ux_fix",
                    ContributionType::PerformanceOpt => "performance_opt",
                    ContributionType::FeatureAdd => "feature_add",
                    ContributionType::Refactor => "refactor",
                };
                return adapt_pr_title(&finding.title, type_str, g, &scope);
            }
        }

        // Default: label-based format
        let label = match finding.finding_type {
            ContributionType::SecurityFix => "Security",
            ContributionType::CodeQuality => "Quality",
            ContributionType::DocsImprove => "Docs",
            ContributionType::UiUxFix => "UI/UX",
            ContributionType::PerformanceOpt => "Performance",
            ContributionType::FeatureAdd => "Feature",
            ContributionType::Refactor => "Refactor",
        };
        format!("{}: {}", label, finding.title)
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::core::models::{ContributionType, Severity};
    use std::collections::HashMap;

    pub fn test_finding() -> Finding {
        Finding {
            id: "test".into(),
            finding_type: ContributionType::SecurityFix,
            severity: Severity::High,
            title: "SQL injection in user query".into(),
            description: "User input not sanitized".into(),
            file_path: "src/db/queries.py".into(),
            line_start: Some(42),
            line_end: Some(45),
            suggestion: Some("Use parameterized queries".into()),
            confidence: 0.9,
            priority_signals: vec![],
        }
    }

    /// Construct a minimal Repository without relying on Default.
    fn test_repo() -> crate::core::models::Repository {
        crate::core::models::Repository {
            owner: "owner".into(),
            name: "repo".into(),
            full_name: "owner/repo".into(),
            description: None,
            language: None,
            languages: HashMap::new(),
            stars: 0,
            forks: 0,
            open_issues: 0,
            topics: vec![],
            default_branch: "main".into(),
            html_url: String::new(),
            clone_url: String::new(),
            has_contributing: false,
            has_license: false,
            last_push_at: None,
            created_at: None,
        }
    }

    /// Construct a minimal RepoContext for tests.
    pub fn test_context(files: HashMap<String, String>) -> RepoContext {
        RepoContext {
            repo: test_repo(),
            relevant_files: files,
            file_tree: vec![],
            readme_content: None,
            contributing_guide: None,
            open_issues: vec![],
            coding_style: None,
            symbol_map: HashMap::new(),
            resolved_imports: HashMap::new(),
            file_ranks: HashMap::new(),
        }
    }

    pub fn mock_gen() -> ContributionGenerator<'static> {
        use std::sync::OnceLock;
        static CONFIG: OnceLock<ContributionConfig> = OnceLock::new();
        let config = CONFIG.get_or_init(ContributionConfig::default);
        static MOCK: MockLlm = MockLlm;
        ContributionGenerator {
            llm: &MOCK,
            config,
            self_review_enabled: false,
        }
    }

    // ── Branch name ──────────────────────────────────────────────────────────

    #[test]
    fn test_generate_branch_name() {
        let f = test_finding();
        let branch = ContributionGenerator::generate_branch_name(&f);
        assert!(branch.starts_with("contribai/fix/security/"));
        assert!(branch.contains("sql-injection"));
    }

    // ── PR title ─────────────────────────────────────────────────────────────

    #[test]
    fn test_generate_pr_title() {
        let f = test_finding();
        let title = ContributionGenerator::generate_pr_title(&f);
        assert!(title.starts_with("Security: "));
    }

    #[test]
    fn test_generate_pr_title_with_conventional_guidelines() {
        let g = RepoGuidelines {
            uses_conventional_commits: true,
            contributing_md: "uses conventional commits".into(),
            pr_template: "## Description".into(),
            ..Default::default()
        };
        let f = test_finding();
        let title = ContributionGenerator::generate_pr_title_with_guidelines(&f, Some(&g));
        // Conventional commits format: "fix: sql injection in user query"
        assert!(title.starts_with("fix:") || title.contains("sql injection"));
    }

    // ── Commit message ───────────────────────────────────────────────────────

    #[test]
    fn test_generate_commit_message() {
        let gen = mock_gen();
        let f = test_finding();
        let changes = vec![FileChange {
            path: "src/db/queries.py".into(),
            original_content: None,
            new_content: "fixed".into(),
            is_new_file: false,
            is_deleted: false,
        }];
        let msg = gen.generate_commit_message(&f, &changes);
        // Should contain "fix(security)" and scope "(db)"
        assert!(msg.contains("fix(security)"));
        assert!(msg.contains("(db)"));
    }

    // ── Mock LLM ─────────────────────────────────────────────────────────────

    pub(crate) struct MockLlm;

    #[async_trait::async_trait]
    impl LlmProvider for MockLlm {
        async fn complete(
            &self,
            _prompt: &str,
            _system: Option<&str>,
            _temperature: Option<f64>,
            _max_tokens: Option<u32>,
        ) -> Result<String> {
            Ok("mock response".into())
        }

        async fn chat(
            &self,
            _messages: &[crate::llm::provider::ChatMessage],
            _system: Option<&str>,
            _temperature: Option<f64>,
            _max_tokens: Option<u32>,
        ) -> Result<String> {
            Ok("mock response".into())
        }
    }
}
