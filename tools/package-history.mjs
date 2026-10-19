import {mkdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
// Release resources belong beside the installer, never inside the forecast.
const destination=resolve('.tibo/bin/history');
await mkdir(destination,{recursive:true});
await copyFile('data/history/ledger.json',resolve(destination,'ledger.json'));
console.log('Packaged installation history sidecar.');
