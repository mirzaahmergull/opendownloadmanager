'use strict';
function shouldNotify(mode,event){return mode==='all'||mode==='errors'&&event!=='complete';}
class NotificationGate {
  constructor(show,{mode=()=> 'errors',now=Date.now}={}){this.show=show;this.mode=mode;this.now=now;this.last=new Map();}
  send(event,input){if(!shouldNotify(this.mode(),event))return false;const key=input.key||event+':'+input.jobId;if(event!=='complete'&&this.now()-(this.last.get(key)??-Infinity)<5*60000)return false;this.last.set(key,this.now());if(this.last.size>500){const cutoff=this.now()-5*60000;for(const [id,time]of this.last)if(time<cutoff)this.last.delete(id);}this.show(input);return true;}
}
module.exports={shouldNotify,NotificationGate};
