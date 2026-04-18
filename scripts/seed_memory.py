"""Seed ~/.contribai/memory.db with realistic PRs so the dashboard has live data.

Idempotent — uses UNIQUE(repo, pr_number) to skip duplicates on re-run.
"""
from __future__ import annotations

import os
import random
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB = Path.home() / ".contribai" / "memory.db"

REPOS = [
    ("sherlock-project/sherlock", "python", 58200),
    ("astral-sh/ruff", "rust", 32100),
    ("soimort/you-get", "python", 52800),
    ("pola-rs/polars", "rust", 31400),
    ("tokio-rs/tokio", "rust", 28000),
    ("huggingface/transformers", "python", 132000),
    ("denoland/deno", "rust", 97200),
    ("vuejs/core", "typescript", 48800),
    ("vercel/next.js", "typescript", 126000),
    ("facebook/react", "javascript", 232000),
    ("soulteary/maigret", "python", 19400),
    ("worldmonitor/worldmonitor", "typescript", 45300),
    ("robusta-dev/holmesgpt", "python", 2800),
    ("amanusk/s-tui", "python", 5100),
    ("dalgona-dev/kairos", "go", 1450),
    ("signal-k/lantern", "typescript", 8800),
    ("aptos-labs/aptos-core", "rust", 6200),
    ("openobserve/openobserve", "rust", 12900),
    ("surrealdb/surrealdb", "rust", 27600),
    ("bevyengine/bevy", "rust", 36800),
    ("ggerganov/llama.cpp", "c++", 67000),
    ("chartjs/Chart.js", "javascript", 64500),
    ("withastro/astro", "typescript", 45100),
]

TITLES = {
    "security_fix": [
        "Guard against path traversal in archive extractor",
        "Sanitize user input in webhook dispatch",
        "Fix SQLi in report query builder",
        "Mitigate XSS via Markdown rendering pipeline",
        "Close resource leak in TLS handshake retry",
        "Constant-time comparison for session tokens",
    ],
    "docs_improve": [
        "Add migration guide from v3 to v4",
        "Document thread-safety guarantees of Cache",
        "Clarify default values in config reference",
        "Add troubleshooting section for SIGPIPE",
        "Document env var precedence in README",
    ],
    "code_quality": [
        "Extract shared retry helper from HTTP clients",
        "Remove dead code in legacy encoder path",
        "Consolidate error variants in parser module",
        "Simplify async cancellation in scheduler loop",
        "Replace manual mutex with parking_lot",
    ],
    "feature_add": [
        "Support YAML output in `stats` command",
        "Add `--since` flag to activity timeline",
        "Introduce configurable cache TTL",
        "Add pagination to /api/prs endpoint",
    ],
    "ui_ux_fix": [
        "Improve contrast of disabled buttons",
        "Restore focus ring on dialog close",
        "Fix chart tooltip overflow on narrow viewports",
    ],
    "performance_opt": [
        "Cache compiled regex in log filter hot path",
        "Stream large response bodies instead of buffering",
        "Reduce allocations in AST visitor",
    ],
    "refactor": [
        "Split `client.rs` into auth, rate-limit, retry modules",
        "Pull LLM prompt builders into dedicated namespace",
    ],
    "test_add": [
        "Add property tests for retry backoff",
        "Cover edge cases in YAML parser",
        "Integration test for webhook replay",
    ],
}

STATUSES = [
    ("merged", 22),
    ("open", 28),
    ("ci_passed", 12),
    ("ci_failed", 5),
    ("draft", 6),
    ("closed", 9),
]


def weighted(items):
    total = sum(w for _, w in items)
    r = random.random() * total
    for k, w in items:
        r -= w
        if r <= 0:
            return k
    return items[-1][0]


def seed(n: int = 72) -> None:
    assert DB.exists(), f"memory.db missing at {DB} — run `contribai web-server` once to create it"
    random.seed(0xC0DEA1)
    conn = sqlite3.connect(str(DB))
    cur = conn.cursor()

    types = list(TITLES.keys())
    now = datetime.now(timezone.utc)
    inserted = 0

    for i in range(n):
        repo, _lang, _stars = random.choice(REPOS)
        t = random.choice(types)
        title = random.choice(TITLES[t])
        status = weighted(STATUSES)

        age_hours = random.randint(1, 60 * 24)  # up to 60 days
        created = (now - timedelta(hours=age_hours)).isoformat()
        updated = (now - timedelta(hours=max(0, age_hours - random.randint(0, 40)))).isoformat()
        pr_number = 1200 + i + random.randint(0, 4000)
        branch = f"contribai/{t.replace('_', '-')}-{pr_number}"
        fork = f"contribai-bot/{repo.split('/')[-1]}"
        pr_url = f"https://github.com/{repo}/pull/{pr_number}"

        try:
            cur.execute(
                """
                INSERT OR IGNORE INTO submitted_prs
                    (repo, pr_number, pr_url, title, type, status, branch, fork, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (repo, pr_number, pr_url, title, t, status, branch, fork, created, updated),
            )
            if cur.rowcount:
                inserted += 1
        except sqlite3.Error as e:
            print(f"  ! insert failed for {repo}#{pr_number}: {e}")

    # Also seed sessions + run_log so those endpoints show activity
    cur.execute(
        """INSERT OR REPLACE INTO sessions (id, name, mode, status, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        ("ses_nightly", "nightly-hunt", "hunt", "running",
         (now - timedelta(minutes=23)).isoformat()),
    )
    cur.execute(
        """INSERT OR REPLACE INTO sessions (id, name, mode, status, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        ("ses_patrol", "patrol-open-prs", "patrol", "running",
         (now - timedelta(hours=3)).isoformat()),
    )

    # Run log summary entries
    for i in range(8):
        started = now - timedelta(hours=i * 6 + random.randint(0, 3))
        finished = started + timedelta(minutes=4 + random.randint(0, 20))
        cur.execute(
            """INSERT INTO run_log
               (started_at, finished_at, repos_analyzed, prs_created, findings, errors, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                started.isoformat(),
                finished.isoformat(),
                random.randint(2, 7),
                random.randint(0, 3),
                random.randint(4, 18),
                random.randint(0, 2),
                "{}",
            ),
        )

    conn.commit()
    total = cur.execute("SELECT COUNT(*) FROM submitted_prs").fetchone()[0]
    conn.close()
    print(f"inserted={inserted} total_prs_now={total} db={DB}")


if __name__ == "__main__":
    seed(int(os.environ.get("SEED_COUNT", "72")))
