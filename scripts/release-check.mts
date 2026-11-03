// Fails unless the tag given agrees with package.json, package-lock.json and
// CHANGELOG.md. The release workflow runs it before building:
//   npm run release:check -- v1.0.0-alpha.0.5.0
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { releaseProblems } from './lib/release-rules.mts';

const root = path.resolve(import.meta.dirname, '..');
const tag = process.argv[2] ?? '';
const read = (name: string): string => readFileSync(path.join(root, name), 'utf8');
const problems = releaseProblems(tag, { packageJson: read('package.json'), packageLock: read('package-lock.json'), changelog: read('CHANGELOG.md') });
if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem);
  }
  process.exitCode = 1;
} else {
  console.log(`${tag} agrees with package.json, package-lock.json and CHANGELOG.md.`);
}
