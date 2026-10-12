const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const zlib=require('node:zlib');
const codec=require('../static/share-codec.js');
const catalog=JSON.parse(fs.readFileSync('data/catalog.json','utf8'));
const season=catalog.seasons[1].id;
const ids=catalog.items.filter(i=>i.kind==='operator'&&i.seasons.includes(season)).slice(0,3).map(i=>i.id);
function python(source,input) {
  const result=spawnSync(process.env.PYTHON||'python',['-X','utf8','-c',source],{input,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return result.stdout.trim();
}
function wire(value,prefix='SP2.') {return prefix+zlib.deflateSync(Buffer.from(JSON.stringify(value))).toString('base64url');}
(async()=>{
  const board={version:2,title:' 战术判断 · 盟约 🟢 ',kind:'operator',season,rows:[[ids[1]], [ids[0]], [], [], [], [], [], [], [ids[2]]]};
  const expected=codec.validate(board,catalog);
  const jsCode=await codec.encode(board,catalog);
  const pythonBoard=JSON.parse(python('import sys,json;from app import decode_board;print(json.dumps(decode_board(sys.stdin.read()),ensure_ascii=False))',jsCode));
  assert.deepEqual(pythonBoard,expected,'Python reads browser codes including intermediate tiers');
  const pythonCode=python('import sys,json;from app import encode_board;print(encode_board(json.load(sys.stdin)))',JSON.stringify(board));
  assert.deepEqual(await codec.decode(pythonCode,catalog),expected,'Browser reads Python codes');
  assert.deepEqual(await codec.decode(jsCode,catalog),expected);
  const old={...board,version:1,rows:[[ids[0]],[],[ids[1]],[],[]]};
  const migrated=await codec.decode(wire(old,'SP1.'),catalog);
  assert.equal(migrated.rows.length,9);assert.deepEqual(migrated.rows[4],[ids[1]]);assert.deepEqual(migrated.rows[1],[]);
  await assert.rejects(()=>codec.decode(wire({...board,rows:[[ids[0],ids[0]],[],[],[],[],[],[],[],[]]}),catalog),/重复/);
  await assert.rejects(()=>codec.decode(wire({...board,rows:[['foreign'],[],[],[],[],[],[],[],[]]}),catalog),/不存在/);
  await assert.rejects(()=>codec.decode(wire(board,'SP1.'),catalog),/版本/);
  await assert.rejects(()=>codec.decode('SP2.%%%bad',catalog),/损坏/);
  await assert.rejects(()=>codec.decode('SP2.'+zlib.deflateSync(Buffer.alloc(200000,65)).toString('base64url'),catalog),/过大/);
  await assert.rejects(()=>codec.decode(jsCode.slice(0,-5),catalog),/损坏/);
  await assert.rejects(()=>codec.decode('SP2.'+Buffer.concat([Buffer.from(jsCode.slice(4),'base64url'),Buffer.from('extra')]).toString('base64url'),catalog),/损坏/);
  assert.throws(()=>codec.validate({...board,title:'🟢'.repeat(81)},catalog),/80/);
  for(const kind of ['pact','synergy','strategy','enemy','boss']) {
    const item=catalog.items.find(i=>i.kind===kind&&i.seasons.includes(season));
    const value={...board,kind,rows:[[item.id],[],[],[],[],[],[],[],[]]};
    assert.deepEqual(await codec.decode(await codec.encode(value,catalog),catalog),codec.validate(value,catalog));
  }
  console.log('Browser/Python share-code compatibility, six kinds, SP1 migration, Unicode and rejection limits passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
