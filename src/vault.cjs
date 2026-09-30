'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
const {StateWriter}=require('./persistence.cjs');
class SecretVault {
  constructor(file,{encryptSecret,decryptSecret}={}) {
    this.file=file;this.encrypt=encryptSecret;this.decrypt=decryptSecret;this.values={};this.warning='';this.tail=Promise.resolve();
    let validPrimary=false;
    for(const candidate of [file,file+'.bak']){
      if(!fs.existsSync(candidate))continue;
      try {if(!this.decrypt)throw Error('OS credential encryption is unavailable.');this.values=JSON.parse(this.decrypt(JSON.parse(fs.readFileSync(candidate,'utf8')).blob));if(!this.values||Array.isArray(this.values)||typeof this.values!=='object')throw Error('Invalid credentials');validPrimary=candidate===file;this.warning=validPrimary?'':'Recovered encrypted credentials from backup.';break;}
      catch {this.warning='Saved sessions or cloud credentials could not be unlocked. Share the session or configure credentials again.';}
    }
    this.writer=new StateWriter(file,validPrimary,error=>{this.warning=error?'Could not save encrypted credentials: '+error.message:'';});
  }
  get(key){return this.values[key];}
  set(key,value,expected){const task=this.tail.then(()=>this.write(key,value,expected));this.tail=task.catch(()=>{});return task;}
  async write(key,value,expected){
    if(expected&&this.values[key]?.[expected.field]!==expected.value)throw Error('The shared session changed. Share it explicitly from the extension again.');
    if(!this.encrypt)throw Error('OS credential encryption is unavailable. Saved browser sessions and cloud keys require Windows DPAPI or macOS Keychain.');
    const next={...this.values};if(value===null)delete next[key];else next[key]=value;
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    this.writer.submit(JSON.stringify({version:1,blob:this.encrypt(JSON.stringify(next))}));
    await this.writer.flush();if(this.warning)throw Error(this.warning);this.values=next;
    if(value===null)await fsp.copyFile(this.file,this.file+'.bak');
    await fsp.chmod(this.file,0o600).catch(()=>{});
  }
  async close(){await this.tail;await this.writer.flush();}
}
module.exports={SecretVault};
