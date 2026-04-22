#!/usr/bin/env python3
"""Blast radius analysis using code-review-graph.

Usage: python crg-impact.py <repo_dir> <file1> [file2 ...]
Output: JSON with impact analysis results.
"""
import sys, os, json

def main():
    if len(sys.argv) < 3:
        json.dump({"error": "Usage: crg-impact.py <repo_dir> <file1> [file2 ...]"}, sys.stdout)
        return

    repo_dir = sys.argv[1]
    changed_files = sys.argv[2:]

    db_path = os.path.join(repo_dir, ".code-review-graph", "graph.db")
    if not os.path.exists(db_path):
        json.dump({"error": "no_graph", "detail": "code-review-graph database not found"}, sys.stdout)
        return

    try:
        from code_review_graph.graph import GraphStore
        g = GraphStore(db_path)

        # Resolve file paths to absolute paths matching the graph
        all_files = g.get_all_files()
        resolved = []
        for cf in changed_files:
            cf_norm = cf.replace("\\", "/").lower()
            for gf in all_files:
                gf_norm = gf.replace("\\", "/").lower()
                if gf_norm.endswith(cf_norm) or cf_norm.endswith(gf_norm.split("/")[-1]):
                    resolved.append(gf)
                    break

        if not resolved:
            json.dump({
                "total_affected": 0,
                "changed_nodes": 0,
                "affected_files": [],
                "detail": "Changed files not found in graph"
            }, sys.stdout)
            return

        result = g.get_impact_radius(resolved, max_depth=2, max_nodes=100)

        # Extract useful info
        changed = result.get("changed_nodes", [])
        affected = result.get("impacted_nodes", [])
        total = result.get("total_impacted", len(affected))

        affected_files = set()
        affected_labels = []
        for node in affected:
            if hasattr(node, 'file_path'):
                # Make path relative
                rel = node.file_path
                if repo_dir in rel:
                    rel = rel[len(repo_dir):].lstrip("/\\")
                affected_files.add(rel)
            if hasattr(node, 'name') and node.kind != 'File':
                affected_labels.append(f"{node.name} ({node.kind})")

        json.dump({
            "total_affected": total,
            "changed_nodes": len(changed),
            "affected_files": list(affected_files)[:20],
            "affected_labels": affected_labels[:15],
            "affected_file_count": len(affected_files),
            "truncated": result.get("truncated", False),
        }, sys.stdout)

    except Exception as e:
        json.dump({"error": str(e)}, sys.stdout)

if __name__ == "__main__":
    main()
