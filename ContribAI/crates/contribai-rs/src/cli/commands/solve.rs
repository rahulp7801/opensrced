//! Handles `Commands::Solve` — solve open issues in a repository.

use std::collections::HashSet;

use colored::Colorize;
use regex::Regex;

use crate::cli::{
    create_github, create_llm, create_memory, create_reviewer_llm, load_config, parse_github_url,
    print_banner,
};

/// Extracts identifier candidates (function/class/method names) from an issue
/// body so we can locate them in the repo via GitHub code search.
///
/// Why: `extract_candidate_files` only catches mentions of file paths and
/// extensions. Issues like "fix get_processor_name when /proc/cpuinfo lacks
/// model name" mention only a function name — without resolving it to a real
/// file, the solver hallucinates a path like `/usr/local/bin/...`.
fn extract_candidate_symbols(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // Backtick-wrapped identifiers — strongest signal.
    let backtick = Regex::new(r"`([A-Za-z_][A-Za-z0-9_]{2,})`").unwrap();
    for c in backtick.captures_iter(body) {
        let s = c[1].to_string();
        if !is_noise_word(&s) && seen.insert(s.clone()) {
            out.push(s);
        }
    }

    // Explicit Python/JS/Rust declaration mentions: `def foo`, `class Foo`,
    // `function foo`, `fn foo`.
    let decl = Regex::new(
        r"(?i)\b(?:def|class|fn|function)\s+([A-Za-z_][A-Za-z0-9_]{2,})",
    )
    .unwrap();
    for c in decl.captures_iter(body) {
        let s = c[1].to_string();
        if !is_noise_word(&s) && seen.insert(s.clone()) {
            out.push(s);
        }
    }

    // snake_case and PascalCase tokens that look like identifiers (must
    // contain `_` or have a leading uppercase + lowercase mix).
    let ident = Regex::new(r"\b([A-Za-z_][A-Za-z0-9_]{3,})\b").unwrap();
    for c in ident.captures_iter(body) {
        let s = c[1].to_string();
        let snake = s.contains('_') && s.chars().all(|c| !c.is_ascii_uppercase());
        let pascal = s
            .chars()
            .next()
            .map(|c| c.is_ascii_uppercase())
            .unwrap_or(false)
            && s.chars().any(|c| c.is_ascii_lowercase());
        if !(snake || pascal) {
            continue;
        }
        if !is_noise_word(&s) && seen.insert(s.clone()) {
            out.push(s);
        }
    }

    out.truncate(8);
    out
}

fn is_noise_word(s: &str) -> bool {
    matches!(
        s.to_ascii_lowercase().as_str(),
        "the" | "and" | "but" | "for" | "with" | "from" | "this" | "that"
            | "have" | "been" | "will" | "would" | "could" | "should"
            | "https" | "http" | "github" | "com" | "html" | "json" | "yaml"
            | "true" | "false" | "none" | "null" | "todo" | "fixme"
            | "system" | "windows" | "linux" | "macos" | "ubuntu" | "fedora"
            | "intel" | "amd" | "arm" | "issue" | "issues" | "error" | "errors"
            | "step" | "steps" | "version" | "describe" | "environment"
    )
}

