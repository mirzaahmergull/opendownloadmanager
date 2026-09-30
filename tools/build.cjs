const { spawn } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env, ELECTRON_BUILDER_COMPRESSION_LEVEL: process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL || '4' };
const child = spawn(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'portable', '--x64', ...process.argv.slice(2)], { cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
