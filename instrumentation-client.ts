// Vercel BotID (Basic, free on every plan): an invisible challenge the browser solves and
// attaches to these requests; the route checks it with checkBotId(). Only the public
// write needs it: everything else is behind sign-in and the invite list.
import { initBotId } from "botid/client/core";

initBotId({
  protect: [{ path: "/api/interest", method: "POST" }],
});