/// Extracts file-path candidates from an issue body and resolves them against
/// the repo's actual file tree.
///
/// Why: when a `Finding` comes back with `file_path = "unknown"` (feature
/// requests, docs issues, vague bug reports), the generator had no repo context
/// and would ask the LLM to write files from scratch — clobbering existing
/// ones like README.md. Pre-attaching files the issue explicitly references
/// fixes this at the root.
fn extract_candidate_files(body: &str, file_tree: &[contribai::core::models::FileNode]) -> Vec<String> {
    let doc_rx = Regex::new(r"\b(README|CHANGELOG|CHANGES|LICENSE|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|NOTICE|AUTHORS)\b").unwrap();
    let path_rx = Regex::new(r"[A-Za-z0-9_./\-]*[A-Za-z0-9_\-]+/[A-Za-z0-9_./\-]+\.[A-Za-z0-9]{1,8}").unwrap();
    let file_rx = Regex::new(r"\b[A-Za-z0-9_][A-Za-z0-9_\-]*\.(md|rst|txt|py|rs|ts|tsx|js|jsx|go|java|rb|php|cs|cpp|c|h|hpp|toml|yaml|yml|json|cfg|ini|sh|bat|mk|dockerfile)\b").unwrap();

    let mut mentions: HashSet<String> = HashSet::new();
    for c in doc_rx.find_iter(body) {
        mentions.insert(c.as_str().to_string());
    }
    for c in path_rx.find_iter(body) {
        mentions.insert(c.as_str().to_string());
    }
    for c in file_rx.find_iter(body) {
        mentions.insert(c.as_str().to_string());
    }

    if mentions.is_empty() {
        return Vec::new();
    }

    // Strip noise: very short tokens, common English words, and tokens that
    // matched only because they appear inside a longer URL.
    mentions.retain(|m| m.len() >= 3);

    let mut picks: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for node in file_tree {
        if node.node_type != "blob" {
            continue;
        }
        let path_lower = node.path.to_lowercase();
        let basename = node
            .path
            .rsplit('/')
            .next()
            .unwrap_or(&node.path)
            .to_string();
        let basename_lower = basename.to_lowercase();

        for mention in &mentions {
            let m_lower = mention.to_lowercase();
            // Exact path match, or basename matches (case-insensitive), or
            // basename starts with the mention (catches "README" → "README.md").
            let matches = path_lower == m_lower
                || basename_lower == m_lower
                || basename_lower.starts_with(&format!("{}.", m_lower))
                || path_lower.ends_with(&format!("/{}", m_lower));
            if matches && seen.insert(node.path.clone()) {
                picks.push(node.path.clone());
                break;
            }
        }
        if picks.len() >= 5 {
            break;
        }
    }
    picks
}

