import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseRunRecordV2, validateRunRecordV2 } from '../../src/run-record-v2.js';
export { parseRunRecordV2, validateRunRecordV2, runRecordSchema, cloudFocusSchema } from '../../src/run-record-v2.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2);
  if (!paths.length) { console.error('Usage: node protocol/v2/validate.js <record.json> [...]'); process.exitCode = 2; }
  for (const path of paths) {
    try {
      const record = parseRunRecordV2(readFileSync(path, 'utf8'));
      const { warnings } = validateRunRecordV2(record);
      console.log(`${path}: valid${warnings.length ? ` (${warnings.length} warning(s))` : ''}`);
    } catch (error) { console.error(`${path}: ${error.message}`); process.exitCode = 1; }
  }
}
