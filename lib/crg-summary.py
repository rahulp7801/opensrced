#!/usr/bin/env python3
"""Generate a full context dump of a code-review-graph database for LLM.

Usage: python crg-summary.py <repo_dir>
Output: JSON with all nodes grouped by file, all edge types, full structure.
"""
import sys, os, json

def main():
    if len(sys.argv) < 2:
        json.dump({"error": "Usage: crg-summary.py <repo_dir>"}, sys.stdout)
        return

    repo_dir = sys.argv[1]
    db_path = os.path.join(repo_dir, ".code-review-graph", "graph.db")
    if not os.path.exists(db_path):
        json.dump({"error": "no_graph"}, sys.stdout)
        return

    try:
        from code_review_graph.graph import GraphStore
        g = GraphStore(db_path)

        all_files = g.get_all_files()

        # Build full node listing grouped by file
        file_data = []
        for f in all_files:
            nodes = g.get_nodes_by_file(f)
            rel_path = f
            if repo_dir in f:
                rel_path = f[len(repo_dir):].lstrip("/\\").replace("\\", "/")

            symbols = []
            for n in nodes:
                if n.kind != 'File':
                    symbols.append(f"{n.name} ({n.kind})")

            if symbols:
                file_data.append({
                    "file": rel_path,
                    "symbols": symbols[:50],  # cap per file
                    "count": len(nodes),
                })

        # Sort by symbol count descending
        file_data.sort(key=lambda x: -x["count"])

        # Get edge statistics
        all_edges = g.get_all_edges()
        edge_kinds = {}
        sample_edges = []
        for e in all_edges:
            kind = e.kind if hasattr(e, 'kind') else "unknown"
            edge_kinds[kind] = edge_kinds.get(kind, 0) + 1

        # Get sample edges with readable names
        for e in all_edges[:200]:
            src = getattr(e, 'source_qualified', '') or ''
            tgt = getattr(e, 'target_qualified', '') or ''
            kind = getattr(e, 'kind', '') or ''
            # Make relative
            if repo_dir in src:
                src = src[len(repo_dir):].lstrip("/\\").replace("\\", "/")
            if repo_dir in tgt:
                tgt = tgt[len(repo_dir):].lstrip("/\\").replace("\\", "/")
            if src and tgt:
                sample_edges.append(f"{src} --[{kind}]--> {tgt}")

        # Count totals
        total_nodes = sum(fd["count"] for fd in file_data)

        json.dump({
            "nodes": total_nodes,
            "edges": len(all_edges),
            "files": len(all_files),
            "file_data": file_data[:100],  # top 100 files
            "edge_kinds": dict(sorted(edge_kinds.items(), key=lambda x: -x[1])),
            "sample_edges": sample_edges,
        }, sys.stdout)

    except Exception as e:
        json.dump({"error": str(e)}, sys.stdout)

if __name__ == "__main__":
    main()
