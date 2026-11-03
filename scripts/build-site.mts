// Assembles the Pages site in _site/ from the pages of docs/, as they are.
import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
rmSync(path.join(root, '_site'), { recursive: true, force: true });
cpSync(path.join(root, 'docs'), path.join(root, '_site'), { recursive: true });
process.stdout.write('Assembled _site from docs/.\n');
