import { createWorker } from 'tesseract.js';

// OCR lives in its own process so a stalled model download/recognition can be
// terminated without leaving the suite waiting on an inaccessible worker.
let worker;
process.on('message', async message => {
  try {
    if (message.kind === 'initialize') {
      worker = await createWorker('eng', 1, {cachePath:message.cachePath,
        ...(message.langPath ? {langPath:message.langPath} : {})});
      await worker.setParameters({tessedit_pageseg_mode:'7'});
      process.send({id:message.id,value:true});
    } else if (message.kind === 'recognize') {
      const {data}=await worker.recognize(message.path,{rectangle:message.rectangle});
      process.send({id:message.id,value:{text:data.text,confidence:data.confidence}});
    }
  } catch(error) {process.send({id:message.id,error:error.message});}
});
