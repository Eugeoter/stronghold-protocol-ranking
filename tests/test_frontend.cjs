// Exercise ranking state without launching or controlling a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
const getElement = selector => {
  if (!elements.has(selector)) elements.set(selector,{value:'',textContent:'',hidden:false,disabled:false,classList:{contains:()=>false,toggle:()=>{},add:()=>{},remove:()=>{}}});
  return elements.get(selector);
};
const stored = new Map();
const context = {console,assert,setTimeout,clearTimeout,URL,localStorage:{setItem:(k,v)=>stored.set(k,v),getItem:k=>stored.get(k)},document:{querySelector:getElement,querySelectorAll:()=>[],body:getElement('body')},fetch:()=>{throw new Error('Unexpected network request');}};
vm.createContext(context);
const source=fs.readFileSync('static/app.js','utf8').replace(/init\(\);\s*$/,'');
vm.runInContext(source+`
catalog={seasons:[{id:'s1'},{id:'s2'}],pacts:[],items:[
{id:'a',name:'甲',kind:'operator',seasons:['s1'],tier:'VI',mainPact:'炎',mainPacts:['炎','维多利亚'],subPacts:['精准'],tags:[]},
{id:'b',name:'乙',kind:'operator',seasons:['s1'],tier:'I',mainPact:'谢拉格',subPacts:['协防干员'],tags:[]},
{id:'c',name:'丙',kind:'operator',seasons:['s2'],tier:'IV',mainPact:'炎',subPacts:[],tags:[]}
]};
itemMap=new Map(catalog.items.map(i=>[i.id,i]));pactMap=new Map();
renderBoard=()=>{};renderPool=()=>{};updateCounts=()=>{};renderAll=()=>{};
board=defaultBoard('operator','s1');
moveItem('a','0');assert.equal(board.rows[0][0],'a');
moveItem('b','0','a');assert.equal(board.rows[0].join(','),'b,a');
moveItem('a','4');assert.equal(board.rows[0].join(','),'b');assert.equal(board.rows[4][0],'a');
assert.equal(ranked().size,2);
undo();assert.equal(board.rows[0].join(','),'b,a');
redo();assert.equal(board.rows[4][0],'a');
moveItem('a','pool');assert.equal(ranked().size,1);
const h=history.length;moveItem('a','pool');assert.equal(history.length,h,'No-op must not create history');
moveItem('a','1');assert.equal(board.rows[1][0],'a','Item can rank between main tiers');
undo();assert.equal(board.rows[1].length,0);redo();assert.equal(board.rows[1][0],'a');
filters.core='维多利亚';assert.equal(matches(catalog.items[0]),true,'Dual-core membership must match');assert.equal(matches(catalog.items[1]),false);
filters.extra='精准';assert.equal(matches(catalog.items[0]),true);
filters.tier='I';assert.equal(matches(catalog.items[0]),false);
filters={tier:'',core:'',extra:'',tag:'',search:'精准'};assert.equal(matches(catalog.items[0]),true);
assert.equal(board.rows[0][0],'b','Filters must never alter ranking');
switchContext('operator','s2');assert.equal(board.rows.flat().length,0);moveItem('c','2');
switchContext('operator','s1');assert.equal(board.rows[0][0],'b','Context switch restores independent draft');
switchContext('operator','s2');assert.equal(board.rows[2][0],'c');
const invalid={...defaultBoard('operator','s1'),rows:[['a','a','foreign'],['b'],[],[],[],[],[],[],[]]};
const clean=validDraft(invalid,'operator','s1');assert.equal(clean.rows[0].join(','),'a');
assert.equal(validDraft({...invalid,rows:[null,[],[],[],[],[],[],[],[]]},'operator','s1'),null);
const migrated=validDraft({version:1,title:'旧榜单',kind:'operator',season:'s1',rows:[['a'],[],['b'],[],[]]},'operator','s1');
assert.equal(migrated.version,2);assert.equal(migrated.rows.length,9);assert.equal(migrated.rows[4][0],'b');assert.equal(migrated.rows[1].length,0);
filters={tier:'',core:'',extra:'',tag:'',search:'pith'};assert.equal(matches({name:'优等生',leader:'Pith',tags:[]}),true,'Strategy can be searched by its leader');
const seasonal={name:'同名干员',tier:'I',tags:['旧类别'],seasonDetails:{s2:{tier:'VI',tags:['新类别'],description:'下半期特质'}}};
assert.equal(activeItem(seasonal).tier,'VI');assert.equal(activeItem(seasonal).tags[0],'新类别');
assert.equal(seasonal.tier,'I','Season projection must not mutate catalog');
assert.equal(extractCode('https://example.org/#SP1.abc'),'SP1.abc');
assert.equal(extractCode('SP2.abc'),'SP2.abc');
assert.equal(escapeHTML('<img src=x onerror=alert(1)>').includes('<'),false);
console.log('Frontend state: drag moves, ordering, undo/redo, filtering, independent drafts, restore validation and escaping passed.');
`,context);
