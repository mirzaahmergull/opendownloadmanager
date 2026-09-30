const path=require('node:path');
function toolPaths(directory,platform=process.platform){return {ytdlp:path.join(directory,platform==='win32'?'yt-dlp.exe':'yt-dlp'),ffmpeg:path.join(directory,platform==='win32'?'ffmpeg.exe':'ffmpeg'),ffprobe:path.join(directory,platform==='win32'?'ffprobe.exe':'ffprobe'),archive:path.join(directory,platform==='win32'?'7z.exe':'7zz')};}
function developmentTools(root,platform=process.platform,arch=process.arch){return platform==='darwin'?path.join(root,'tools-macos',arch):path.join(root,'tools');}
module.exports={toolPaths,developmentTools};
