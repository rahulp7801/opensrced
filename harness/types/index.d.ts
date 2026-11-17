// The lesson map the plugin's MCP server writes (harness/graph.mjs
// lessonMapData) and the pane draws (hooks/register.tsx).

export type MapLevel = "unseen" | "explored" | "changed";
export type MapCommunity = { label: string; count: number; level: MapLevel; x: number; y: number; r: number };
export type LessonMap = {
  lesson: string;
  stage: string;
  title: string;
  communities: MapCommunity[];
  edges: Array<[number, number, number]>;
  explored: string[];
  changed: string[];
  svg: string;
  /** The VS Code extension's map tab is open and shows this map (harness/server.mjs mapTabOpen). */
  tabOpen?: boolean;
};

declare module "claude-code" {
  interface PluginState {
    opensrcer: { map: Shaped<LessonMap | null> };
  }
}
