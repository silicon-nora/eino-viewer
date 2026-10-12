import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRunRecordV2 } from '../protocol/v2/validate.js';

const root = new URL('../', import.meta.url);
const work = mkdtempSync(join(tmpdir(), 'eino-v2-roundtrip-'));
try {
  const executable = join(work, process.platform === 'win32' ? 'roundtrip.exe' : 'roundtrip');
  execFileSync('go', ['build', '-o', executable, './protocolv2/cmd/roundtrip'], { cwd: fileURLToPath(new URL('integrations/go/', root)), stdio: 'inherit' });
  const directory = new URL('protocol/v2/fixtures/', root);
  const files = readdirSync(directory).filter(f => f.endsWith('.json')).sort();
  assert.ok(files.length, 'Missing contract fixtures');
  for (const file of files) {
    const input = readFileSync(new URL(file, directory), 'utf8');
    const output = execFileSync(executable, [], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.deepEqual(parseRunRecordV2(output), parseRunRecordV2(input), `${file}: Go changed contract facts`);
  }
  console.log(`${files.length} fixtures: JSON → Go → JSON → schema/semantic validation passed.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
