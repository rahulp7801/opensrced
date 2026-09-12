const { writeFile } = require('node:fs/promises');
const { buildGraphWorker } = require('../.worker-build/lib/graph-worker');
const { repo, token, outputPath } = JSON.parse(process.env.OPENSRCER_GRAPH);
delete process.env.OPENSRCER_GRAPH;
if (!/^\/tmp\/opensrcer-graph-[a-f0-9]{32}\.json$/.test(outputPath)) throw new Error('Invalid graph output path');
process.env.OPENSRCER_GRAPH_PYTHON = '/opt/graph/bin/python';
const send = event => process.stdout.write(JSON.stringify(event) + '\n');
buildGraphWorker(repo, token, undefined, message => send({ status: 'progress', message }))
  .then(async result => { await writeFile(outputPath, JSON.stringify(result), { flag: 'wx', mode: 0o600 }); send({ status: 'saved' }); })
  .catch(() => { send({ error: 'Graph build failed or exceeded its limits. Try a smaller repository.' }); process.exitCode = 1; });
