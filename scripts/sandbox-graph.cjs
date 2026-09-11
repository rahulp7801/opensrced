const { writeFile } = require('node:fs/promises');
const { buildGraphWorker } = require('../.worker-build/lib/graph-worker');
const { repo, token } = JSON.parse(process.env.OPENSRCER_GRAPH);
delete process.env.OPENSRCER_GRAPH;
process.env.OPENSRCER_GRAPH_PYTHON = '/opt/graph/bin/python';
const send = event => process.stdout.write(JSON.stringify(event) + '\n');
buildGraphWorker(repo, token, undefined, message => send({ status: 'progress', message }))
  .then(async result => { await writeFile('/tmp/opensrcer-graph.json', JSON.stringify(result)); send({ status: 'saved' }); })
  .catch(() => { send({ error: 'Graph build failed or exceeded its limits. Try a smaller repository.' }); process.exitCode = 1; });
