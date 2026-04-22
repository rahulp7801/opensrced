#!/usr/bin/env python3
"""Generate a compact summary of a code-review-graph database for LLM context.

Usage: python crg-summary.py <repo_dir>
Output: JSON with nodes, top files, relationships, communities.
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
        stats = g.get_stats()
        # get_stats returns a dataclass — try accessing fields
        total_nodes = getattr(stats, 'nodes', 0) or getattr(stats, 'node_count', 0)
        total_edges = getattr(stats, 'edges', 0) or getattr(stats, 'edge_count', 0)
        if total_nodes == 0:
            # Try counting directly
            try:
                all_nodes = g.get_all_nodes()
                total_nodes = len(all_nodes)
            except:
                pass
        if total_edges == 0:
            all_edges_list = g.get_all_edges()
            total_edges = len(all_edges_list) if hasattr(all_edges_list, '__len__') else 0

        # Get top files by node count
        all_files = g.get_all_files()
        file_node_counts = []
        for f in all_files[:200]:  # cap for performance
            nodes = g.get_nodes_by_file(f)
            rel_path = f
            if repo_dir in f:
                rel_path = f[len(repo_dir):].lstrip("/\\")
            file_node_counts.append({"file": rel_path, "nodes": len(nodes)})
        file_node_counts.sort(key=lambda x: -x["nodes"])

        # Get some edges for relationship info
        all_edges = g.get_all_edges()
        edge_kinds = {}
        sample_edges = []
        for e in all_edges[:500]:
            kind = e.kind if hasattr(e, 'kind') else str(e)
            edge_kinds[kind] = edge_kinds.get(kind, 0) + 1
            if len(sample_edges) < 20:
                src = e.source_qualified if hasattr(e, 'source_qualified') else str(e)
                tgt = e.target_qualified if hasattr(e, 'target_qualified') else str(e)
                # Make paths relative
                if repo_dir in src:
                    src = src[len(repo_dir):].lstrip("/\\")
                if repo_dir in tgt:
                    tgt = tgt[len(repo_dir):].lstrip("/\\")
                sample_edges.append(f"{src} --[{kind}]--> {tgt}")

        json.dump({
            "nodes": total_nodes,
            "edges": total_edges,
            "files": len(all_files),
            "top_files": file_node_counts[:15],
            "edge_kinds": dict(sorted(edge_kinds.items(), key=lambda x: -x[1])[:10]),
            "sample_edges": sample_edges,
        }, sys.stdout)

    except Exception as e:
        json.dump({"error": str(e)}, sys.stdout)

if __name__ == "__main__":
    main()
