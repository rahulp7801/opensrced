//! Handles `Commands::Templates` — list available contribution templates.

use colored::Colorize;

use crate::cli::print_banner;

pub fn run_templates(type_filter: Option<&str>) -> anyhow::Result<()> {
    struct TemplateDef {
        name: &'static str,
        r#type: &'static str,
        severity: &'static str,
        description: &'static str,
        languages: &'static str,
    }

    const TEMPLATES: &[TemplateDef] = &[
        TemplateDef {
            name: "sql-injection-fix",
            r#type: "security_fix",
            severity: "critical",
            description: "Fix SQL injection vulnerabilities",
            languages: "python, js, ts, go",
        },
        TemplateDef {
            name: "xss-fix",
            r#type: "security_fix",
            severity: "high",
            description: "Fix XSS vulnerabilities",
            languages: "js, ts",
        },
        TemplateDef {
            name: "path-traversal-fix",
            r#type: "security_fix",
            severity: "high",
            description: "Fix path traversal issues",
            languages: "python, go, rust",
        },
        TemplateDef {
            name: "missing-docstrings",
            r#type: "docs_improve",
            severity: "low",
            description: "Add missing docstrings to functions",
            languages: "python",
        },
        TemplateDef {
            name: "readme-badges",
            r#type: "docs_improve",
            severity: "low",
            description: "Add CI/coverage badges to README",
            languages: "all",
        },
        TemplateDef {
            name: "error-handling",
            r#type: "code_quality",
            severity: "medium",
            description: "Improve error handling patterns",
            languages: "python, go, rust",
        },
        TemplateDef {
            name: "add-type-hints",
            r#type: "code_quality",
            severity: "low",
            description: "Add Python type hints",
            languages: "python",
        },
        TemplateDef {
            name: "add-tests",
            r#type: "code_quality",
            severity: "medium",
            description: "Add missing unit tests",
            languages: "python, js, ts, go",
        },
        TemplateDef {
            name: "performance-cache",
            r#type: "performance_opt",
            severity: "medium",
            description: "Add caching to expensive operations",
            languages: "python, go",
        },
        TemplateDef {
            name: "refactor-long-fn",
            r#type: "refactor",
            severity: "low",
            description: "Break up overly long functions",
            languages: "python, js, ts",
        },
        TemplateDef {
            name: "dependency-update",
            r#type: "security_fix",
            severity: "medium",
            description: "Update vulnerable dependencies",
            languages: "all",
        },
        TemplateDef {
            name: "add-logging",
            r#type: "code_quality",
            severity: "low",
            description: "Add structured logging",
            languages: "python, go, rust",
        },
        TemplateDef {
            name: "issue-fix",
            r#type: "feature_add",
            severity: "medium",
            description: "Fix a GitHub issue based on repro steps",
            languages: "all",
        },
        TemplateDef {
            name: "ui-accessibility",
            r#type: "ui_ux_fix",
            severity: "medium",
            description: "Fix accessibility issues (aria, contrast, focus)",
            languages: "js, ts",
        },
    ];

    let templates: Vec<&TemplateDef> = TEMPLATES
        .iter()
        .filter(|t| {
            type_filter
                .map(|f| t.r#type == f || t.r#type.contains(f))
                .unwrap_or(true)
        })
        .collect();

    print_banner();
    println!("{}", "📋 Contribution Templates".cyan().bold());
    println!("{}", "━".repeat(100).dimmed());

    if templates.is_empty() {
        println!(
            "  {} No templates match filter '{}'",
            "⚠️".yellow(),
            type_filter.unwrap_or("")
        );
    } else {
        println!(
            "  {:<25} {:<18} {:<10} {:<38} {}",
            "Name".bold(),
            "Type".bold(),
            "Severity".bold(),
            "Description".bold(),
            "Languages".bold()
        );
        println!("{}", "─".repeat(100).dimmed());

        for t in &templates {
            let sev_colored = match t.severity {
                "critical" => t.severity.red().bold().to_string(),
                "high" => t.severity.red().to_string(),
                "medium" => t.severity.yellow().to_string(),
                _ => t.severity.dimmed().to_string(),
            };
            println!(
                "  {:<25} {:<18} {:<18} {:<38} {}",
                t.name.cyan(),
                t.r#type.dimmed(),
                sev_colored,
                t.description.chars().take(38).collect::<String>(),
                t.languages.dimmed()
            );
        }
    }
    println!();
    Ok(())
}
