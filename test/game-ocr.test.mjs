import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOcrClient } from './games/ocr-client.mjs';

test('OCR initialization and recognition hangs terminate their child process',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'game-ocr-'));
  try {
    const workerFile=join(dir,'worker.cjs');
    await writeFile(workerFile,`process.on('message',()=>{});`);
    await assert.rejects(createOcrClient({workerFile,cachePath:dir,timeoutMs:300}),error=>/initialize timed out/.test(error.message)&&error.category==='automation'&&error.status==='BLOCKED');
    await writeFile(workerFile,`process.on('message',m=>{if(m.kind==='initialize')process.send({id:m.id,value:true});});`);
    // Allow a real child process to start on a loaded CI worker. The second
    // fake worker still never answers recognition, so the timeout is exercised.
    const client=await createOcrClient({workerFile,cachePath:dir,timeoutMs:3000});
    try {await assert.rejects(client.recognize('unused.png',{}),error=>/recognize timed out/.test(error.message)&&error.category==='automation'&&error.status==='BLOCKED');}
    finally {await client.close();}
    await assert.rejects(client.recognize('unused.png',{}),/already closed/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
