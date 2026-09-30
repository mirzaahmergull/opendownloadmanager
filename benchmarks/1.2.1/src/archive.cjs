const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {safeRelative}=require('./advanced.cjs');
function passwordArg(password){if(typeof password!=='string'||password.length>500||/[\r\n\0]/.test(password))throw Error('Invalid archive password.');return '-p'+(password || '-');}
function parseListing(text){
  const entries=[],names=new Set();let size=0,count=0;
  for(const block of text.trim().split(/\r?\n\r?\n/)){
    const values=Object.fromEntries(block.split(/\r?\n/).map(l=>{const n=l.indexOf(' = ');return n<0?null:[l.slice(0,n),l.slice(n+3)];}).filter(Boolean));
    if(!values.Path)continue;
    const relative=safeRelative(values.Path.replace(/[\\/]$/,'')),key=relative.replace(/\\/g,'/').toLowerCase();
    if(names.has(key))throw Error('Archive contains duplicate output paths.');names.add(key);
    if(['Symbolic Link','Hard Link','Alternate Stream','Reparse Point'].some(k=>k in values)||/\bl[rwx-]{9}\b|\bL\b/.test(values.Attributes||''))throw Error('Archive contains a link or special file.');
    const entrySize=Number(values.Size||0),compressed=Number(values['Packed Size']||0);
    if(!Number.isSafeInteger(entrySize)||entrySize<0||!Number.isSafeInteger(compressed)||compressed<0)throw Error('Archive contains an invalid entry size.');
    size+=entrySize;if(++count>10000||size>20*1024**3)throw Error('Archive exceeds 10,000 entries or 20 GB uncompressed.');
    if(values.Folder==='+'||/^D/.test(values.Attributes||''))continue;
    entries.push({name:values.Path,size:entrySize,compressed,encrypted:values.Encrypted==='+'});
  }
  return entries;
}
async function listArchive(engine,file,password=''){const exe=require('./platform.cjs').toolPaths(engine.toolsDir).archive;const text=await engine.capture(exe,['l','-slt','-ba','-sccUTF-8',passwordArg(password),'--',file],60000);return parseListing(text);}
async function extractArchive(engine,file,destination,selected,password=''){
  const entries=await listArchive(engine,file,password);const names=selected || entries.map(e=>e.name);if(!names.length||names.some(n=>!entries.some(e=>e.name===n)))throw Error('Select valid archive entries.');
  await fs.mkdir(destination,{recursive:false});const listFile=path.join(engine.tempDir,'archive-list-'+crypto.randomUUID()+'.txt');
  try{await fs.writeFile(listFile,names.join('\n'),'utf8');await engine.capture(require('./platform.cjs').toolPaths(engine.toolsDir).archive,['x','-y','-aos','-spd','-scsUTF-8','-sccUTF-8',passwordArg(password),'-o'+destination,'-i@'+listFile,'--',file],30*60000);return names.map(n=>path.join(destination,safeRelative(n)));}
  catch(err){err.message+=` Partial extraction remains at ${destination}.`;throw err;}
  finally{await fs.rm(listFile,{force:true});}
}
module.exports={listArchive,extractArchive,parseListing};
