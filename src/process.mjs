import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Never include child stdout/stderr in errors: either can contain account data.
export function run(executable, args, {env=process.env, cwd, timeout=30000, input, limit=2*1024*1024}={}) {
  return new Promise((resolve,reject) => {
    const child = spawn(executable,args,{env,cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='', stderr='', timedOut=false, tooLarge=false;
    const timer=setTimeout(() => {timedOut=true; child.kill();},timeout);
    child.stdout.on('data', b => {if(stdout.length+b.length<=limit) stdout+=b; else {tooLarge=true; child.kill();}});
    child.stderr.on('data', b => {if(stderr.length+b.length<=limit) stderr+=b; else {tooLarge=true; child.kill();}});
    child.on('error', () => {clearTimeout(timer); reject(new Error('Could not start required executable.'));});
    child.on('close', code => {clearTimeout(timer); resolve({code,stdout,stderr,timedOut,tooLarge});});
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}

export class Rpc {
  constructor(binary,{env=process.env,cwd,args=[]}={}) {
    this.next=0; this.pending=new Map(); this.closed=false;
    this.child=spawn(binary,[...args,'app-server','--strict-config','--stdio'],{env,cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child.stderr.on('data',()=>{});
    this.child.stdin.on('error',()=>{});
    this.lines=createInterface({input:this.child.stdout});
    this.lines.on('line',line=>{
      let message; try {message=JSON.parse(line);} catch {return;}
      const pending=this.pending.get(message.id);
      if(pending) {
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if(message.error) pending.reject(new Error(`Codex rejected ${pending.method}.`)); else pending.resolve(message.result);
      } else if(message.id!==undefined && message.method) {
        this.child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'Interactive requests disabled in diagnostic'}})+'\n');
      }
    });
    const fail=()=>{
      this.closed=true;
      for(const p of this.pending.values()) {clearTimeout(p.timer);p.reject(new Error('Diagnostic app-server stopped.'));}
      this.pending.clear();
    };
    this.child.on('error',fail);this.child.on('close',fail);
  }
  send(method,params,timeout=30000) {
    if(this.closed) return Promise.reject(new Error('Diagnostic app-server unavailable.'));
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Timed out: ${method}`));},timeout);
      this.pending.set(id,{resolve,reject,timer,method});
      this.child.stdin.write(JSON.stringify({id,method,params})+'\n');
    });
  }
  async init() {
    await this.send('initialize',{clientInfo:{name:'codex_http_relay_check',version:'0.1.0'},capabilities:{experimentalApi:true}});
    this.child.stdin.write('{"method":"initialized"}\n');
  }
  close() {this.lines.close();this.child.kill();}
}
