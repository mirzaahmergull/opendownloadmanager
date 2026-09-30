const fs=require('node:fs/promises');
// Serialize durable disk transactions off the main thread; coalesce waiting checkpoints.
class StateWriter {
  constructor(file,validPrimary,onResult){this.file=file;this.validPrimary=validPrimary;this.onResult=onResult;this.latest=undefined;this.pending=null;}
  submit(value){this.latest=value;if(!this.pending)this.pending=this.drain().finally(()=>{this.pending=null;});}
  async drain(){while(this.latest!==undefined){const value=this.latest;this.latest=undefined;try{
    await fs.writeFile(this.file+'.tmp',value,{flush:true});
    if(this.validPrimary){try{await fs.copyFile(this.file,this.file+'.bak.tmp');await fs.rename(this.file+'.bak.tmp',this.file+'.bak');}catch(error){if(error.code!=='ENOENT')throw error;}}
    await fs.rename(this.file+'.tmp',this.file);this.validPrimary=true;this.onResult(null);
  }catch(error){this.onResult(error);}}}
  async flush(){while(this.pending)await this.pending;}
}
module.exports={StateWriter};
