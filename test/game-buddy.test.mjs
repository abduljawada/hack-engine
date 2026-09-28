import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBuddyCash,buddyCashInterval} from './games/buddy-live.mjs';
test('Buddy cash OCR accepts clear rendered cents and rejects uncertain or malformed numbers',()=>{
  assert.equal(parseBuddyCash({text:'$1,000.07 - Open Hand\n',confidence:93}),100007);
  for(const text of ['$1O.00 - Open Hand','$1.2 - Open Hand','1.00 - Open Hand','$-2.00 - Open Hand'])assert.throws(()=>parseBuddyCash({text,confidence:99}));
  assert.throws(()=>parseBuddyCash({text:'$1.94 - Open Hand',confidence:84}));
});
test('Buddy scan intervals follow independently observed truncated cents',()=>{
  const [min,max]=buddyCashInterval(262);
  assert.ok(min<=2.625000000000001&&max>2.625000000000001);
  assert.ok(min>2.61&&max<2.64);
  assert.throws(()=>buddyCashInterval(-1));assert.throws(()=>buddyCashInterval(2.5));
});

test('Buddy uses independent standard cash-word confidence, rejecting ambiguity and crop boundaries',()=>{
  const money={text:'$0.30',confidence:93,bbox:{x0:33,y0:751,x1:102,y1:774}};
  const reading={text:'$0.30 - Open Hand !',confidence:75,words:[money,{text:'!',confidence:0}]};
  assert.equal(parseBuddyCash(reading),30);
  for(const changes of [{confidence:84},{confidence:undefined},{bbox:undefined},{bbox:{x0:33,y0:NaN,x1:102,y1:774}},{bbox:{x0:102,y0:751,x1:33,y1:774}},{text:'$O.30'},{bbox:{...money.bbox,x1:384}}])
    assert.throws(()=>parseBuddyCash({...reading,confidence:99,words:[{...money,...changes}]}));
  assert.throws(()=>parseBuddyCash({...reading,words:[money,money]}));
  assert.throws(()=>parseBuddyCash({...reading,words:[]}));
  assert.throws(()=>parseBuddyCash({...reading,words:[{text:'?',confidence:99},money]}));
});
