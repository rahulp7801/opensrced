import { classifyScope } from '../lib/scope.ts';
import { execFileSync } from 'node:child_process';

const repo = process.argv[2] ?? 'sofired/grizzle';
const num = process.argv[3] ?? '82';

const raw = execFileSync('gh', [
  'issue', 'view', num, '--repo', repo,
  '--json', 'title,body',
], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
const { title, body } = JSON.parse(raw);
const scope = classifyScope(title, body);
console.log('REPO:', repo, '#' + num);
console.log('TITLE:', title);
console.log('SCOPE:', JSON.stringify(scope, null, 2));
