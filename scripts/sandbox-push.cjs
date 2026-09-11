const { pushPrPatch } = require('../.worker-build/lib/pr-push');
const { input, token } = JSON.parse(process.env.OPENSRCER_PUSH);
delete process.env.OPENSRCER_PUSH;
pushPrPatch(input, token).then(result => process.stdout.write(JSON.stringify(result)))
  .catch(() => { process.stdout.write(JSON.stringify({ error: 'Push failed. Check repository permissions, secret scanning, and whether the branch changed.' })); process.exitCode = 1; });
