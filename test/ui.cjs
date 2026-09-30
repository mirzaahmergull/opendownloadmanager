const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'odm-ui-'));
  const artifacts = path.join(__dirname, '..', 'test-results'); await fs.mkdir(artifacts, { recursive: true });
  const payload = Buffer.alloc(1024 * 1024, 71);
  const server = http.createServer((req, res) => { const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || ''); const start = m ? +m[1] : 0, end = m ? +m[2] : payload.length - 1; const part = payload.subarray(start, end + 1); res.writeHead(m ? 206 : 200, { 'Content-Length': part.length, 'Content-Type': 'application/zip', ETag: '"ui-test"', ...(m ? { 'Content-Range': `bytes ${start}-${end}/${payload.length}` } : {}) }); res.end(part); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, ODM_TEST_DATA: dataDir, ODM_TEST_PORT: '0' }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ ...(process.env.ODM_TEST_EXE ? { executablePath: process.env.ODM_TEST_EXE, args: [] } : { args: [path.join(__dirname, '..')] }), env });
    const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#empty-state b'); await page.waitForFunction(() => !!window.odm);
    await page.screenshot({ path: path.join(artifacts, '01-main-empty.png') });
    await page.click('[data-action="add"]'); await page.fill('#add-url', `http://127.0.0.1:${server.address().port}/example.zip`);
    await page.fill('#add-folder', path.join(dataDir, 'downloads')); await page.click('#start-download');
    await page.waitForFunction(()=>document.querySelector('#rows')?.textContent.includes('Complete'));await page.locator('#rows [data-id]').first().dblclick();await page.waitForSelector('#progress-content');
    await page.screenshot({ path: path.join(artifacts, '02-download-complete.png') });
    assert.deepEqual(await fs.readFile(path.join(dataDir, 'downloads', 'example.zip')), payload);
    await page.click('#dialog-close'); await page.screenshot({ path: path.join(artifacts, '03-main-complete.png') });
    await page.click('[data-action="options"]'); await page.click('[data-tab="Connection"]'); await page.fill('#opt-concurrent', '3'); await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.screenshot({ path: path.join(artifacts, '04-options.png') }); await page.click('#dialog-close');
    const settings = await page.evaluate(() => window.odm.invoke('snapshot')); assert.equal(settings.settings.concurrent, 3);
    await page.click('[data-action="options"]'); await page.click('[data-tab="Connection"]'); await page.fill('#opt-concurrent', '7'); await page.click('[data-tab="General"]'); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await page.evaluate(() => window.odm.invoke('snapshot'))).settings.concurrent, 3);
    await page.locator('[data-filter="Documents"]').click({ button: 'right' }); await page.locator('#context-menu [data-command="newCategory"]').click(); await page.fill('#category-name', 'Design'); await page.fill('#category-types', 'svg psd ai'); await page.getByRole('button', { name: 'Save', exact: true }).click();
    try { await page.waitForSelector('[data-filter="Design"]'); }
    catch (error) { console.log('Category failure state:', (await page.evaluate(() => window.odm.invoke('snapshot'))).categories); console.log('Toast:', await page.locator('#toast').textContent()); await page.screenshot({ path: path.join(artifacts, 'category-failure.png') }); throw error; }
    await page.locator('[data-filter="all"]').click();
    await page.click('[data-action="scheduler"]'); await page.screenshot({ path: path.join(artifacts, '05-scheduler.png') }); await page.click('#dialog-close');
    await page.click('[data-action="browser"]'); await page.waitForSelector('#pair-token'); assert.equal((await page.inputValue('#pair-token')).length, 64); await page.screenshot({ path: path.join(artifacts, '06-integration.png') }); await page.click('#dialog-close');
    const integration = await page.evaluate(() => window.odm.invoke('integration')); if (process.env.ODM_TEST_EXE) assert.ok(integration.extensionPath.startsWith(dataDir));
    await page.fill('#search', 'does-not-exist'); await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===0); assert.equal(await page.locator('#rows tr').count(), 0); await page.click('#clear-search'); assert.equal(await page.locator('#rows tr').count(), 1);
    await page.locator('#rows tr').click({ button: 'right' }); await page.locator('#context-menu [data-command="properties"]').click(); await page.fill('#prop-description', 'Verified by UI automation'); await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.click('[data-action="remove"]'); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.equal(await page.locator('#rows tr').count(), 1);
    await page.click('[data-action="remove"]'); await page.locator('#dialog-footer').getByRole('button', { name: 'Delete', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('#rows tr').length === 0); assert.deepEqual(await fs.readFile(path.join(dataDir, 'downloads', 'example.zip')), payload);
    assert.deepEqual(errors, []); console.log('PASS: desktop launch, real download, integrity, progress dialog, options persistence/cancel, custom categories, scheduler, pairing, search, properties, delete/cancel, no renderer errors.');
  } finally { await app?.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); await fs.rm(dataDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
