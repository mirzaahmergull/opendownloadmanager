const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const directory = path.join(__dirname, 'fixtures'); fs.mkdirSync(directory, { recursive: true });
const target = path.join(directory, 'sample.mp4');
if (!fs.existsSync(target)) {
  const result = spawnSync(require('../src/platform.cjs').toolPaths(require('../src/platform.cjs').developmentTools(path.resolve(__dirname, '..'))).ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', target], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'FFmpeg is missing. Run the platform tool setup script.');
}
module.exports = target;
