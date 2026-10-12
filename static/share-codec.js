'use strict';
// The browser and Python server share the JSON -> zlib -> base64url format.
(() => {
  const MAX_DECODED=128*1024;
  const kinds=new Set(['operator','pact','synergy','strategy','enemy','boss']);
  function validate(value,catalog) {
    if(!value||typeof value!=='object'||![1,2].includes(value.version))throw new Error('不支持的排名码版本');
    const title=value.title;
    if(typeof title!=='string'||!title.trim()||[...title].length>80)throw new Error('榜单名称需要 1–80 个字符');
    const {kind,season}=value;
    if(!kinds.has(kind)||!catalog.seasons.some(s=>s.id===season))throw new Error('排名类型或活动期数无效');
    let rows=value.rows;
    if(!Array.isArray(rows)||rows.length!==(value.version===1?5:9))throw new Error('榜单必须包含五个主档位和四个中间档位');
    if(value.version===1)rows=rows.flatMap((row,index)=>index<4?[row,[]]:[row]);
    const available=new Set(catalog.items.filter(i=>i.kind===kind&&i.seasons.includes(season)).map(i=>i.id)),seen=new Set();
    for(const row of rows) {
      if(!Array.isArray(row)||row.length>2000)throw new Error('榜单内容无效');
      for(const id of row) {
        if(typeof id!=='string'||!available.has(id))throw new Error('排名码包含当前期数不存在的条目，请更新资料后重试');
        if(seen.has(id))throw new Error('榜单包含重复条目');
        seen.add(id);
      }
    }
    return {version:2,title:title.trim(),kind,season,rows:rows.map(row=>[...row])};
  }
  async function transform(bytes,decompress=false) {
    if(typeof CompressionStream==='undefined'||typeof DecompressionStream==='undefined')throw new Error('请使用新版 Chrome、Edge、Firefox 或 Safari 导入导出排名码');
    const stream=new Blob([bytes]).stream().pipeThrough(decompress?new DecompressionStream('deflate'):new CompressionStream('deflate'));
    const reader=stream.getReader(),chunks=[];let length=0;
    try {
      while(true) {
        const {value,done}=await reader.read();if(done)break;
        length+=value.length;
        if(decompress&&length>MAX_DECODED){await reader.cancel();throw new Error('排名码内容过大或不完整');}
        chunks.push(value);
      }
    } finally {reader.releaseLock();}
    const output=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
    return output;
  }
  async function encode(value,catalog) {
    const bytes=await transform(new TextEncoder().encode(JSON.stringify(validate(value,catalog))));
    let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    return 'SP2.'+btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  async function decode(code,catalog) {
    if(typeof code!=='string'||code.length>200000||!/^SP[12]\./.test(code))throw new Error('排名码格式错误，应以 SP1. 或 SP2. 开头');
    let value;
    try {
      const encoded=code.slice(4);
      if(!/^[A-Za-z0-9_+\/-]*={0,2}$/.test(encoded)||encoded.length%4===1)throw new Error('base64');
      const binary=atob(encoded.replace(/-/g,'+').replace(/_/g,'/'));
      const raw=await transform(Uint8Array.from(binary,c=>c.charCodeAt(0)),true);
      value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    } catch(error) {
      if(error.message==='排名码内容过大或不完整')throw error;
      throw new Error('排名码损坏，无法读取');
    }
    if(!value||value.version!==Number(code[2]))throw new Error('排名码前缀与版本不一致');
    return validate(value,catalog);
  }
  const codec={validate,encode,decode};
  globalThis.TierShareCodec=codec;
  if(typeof module!=='undefined')module.exports=codec;
})();
