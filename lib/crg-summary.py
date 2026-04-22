#!/usr/bin/env python3
"""Generate a compact but informative summary of a code-review-graph database.

Designed for LLM context on general questions — includes top files with
symbols and key edges, but not the full dump (that would blow up tokens).
File-specific queries are handled by crg-impact.py directly.

Usage: python crg-summary.py <repo_dir>
Output: JSON
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

        # Get top 30 files by symbol count
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
                "symbols": symbols[:20],
                "count": len(nodes),
            })

        file_data.sort(key=lambda x: -x["count"])
        top_files = file_data[:30]

        # Edge statistics
        all_edges = g.get_all_edges()
        edge_kinds = {}
        sample_edges = []
        for e in all_edges[:100]:
            kind = getattr(e, 'kind', 'unknown')
            edge_kinds[kind] = edge_kinds.get(kind, 0) + 1
            src = getattr(e, 'source_qualified', '')
            tgt = getattr(e, 'target_qualified', '')
            if repo_dir in src:
                src = src[len(repo_dir):].lstrip("/\\").replace("\\", "/")
            if repo_dir in tgt:
                tgt = tgt[len(repo_dir):].lstrip("/\\").replace("\\", "/")
            if src and tgt:
                sample_edges.append(f"{src} --[{kind}]--> {tgt}")

        # Count full edges
        for e in all_edges[100:]:
            kind = getattr(e, 'kind', 'unknown')
            edge_kinds[kind] = edge_kinds.get(kind, 0) + 1

        total_nodes = sum(fd["count"] for fd in file_data)

        json.dump({
            "nodes": total_nodes,
            "edges": len(all_edges),
            "files": len(all_files),
            "top_files": top_files,
            "edge_kinds": dict(sorted(edge_kinds.items(), key=lambda x: -x[1])),
            "sample_edges": sample_edges,
        }, sys.stdout)

    except Exception as e:
        json.dump({"error": str(e)}, sys.stdout)

if __name__ == "__main__":
    main()
