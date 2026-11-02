// A small code graph for the project-map tests: two areas big enough to count
// (src/app: 12 nodes in src/app/core.py, src/web: 10 in src/web/views.py) and
// one too small (2 nodes in tools/run.py). app0 calls web0, app0..app11 chain.
import type { GraphData, GraphNode } from "../../graph";

const node = (id: string, label: string, community: number, file: string): GraphNode =>
  ({ id, label, community, file_type: "code", source_file: file });

export function mapGraph(): GraphData {
  const nodes: GraphNode[] = [
    ...Array.from({ length: 12 }, (_, i) => node(`app${i}`, i === 0 ? "Session" : `app_fn${i}`, 0, "src/app/core.py")),
    ...Array.from({ length: 10 }, (_, i) => node(`web${i}`, i === 0 ? "render_page" : `web_fn${i}`, 1, "src/web/views.py")),
    node("tool0", "run_tool", 2, "tools/run.py"), node("tool1", "go", 2, "tools/run.py"),
  ];
  const edge = (source: string, target: string) => ({ source, target, relation: "calls", confidence: "EXTRACTED", confidence_score: 1, source_file: "" });
  return { nodes, links: [edge("app0", "web0"), ...Array.from({ length: 11 }, (_, i) => edge(`app${i}`, `app${i + 1}`))] };
}
