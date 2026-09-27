import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopBrowserProcess } from './transport.mjs';

export async function createOcrClient({cachePath,langPath,timeoutMs=30000,workerFile=fileURLToPath(new URL('./ocr-worker.mjs',import.meta.url))}) {
  const child=fork(workerFile,[],{execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
  const pending=new Map(); let sequence=0; let closed=false; let closing;
  let diagnostics='';
  child.stderr.on('data',data=>{diagnostics=(diagnostics+data).slice(-2000);});
  const failAll=error=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();};
  child.on('error',failAll);
  child.on('exit',()=>{closed=true;failAll(Error(`OCR process exited: ${diagnostics}`));});
  child.on('message',message=>{
    const item=pending.get(message.id); if(!item)return;
    clearTimeout(item.timer);pending.delete(message.id);
    if(message.error)item.reject(Error(message.error));else item.resolve(message.value);
  });
  const close=()=>closing??=(async()=>{
    closed=true;failAll(Error('OCR observer closed'));
    await stopBrowserProcess(child,{graceMs:500,killMs:1000});
  })();
  const request=payload=>new Promise((resolve,reject)=>{
    if(closed){reject(Error('OCR observer already closed'));return;}
    const id=++sequence;
    const timer=setTimeout(()=>{
      pending.delete(id);reject(Error(`OCR ${payload.kind} timed out after ${timeoutMs} ms`));
      close().catch(()=>{});
    },timeoutMs);
    pending.set(id,{resolve,reject,timer});
    child.send({...payload,id},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
  });
  try {await request({kind:'initialize',cachePath,langPath});}
  catch(error){await close();throw Object.assign(error,{category:'automation',status:'BLOCKED'});}
  return {recognize:(path,rectangle)=>request({kind:'recognize',path,rectangle}).catch(error=>{throw Object.assign(error,{category:'automation',status:'BLOCKED'});}),close};
}
