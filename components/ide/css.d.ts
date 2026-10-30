// next.config.ts loads xterm's stylesheet as its CSS text (see the IDE CSS rule there).
declare module "@xterm/xterm/css/xterm.css" {
  const css: string;
  export default css;
}
