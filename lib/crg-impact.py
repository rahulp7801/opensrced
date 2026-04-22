#!/usr/bin/env python3
"""Blast radius analysis using code-review-graph.

Usage: python crg-impact.py <repo_dir> <file1> [file2 ...]
Output: JSON with impact analysis results.
"""
import sys, os, json

def normalize(p):
    """Normalize a path for comparison: lowercase, forward slashes, strip leading ./"""
    return p.replace("\\", "/").lower().lstrip("./")

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

        # Build a lookup of normalized graph paths -> original paths
        all_files = g.get_all_files()
        repo_dir_norm = normalize(repo_dir)
        file_lookup = {}
        for gf in all_files:
            gf_norm = normalize(gf)
            # Store both the full normalized path and the repo-relative part
            file_lookup[gf_norm] = gf
            # Also store the relative path (strip repo dir prefix)
            if gf_norm.startswith(repo_dir_norm):
                rel = gf_norm[len(repo_dir_norm):].lstrip("/")
                file_lookup[rel] = gf

        # Resolve changed files against the lookup
        resolved = []
        unresolved = []
        for cf in changed_files:
            cf_norm = normalize(cf)
            matched = False

            # Try exact match first
            if cf_norm in file_lookup:
                resolved.append(file_lookup[cf_norm])
                matched = True
            else:
                # Try suffix match — the diff path might be a suffix of the graph path
                for key, val in file_lookup.items():
                    if key.endswith("/" + cf_norm) or key == cf_norm:
                        resolved.append(val)
                        matched = True
                        break

            if not matched:
                # Try matching just the filename as last resort
                cf_basename = cf_norm.rsplit("/", 1)[-1]
                for key, val in file_lookup.items():
                    if key.endswith("/" + cf_basename) or key == cf_basename:
                        resolved.append(val)
                        matched = True
                        break

            if not matched:
                unresolved.append(cf)

        if not resolved:
            json.dump({
                "total_affected": 0,
                "changed_nodes": 0,
                "affected_files": [],
                "affected_labels": [],
                "affected_file_count": 0,
                "detail": f"Changed files not found in graph: {', '.join(unresolved[:5])}",
                "all_graph_files_sample": [normalize(f) for f in all_files[:10]],
            }, sys.stdout)
            return

        # Run impact analysis with higher depth for better coverage
        result = g.get_impact_radius(resolved, max_depth=3, max_nodes=200)

        # Extract useful info
        changed = result.get("changed_nodes", [])
        affected = result.get("impacted_nodes", [])
        total = result.get("total_impacted", len(affected))

        affected_files = set()
        affected_labels = []
        for node in affected:
            if hasattr(node, 'file_path') and node.file_path:
                rel = node.file_path
                if repo_dir in rel:
                    rel = rel[len(repo_dir):].lstrip("/\\")
                affected_files.add(rel)
            if hasattr(node, 'name') and hasattr(node, 'kind') and node.kind != 'File':
                affected_labels.append(f"{node.name} ({node.kind})")

        # Also list changed node details
        changed_labels = []
        for node in changed:
            if hasattr(node, 'name') and hasattr(node, 'kind'):
                changed_labels.append(f"{node.name} ({node.kind})")

        json.dump({
            "total_affected": total,
            "changed_nodes": len(changed),
            "changed_labels": changed_labels[:10],
            "affected_files": list(affected_files)[:20],
            "affected_labels": affected_labels[:15],
            "affected_file_count": len(affected_files),
            "truncated": result.get("truncated", False),
            "resolved_files": len(resolved),
            "unresolved_files": unresolved[:5],
        }, sys.stdout)

    except Exception as e:
        json.dump({"error": str(e), "traceback": __import__('traceback').format_exc()}, sys.stdout)

if __name__ == "__main__":
    main()