pub async fn run_solve(
    config_path: Option<&str>,
    url: String,
    dry_run: bool,
    issue_filter: Option<u64>,
) -> anyhow::Result<()> {
    print_banner();
    let config = load_config(config_path)?;

    println!(
        "🧩 Solving issues in: {} {}",
        url.cyan().bold(),
        if dry_run {
            "(DRY RUN)".yellow().to_string()
        } else {
            "(LIVE)".green().to_string()
        }
    );
    println!();

    let (owner, name) = parse_github_url(&url)?;
    let full_name = format!("{}/{}", owner, name);

    let github = create_github(&config)?;
    let llm = create_llm(&config)?;
    let reviewer_llm = create_reviewer_llm(&config)?;
    if let Some(rev_cfg) = &config.reviewer {
        println!(
            "  {} Reviewer model: {} ({}){}",
            "🧑‍⚖️".dimmed(),
            rev_cfg.model.dimmed(),
            rev_cfg.provider.dimmed(),
            if reviewer_llm.is_some() { "" } else { " — failed to init, falling back to primary llm" }
        );
    }

    let repo = contribai::core::models::Repository {
        owner: owner.clone(),
        name: name.clone(),
        full_name: full_name.clone(),
        description: None,
        language: None,
        languages: std::collections::HashMap::new(),
        stars: 0,
        forks: 0,
        open_issues: 0,
        default_branch: "main".to_string(),
        topics: vec![],
        html_url: url.clone(),
        clone_url: format!("https://github.com/{}.git", full_name),
        has_contributing: false,
        has_license: false,
        last_push_at: None,
        created_at: None,
    };

    let solver = contribai::issues::solver::IssueSolver::new(llm.as_ref(), &github);

    // When --issue N is given, trust the user: fetch that specific issue by number,
    // bypassing the solver's label-based "solvable" filter (which excludes many
    // unlabeled user-reported bugs).
    let mut issues = if let Some(n) = issue_filter {
        match github.list_issues(&owner, &name, None, None, 100).await {
            Ok(raw) => raw
                .into_iter()
                .filter_map(|v| {
                    if v.get("pull_request").is_some() || v["number"].as_i64()? != n as i64 {
                        return None;
                    }
                    Some(contribai::core::models::Issue {
                        number: v["number"].as_i64().unwrap_or(0),
                        title: v["title"].as_str().unwrap_or("").to_string(),
                        body: v["body"].as_str().map(String::from),
                        labels: v["labels"]
                            .as_array()
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|l| l["name"].as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        state: v["state"].as_str().unwrap_or("open").to_string(),
                        created_at: None,
                        html_url: v["html_url"].as_str().unwrap_or("").to_string(),
                    })
                })
                .collect::<Vec<_>>(),
            Err(_) => Vec::new(),
        }
    } else {
        solver.fetch_solvable_issues(&repo, 50, 3).await
    };

    if let Some(n) = issue_filter {
        if issues.is_empty() {
            println!(
                "  {} Issue #{} not found in the first 100 open issues of {}.",
                "⚠️".bold(),
                n,
                full_name.cyan()
            );
            return Ok(());
        }
        println!(
            "  {} Targeting single issue #{} in {} (user-selected — bypassing solvability filter)\n",
            "🎯".bold(),
            n,
            full_name.cyan()
        );
    }

    if issues.is_empty() {
        println!(
            "  {} No solvable issues found in {}",
            "⚠️".bold(),
            full_name.cyan()
        );
        return Ok(());
    }

    println!(
        "  {} Found {} solvable issue(s):\n",
        "📋".bold(),
        issues.len().to_string().cyan()
    );
    println!(
        "  {:>6}  {:<45}  {:<12}  {}",
        "Issue#".dimmed(),
        "Title".dimmed(),
        "Category".dimmed(),
        "URL".dimmed()
    );
    println!("  {}", "─".repeat(80).dimmed());

    for issue in &issues {
        let category = solver.classify_issue(issue);
        let cat_str = format!("{:?}", category);
        let title: String = issue.title.chars().take(43).collect();
        println!(
            "  {:>6}  {:<45}  {:<12}  {}",
            format!("#{}", issue.number).cyan(),
            title,
            cat_str.yellow(),
            issue.html_url.dimmed(),
        );
    }

    // v5.5: Actually solve issues and create PRs
    println!();

    let memory = create_memory(&config)?;
    let file_tree = github
        .get_file_tree(&owner, &name, None)
        .await
        .unwrap_or_default();

    let repo_context = contribai::core::models::RepoContext {
        repo: repo.clone(),
        file_tree,
        readme_content: None,
        contributing_guide: None,
        relevant_files: std::collections::HashMap::new(),
        open_issues: Vec::new(),
        coding_style: None,
        symbol_map: std::collections::HashMap::new(),
        resolved_imports: std::collections::HashMap::new(),
        file_ranks: std::collections::HashMap::new(),
    };

    let mut generator = contribai::generator::engine::ContributionGenerator::new(
        llm.as_ref(),
        &config.contribution,
    );
    if let Some(rev) = reviewer_llm.as_deref() {
        generator = generator.with_reviewer(rev);
    }

    let mut prs_created = 0u32;
    for issue in &issues {
        println!(
            "  {} Solving issue #{}...",
            "🔧".bold(),
            issue.number.to_string().cyan()
        );

        // Pre-attach candidate files the issue body references, resolved
        // against the actual file tree. Feeds both the solver (so it can
        // return a concrete file_path instead of "unknown") and the generator
        // (so it can emit search/replace edits instead of rewriting files
        // from scratch).
        let mut ctx = repo_context.clone();
        let body_str = issue.body.clone().unwrap_or_default();
        let combined_text = format!("{}\n{}", issue.title, body_str);
        let mut candidates = extract_candidate_files(&combined_text, &ctx.file_tree);

        // Also resolve identifier mentions (function/class/method names) by
        // searching the repo's code via GitHub's code-search API. Stops the
        // solver from inventing fake file paths when the issue describes a
        // symbol but never names its file.
        // Symbol → file resolution. We over-fetch here (8 symbols × up to 4
        // paths each, cap 10 total) so that one-hop callers of the canonical
        // source land in `relevant_files` too. They get partitioned in
        // engine.rs into "Reference-only (do NOT edit)" alongside the pinned
        // edit target, giving the generator the surrounding call context
        // without letting it edit sibling files by accident.
        //
        // Why bigger than the old cap of 5: leaf bug-fixes fit in 5, but
        // cross-file fixes (patch the definition, respect 2–3 callers) need
        // the caller content in scope to avoid breaking signatures. The
        // engine's target-hint + "Hard rules" block prevent stray edits.
        let symbols = extract_candidate_symbols(&combined_text);
        let mut symbol_paths: Vec<String> = Vec::new();
        const SYMBOL_BUDGET: usize = 10;
        for sym in symbols.iter().take(8) {
            match github.search_code_in_repo(&owner, &name, sym, 6).await {
                Ok(paths) => {
                    for p in paths.into_iter().take(4) {
                        if !candidates.contains(&p) && !symbol_paths.contains(&p) {
                            symbol_paths.push(p);
                        }
                    }
                }
                Err(_) => continue,
            }
            if symbol_paths.len() >= SYMBOL_BUDGET {
                break;
            }
        }
        symbol_paths.truncate(SYMBOL_BUDGET);
        for p in &symbol_paths {
            candidates.push(p.clone());
        }

        for path in &candidates {
            if ctx.relevant_files.contains_key(path) {
                continue;
            }
            if let Ok(content) = github.get_file_content(&owner, &name, path, None).await {
                ctx.relevant_files.insert(path.clone(), content);
            }
        }
        if !candidates.is_empty() {
            println!(
                "    {} Pre-attached {} file(s) referenced by the issue: {}",
                "📎".dimmed(),
                candidates.len(),
                candidates.join(", ").dimmed()
            );
        }

        // Pick the most likely "canonical" source file from symbol search so
        // we can override an "unknown" file_path on the finding. The first
        // non-doc, non-test result is the strongest signal we have for
        // "where does the change need to go." Without this, the LLM saw a menu
        // of candidate files and picked the easiest one (usually a test or doc),
        // which the self-reviewer then rejected.
        let canonical_source: Option<String> = symbol_paths
            .iter()
            .find(|p| {
                let ext = p
                    .rsplit('.')
                    .next()
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_default();
                !matches!(ext.as_str(), "md" | "markdown" | "rst" | "txt" | "adoc")
                    && !p.starts_with("docs/")
                    && !p.starts_with("doc/")
                    && !p.starts_with("tests/")
                    && !p.starts_with("test/")
            })
            .cloned();

        // Solve: issue → findings (now with candidate files already in ctx)
        let mut findings = solver.solve_issue_deep(issue, &repo, &ctx).await;
        if findings.is_empty() {
            println!("    {} No actionable findings", "⚠️".dimmed());
            continue;
        }

        // Override the solver's file_path with the symbol-resolved canonical
        // source. GitHub code-search definitively returned the file that
        // contains the symbol; trust it over the LLM solver's guess (which
        // often picks a sibling like the test file or main entry point).
        if let Some(canon) = &canonical_source {
            let primary_symbol = symbols.first().cloned();
            // Other symbol-search hits (minus the canonical itself) are
            // 1-hop callers we've pre-attached as reference context. Naming
            // them in the routing hint tells the LLM those files exist to
            // read, not to edit — if it mis-edits a caller, the self-reviewer
            // rejects and we burn a regeneration attempt.
            let caller_files: Vec<&String> = symbol_paths
                .iter()
                .filter(|p| p != &canon)
                .take(5)
                .collect();
            for f in findings.iter_mut() {
                f.file_path = canon.clone();
                if let Some(sym) = &primary_symbol {
                    let base_routing = format!(
                        "Make the change inside `{}` (the file containing the symbol `{}`). \
                         Do NOT edit any other file — not tests, not README, not the project's \
                         entry-point module.",
                        canon, sym
                    );
                    let callers_hint = if caller_files.is_empty() {
                        String::new()
                    } else {
                        let csv = caller_files
                            .iter()
                            .map(|s| format!("`{}`", s))
                            .collect::<Vec<_>>()
                            .join(", ");
                        format!(
                            " Callers of `{}` live in: {}. They are provided as read-only \
                             context so your change stays compatible with their call sites.",
                            sym, csv
                        )
                    };
                    let routing = format!("{}{}", base_routing, callers_hint);
                    f.suggestion = Some(match &f.suggestion {
                        Some(existing) if !existing.is_empty() => {
                            format!("{} {}", routing, existing)
                        }
                        _ => routing,
                    });
                }
            }
            println!(
                "    {} Routed finding(s) to canonical source: {} ({} caller file{} pre-attached)",
                "🎯".dimmed(),
                canon.dimmed(),
                caller_files.len(),
                if caller_files.len() == 1 { "" } else { "s" },
            );
        }

        // Fetch file contents for any additional files the solver identified.
        for f in &findings {
            if !f.file_path.is_empty()
                && f.file_path != "unknown"
                && !ctx.relevant_files.contains_key(&f.file_path)
            {
                if let Ok(content) = github
                    .get_file_content(&owner, &name, &f.file_path, None)
                    .await
                {
                    ctx.relevant_files.insert(f.file_path.clone(), content);
                }
            }
        }

        // Generate code for each finding
        let mut valid = Vec::new();
        for finding in &findings {
            if let Ok(Some(mut contrib)) = generator.generate(finding, &ctx).await {
                contrib.description = format!("Fixes #{}\n\n{}", issue.number, contrib.description);
                valid.push(contrib);
            }
        }

        if valid.is_empty() {
            println!("    {} Generation failed", "❌".dimmed());
            continue;
        }

        // Merge into single PR
        let file_count = valid.iter().map(|c| c.changes.len()).sum::<usize>();
        let mut merged = contribai::orchestrator::pipeline::merge_contributions_pub(valid);
        merged.title = format!("fix: resolve #{} — {}", issue.number, issue.title);
        merged.commit_message = format!(
            "fix: resolve #{} — {}\n\nFixes #{}",
            issue.number, issue.title, issue.number
        );

        if dry_run {
            println!(
                "    {} Would create PR ({} files)",
                "[DRY RUN]".yellow(),
                file_count
            );
            // Dump the full generated contribution to disk so a UI can preview it
            // before the user re-runs live. Activated by env var.
            if let Ok(draft_dir) = std::env::var("CONTRIBAI_DRAFT_DIR") {
                let _ = std::fs::create_dir_all(&draft_dir);
                let draft_path =
                    std::path::Path::new(&draft_dir).join(format!("issue-{}.json", issue.number));
                match serde_json::to_string_pretty(&merged) {
                    Ok(json) => {
                        if std::fs::write(&draft_path, json).is_ok() {
                            println!(
                                "    {} Draft: {}",
                                "💾".dimmed(),
                                draft_path.display().to_string().dimmed()
                            );
                        }
                    }
                    Err(e) => {
                        println!("    {} Draft serialize failed: {}", "⚠️".dimmed(), e);
                    }
                }
            }
            continue;
        }

        let mut pr_mgr = contribai::pr::manager::PrManager::new(&github);
        match pr_mgr.create_pr(&merged, &repo).await {
            Ok(pr_result) => {
                prs_created += 1;
                let _ = memory.record_pr(
                    &full_name,
                    pr_result.pr_number,
                    &pr_result.pr_url,
                    &merged.title,
                    &merged.contribution_type.to_string(),
                    &pr_result.branch_name,
                    &pr_result.fork_full_name,
                );
                println!(
                    "    {} PR #{} created → {}",
                    "✅".bold(),
                    pr_result.pr_number.to_string().green(),
                    pr_result.pr_url.dimmed()
                );
            }
            Err(e) => {
                println!("    {} PR failed: {}", "❌".bold(), format!("{}", e).red());
            }
        }
    }

    println!();
    if prs_created > 0 {
        println!(
            "  {} {} PR(s) created from {} issues",
            "🎉".bold(),
            prs_created.to_string().green(),
            issues.len()
        );
    } else if dry_run {
        println!("  {} Dry run — no PRs submitted.", "[DRY RUN]".yellow());
    } else {
        println!("  {} No PRs could be generated.", "⚠️".bold());
    }
    Ok(())
}
