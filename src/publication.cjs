const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function publishFile(engine,job,source,signal) {
  const staging=path.join(job.directory,`.odm-${crypto.randomUUID()}.partial`);
  let published='';
  try {
    try{await fsp.link(source,staging);}catch(error){if(!['EPERM','ENOTSUP','EOPNOTSUPP','EXDEV','ENOSYS'].includes(error.code))throw error;await fsp.copyFile(source,staging,fs.constants.COPYFILE_EXCL);}
    signal?.throwIfAborted();
    for(let attempt=0;attempt<100;attempt++) {
      const output=engine.uniqueOutput(job);
      try {
        try { await fsp.link(staging,output); }
        catch(error) {
          if(!['EPERM','ENOTSUP','EOPNOTSUPP','EXDEV','ENOSYS'].includes(error.code))throw error;
          const reservation=await fsp.open(output,'wx');
          try { await reservation.close();await fsp.rename(staging,output); } catch(failure){await reservation.close().catch(()=>{});await fsp.rm(output,{force:true}).catch(()=>{});throw failure;}
        }
        published=output;signal?.throwIfAborted();return output;
      } catch(error) { if(error.code==='EEXIST'){job.output='';continue;}throw error; }
    }
    throw Error('Could not reserve an unused output name. Choose a different file name.');
  } catch(error) {
    if(published)await fsp.rm(published,{force:true}).catch(()=>{});
    job.output='';throw error;
  } finally { await fsp.rm(staging,{force:true}).catch(error=>{job.cleanupWarning=`Could not remove publication staging data: ${error.message}`;}); }
}
async function cleanupTemp(engine,job) {
  try { await fsp.rm(engine.jobTemp(job.id),{recursive:true,force:true}); }
  catch(error) { job.cleanupWarning=`Download completed; temporary files could not be removed: ${error.message}`; }
}
module.exports={publishFile,cleanupTemp};
