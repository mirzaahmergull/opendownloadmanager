const fs = require('node:fs');
function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Saved state must be an object.');
  if (value.settings !== undefined && (!value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings))) throw Error('Invalid saved settings.');
  for (const key of ['jobs', 'queues', 'categories', 'inbox', 'rules', 'subscriptions','batches','cloudProfiles']) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(item => !item || typeof item !== 'object' || Array.isArray(item)))) throw Error(`Invalid saved ${key}.`);
  }
  if (value.queues?.length === 0 || value.categories?.length === 0) throw Error('Saved queues and categories cannot be empty.');
  const ids = new Set();
  for (const job of value.jobs || []) {
    if (typeof job.id !== 'string' || !/^[a-f0-9-]{36}$/.test(job.id) || ids.has(job.id)) throw Error('Invalid or duplicate saved download ID.');
    ids.add(job.id);
    if (typeof job.url !== 'string' || typeof job.filename !== 'string' || typeof job.directory !== 'string' || !Array.isArray(job.segments)) throw Error('Invalid saved download fields.');
    if (!['paused','queued','probing','downloading','assembling','complete','error','uploading'].includes(job.status)) throw Error('Invalid saved download status.');
  }
  for (const category of value.categories || []) if (typeof category.name !== 'string' || !Array.isArray(category.extensions)) throw Error('Invalid saved category.');
  for (const queue of value.queues || []) if (typeof queue.name !== 'string' || !queue.name.trim()) throw Error('Invalid saved queue.');
  for (const sub of value.subscriptions || []) if (!Array.isArray(sub.seen) || !Number.isFinite(sub.interval) || sub.interval < 15) throw Error('Invalid saved subscription.');
  for(const batch of value.batches||[])if(typeof batch.id!=='string'||typeof batch.directory!=='string'||typeof batch.queue!=='string'||!Array.isArray(batch.playlists)||batch.playlists.some(p=>!p||typeof p.id!=='string'||typeof p.url!=='string'))throw Error('Invalid saved video batch.');
  return value;
}
function readState(file) { return validateState(JSON.parse(fs.readFileSync(file, 'utf8'))); }
function loadState(file) {
  let original;
  try { return { state: readState(file), validPrimary: true }; }
  catch (error) {
    original = error;
    if (error.code === 'ENOENT') { try { return { state: readState(file+'.bak'), validPrimary: false, warning: 'Recovered download history from the last saved backup.' }; } catch { return { validPrimary: false }; } }
  }
  const recovery = file + `.unreadable-${Date.now()}`;
  let preserved = false;
  try { fs.copyFileSync(file, recovery); preserved = true; } catch {}
  try { return { state: readState(file+'.bak'), validPrimary: false, blocked: !preserved, warning: `Recovered download history from backup. ${preserved ? 'The unreadable file was retained at '+recovery+'.' : 'The unreadable primary file could not be copied; saving is blocked.'}` }; }
  catch { return { validPrimary: false, blocked: !preserved, warning: `Saved history could not be loaded: ${original.message}. ${preserved ? 'A recovery copy is at '+recovery+'.' : 'Saving is blocked to preserve the unreadable file.'}` }; }
}
module.exports = { validateState, readState, loadState };
