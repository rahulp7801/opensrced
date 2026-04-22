#!/usr/bin/env python3
"""Generate a summary or full dump of a code-review-graph database.

Usage: python crg-summary.py <repo_dir> [--full]
  Without --full: compact summary (top 30 files, 100 sample edges)
  With --full: all files with symbols, all edges (capped at 100K chars)
Output: JSON
"""
import sys, os, json

def main():
    if len(sys.argv) < 2:
        json.dump({"error": "Usage: crg-summary.py <repo_dir> [--full]"}, sys.stdout)
        return

    repo_dir = sys.argv[1]
    full_mode = "--full" in sys.argv

    db_path = os.path.join(repo_dir, ".code-review-graph", "graph.db")
    if not os.path.exists(db_path):
        json.dump({"error": "no_graph"}, sys.stdout)
        return

    try:
        from code_review_graph.graph import GraphStore
        g = GraphStore(db_path)

        all_files = g.get_all_files()
        max_files = len(all_files) if full_mode else 30
        max_symbols_per_file = 100 if full_mode else 20
        max_edges = 500 if full_mode else 100

        # Get files with symbols
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

            file_data.append({
                "file": rel_path,
                "symbols": symbols[:max_symbols_per_file],
                "count": len(nodes),
            })

        file_data.sort(key=lambda x: -x["count"])
        top_files = file_data[:max_files]

        # Edge statistics and samples
        all_edges = g.get_all_edges()
        edge_kinds = {}
        sample_edges = []
        for i, e in enumerate(all_edges):
            kind = getattr(e, 'kind', 'unknown')
            edge_kinds[kind] = edge_kinds.get(kind, 0) + 1
            if i < max_edges:
                src = getattr(e, 'source_qualified', '')
                tgt = getattr(e, 'target_qualified', '')
                if repo_dir in src:
                    src = src[len(repo_dir):].lstrip("/\\").replace("\\", "/")
                if repo_dir in tgt:
                    tgt = tgt[len(repo_dir):].lstrip("/\\").replace("\\", "/")
                if src and tgt:
                    sample_edges.append(f"{src} --[{kind}]--> {tgt}")

        total_nodes = sum(fd["count"] for fd in file_data)

        json.dump({
            "nodes": total_nodes,
            "edges": len(all_edges),
            "files": len(all_files),
            "top_files": top_files,
            "edge_kinds": dict(sorted(edge_kinds.items(), key=lambda x: -x[1])),
            "sample_edges": sample_edges,
            "full": full_mode,
        }, sys.stdout)

    except Exception as e:
        json.dump({"error": str(e)}, sys.stdout)

if __name__ == "__main__":
    main()
