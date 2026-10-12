'use strict';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const KIND_NAMES = {operator:'盟约干员',pact:'盟约',synergy:'进阶盟约',strategy:'开局策略',enemy:'敌人',boss:'BOSS'};
const MAIN_LEVELS = [{name:'夯',en:'ABSOLUTE PEAK',color:'#4ddcbb'},{name:'顶级',en:'TOP TIER',color:'#c4dfc8'},{name:'人上人',en:'ABOVE AVERAGE',color:'#e0c591'},{name:'NPC',en:'JUST OKAY',color:'#aebbd0'},{name:'拉完了',en:'BOTTOM TIER',color:'#9a9299'}];
const LEVELS = MAIN_LEVELS.flatMap((level,index)=>index<4?[level,{name:`介于${level.name}和${MAIN_LEVELS[index+1].name}之间`,short:`${level.name} ↔ ${MAIN_LEVELS[index+1].name}`,en:'BETWEEN TIERS',color:'#1e3730',between:true}]:[level]);
const STORAGE = 'stronghold-ranking-v1';
const STATIC_MODE = document.body.dataset?.mode === 'static';
const assetURL = value => new URL(value.replace(/^\//,''), new URL('.',document.baseURI)).href;
function prepareAssets(data) {
  for (const entry of [...data.items,...data.pacts,...(data.enemyGroups||[])]) {
    if(entry.image)entry.image=assetURL(entry.image);
    for(const detail of Object.values(entry.seasonDetails||{}))if(detail.image)detail.image=assetURL(detail.image);
  }
  return data;
}
let catalog, itemMap, pactMap, board, history=[], future=[], drafts={};
let filters={tier:'',core:'',extra:'',tag:'',search:''};
let shareMode='export', shareRequest=0, selectedItem=null, drag=null, suppressClick=false, toastTimer;
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plainDescription = value => String(value ?? '').replace(/<@[a-zA-Z0-9_.]+>/g,'').replace(/<\/>/g,'').replace(/\\n/g,'\n');
const clone = value => JSON.parse(JSON.stringify(value));
const key = (kind=board.kind,season=board.season) => `${season}:${kind}`;
const defaultBoard = (kind,season) => ({version:2,title:`我的${KIND_NAMES[kind]}排行榜`,kind,season,rows:Array.from({length:9},()=>[])});
const activeItem = item => ({...item,...(item.seasonDetails?.[board.season]||{})});
const availableItems = () => catalog.items.filter(item=>item.kind===board.kind && item.seasons.includes(board.season)).map(activeItem).sort((a,b)=>board.kind==='operator'?['VI','V','IV','III','II','I'].indexOf(a.tier)-['VI','V','IV','III','II','I'].indexOf(b.tier):0);
const ranked = () => new Set(board.rows.flat());
function safeURL(value) { try { const url=new URL(value); return ['http:','https:'].includes(url.protocol)?url.href:'#'; } catch { return '#'; } }
function toast(message) { const el=$('#toast'); el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3000); }
function remember() {
  drafts[key()]=clone(board);
  try { localStorage.setItem(STORAGE,JSON.stringify({drafts,active:key(),compact:document.body.classList.contains('compact')})); $('#save-status').textContent='已自动保存'; }
  catch { $('#save-status').textContent='本地存储不可用'; }
}
function validDraft(value,kind,season) {
  if (!value || ![1,2].includes(value.version) || value.kind!==kind || value.season!==season || !Array.isArray(value.rows) || value.rows.length!==(value.version===1?5:9) || typeof value.title!=='string') return null;
  const ids=new Set(catalog.items.filter(i=>i.kind===kind&&i.seasons.includes(season)).map(i=>i.id)), seen=new Set();
  if (!value.rows.every(Array.isArray)) return null;
  const rows=value.version===1?value.rows.flatMap((row,index)=>index<4?[row,[]]:[row]):value.rows;
  const title=value.title==='我的羁绊档位排行榜'?'我的进阶盟约排行榜':value.title;
  return {...defaultBoard(kind,season),title:title.slice(0,80)||`我的${KIND_NAMES[kind]}排行榜`,rows:rows.map(row=>row.filter(id=>{if(!ids.has(id)||seen.has(id))return false;seen.add(id);return true;}))};
}
function checkpoint() {history.push(clone(board));if(history.length>80)history.shift();future=[];}
function capturePositions() {return new Map($$('.entry').map(el=>[el.dataset.id,{rect:el.getBoundingClientRect(),row:el.closest('.drop-zone')?.dataset.row}]));}
function animatePositions(before) {
  if(!before.size||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  $$('.entry').forEach(el=>{const old=before.get(el.dataset.id);if(!old||old.row!==el.closest('.drop-zone')?.dataset.row)return;const rect=el.getBoundingClientRect(),x=old.rect.left-rect.left,y=old.rect.top-rect.top;if(Math.abs(x)+Math.abs(y)>1)el.animate([{transform:`translate(${x}px,${y}px)`},{transform:'translate(0,0)'}],{duration:240,easing:'cubic-bezier(.2,.8,.2,1)'});});
}
function commit(mutator) {const positions=capturePositions();checkpoint();mutator();remember();renderBoard();renderPool();updateCounts();animatePositions(positions);}
function moveItem(id,row,beforeId=null) {
  const item=itemMap.get(id);if(!item||item.kind!==board.kind||!item.seasons.includes(board.season))return;
  const old=JSON.stringify(board.rows);
  const next=board.rows.map(items=>items.filter(item=>item!==id));
  if(row!=='pool') {const index=Number(row);if(!Number.isInteger(index)||index<0||index>=LEVELS.length)return;const target=next[index];const before=target.indexOf(beforeId);target.splice(before<0?target.length:before,0,id);}
  if(JSON.stringify(next)===old)return;
  commit(()=>board.rows=next);
  $('#drag-live').textContent=`${itemMap.get(id).name}已移至${row==='pool'?'待排名区':LEVELS[Number(row)].name}`;
}
function switchContext(kind,season) {
  remember();board=validDraft(drafts[`${season}:${kind}`],kind,season)||defaultBoard(kind,season);
  history=[];future=[];filters={tier:'',core:'',extra:'',tag:'',search:''};$('#search-input').value='';
  renderAll();remember();
}
function renderAll() {
  $$('#kind-tabs button').forEach(button=>{const active=button.dataset.kind===board.kind;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
  $('#board-title').value=board.title;$('#season-select').value=board.season;
  $('#season-date').textContent=catalog.seasons.find(s=>s.id===board.season)?.date||'';
  $('#event-logo').src=assetURL(board.season==='covenant-2025'?'/static/branding/stronghold-alliance.png':'/static/branding/stronghold-alliance-phase2.png');
  $('#search-input').placeholder=board.kind==='operator'?'搜索干员名称 / 盟约…':`搜索${KIND_NAMES[board.kind]}名称…`;
  renderFilters();renderBoard();renderPool();updateCounts();
}
function card(item) {
  item=activeItem(item);
  const button=document.createElement('button');button.type='button';button.className=`entry ${item.kind}`;button.dataset.id=item.id;button.title=`${item.name}${item.tier?' · '+item.tier+' 阶':''} · 点击排名或查看详情`;
  if(item.kind==='strategy')button.title=`${item.leader||''} · ${item.name} · 点击排名或查看详情`;
  button.setAttribute('aria-label',button.title);
  const pacts=[...(item.mainPacts||[item.mainPact]),...(item.subPacts||[])].filter(Boolean).map(name=>pactMap.get(name)).filter(Boolean);
  button.innerHTML=`<div class="entry-image"><img src="${escapeHTML(item.image)}" alt="" draggable="false" loading="lazy">${item.tier?`<span class="entry-meta">${escapeHTML(item.tier)}</span>`:''}${pacts.length?`<span class="entry-pacts">${pacts.map(p=>`<img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name)}">`).join('')}</span>`:''}</div><div class="entry-name">${escapeHTML(item.kind==='strategy'?item.leader||item.name:item.name)}</div>${item.kind==='strategy'?`<div class="entry-subtitle">${escapeHTML(item.name)}</div>`:''}`;
  return button;
}
function renderBoard() {
  const root=$('#tier-board');root.replaceChildren();
  LEVELS.forEach((level,index)=>{
    const row=document.createElement('div');row.className=`tier-row tier-${Math.floor(index/2)} ${level.between?'between-row':''}`;
    const hint=level.between?`↕ 拖入此处 · ${level.name}`:index===0?'把你的最强之选放在这里':'拖动条目至此';
    row.innerHTML=`<div class="tier-label" title="${level.name}"><strong>${level.short||level.name}</strong><small>${level.en}</small></div><div class="tier-content drop-zone" data-row="${index}" data-hint="${hint}" aria-label="${level.name}"></div>`;
    const content=row.querySelector('.tier-content');board.rows[index].forEach(id=>{if(itemMap.has(id))content.append(card(itemMap.get(id)));});root.append(row);
  });
  $('#undo-btn').disabled=!history.length;$('#redo-btn').disabled=!future.length;
}
function matches(item) {
  if(filters.tier&&item.tier!==filters.tier)return false;
  if(filters.core&&!(item.mainPacts||[item.mainPact]).includes(filters.core))return false;
  if(filters.extra&&!(item.subPacts||[]).includes(filters.extra))return false;
  if(filters.tag&&!(item.tags||[]).includes(filters.tag))return false;
  const haystack=[item.name,item.leader||'',...(item.mainPacts||[item.mainPact]),...(item.subPacts||[]),...(item.tags||[])].join(' ').toLocaleLowerCase();
  return !filters.search||haystack.includes(filters.search.toLocaleLowerCase());
}
function renderPool() {
  const placed=ranked(),items=availableItems().filter(i=>!placed.has(i.id)&&matches(i));const root=$('#pool');root.replaceChildren();
  items.forEach(item=>root.append(card(item)));$('#pool-count').textContent=items.length;
  if(!items.length){const empty=document.createElement('div');empty.className='empty-state';const remaining=availableItems().length-placed.size;empty.innerHTML=remaining?'<b>⌕</b><span>没有符合筛选条件的条目</span><button id="empty-clear">清除筛选，查看全部</button>':'<b>✓</b><span>所有条目均已完成排名</span><span>现在可以分享你的榜单了。</span>';root.append(empty);empty.querySelector('button')?.addEventListener('click',clearFilters);}
  $('#pool-caption').textContent=`当前显示 ${items.length} / ${availableItems().length-placed.size} 个待排名条目 · 筛选只影响待排名区`;
}
function updateCounts() {$('#ranked-count').textContent=ranked().size;$('#total-count').textContent=availableItems().length;}
function renderFilters() {
  const isOperator=board.kind==='operator';$('#operator-filters').hidden=!isOperator;$('#other-filters').hidden=false;$('#tag-filter-label').innerHTML=isOperator?'职业 / 状态 <span>TYPE</span>':'条目类型 <span>TYPE</span>';
  const items=availableItems();
  if(isOperator) {
    $('#tier-filters').innerHTML=['VI','V','IV','III','II','I'].map(tier=>`<button data-filter="tier" data-value="${tier}" class="${filters.tier===tier?'active':''}" aria-pressed="${filters.tier===tier}">${tier}</button>`).join('');
    const core=new Set(items.flatMap(i=>i.mainPacts||[i.mainPact]).filter(Boolean));const extra=new Set(items.flatMap(i=>i.subPacts||[]));
    function renderPacts(target,names,filter) {$(target).innerHTML=[...names].map(name=>{const pact=pactMap.get(name);return `<button class="pact-filter ${filters[filter]===name?'active':''}" data-filter="${filter}" data-value="${escapeHTML(name)}" title="${escapeHTML(name)}" aria-pressed="${filters[filter]===name}">${pact?`<img src="${escapeHTML(pact.image)}" alt="">`:''}<span>${escapeHTML(name)}</span></button>`;}).join('');}
    renderPacts('#core-filters',core,'core');renderPacts('#extra-filters',extra,'extra');
    $('#filter-note').textContent='等阶为活动内配置；核心盟约反映阵营，附加盟约反映能力。';
  } else {
    $('#filter-note').textContent=board.kind==='synergy'?'进阶盟约按真实激活人数、在场人数或层数门槛分别评价。':board.kind==='pact'?'按核心盟约、附加盟约筛选，点击图标查看当期效果。':board.kind==='strategy'?'头像表示策略发起人，下方显示正式策略名。可按发起人或策略名称搜索。':'战术分组与地面 / 空中单位分别筛选；最终领袖及其他首领列于 BOSS。';
  }
  const tags=[...new Set(items.flatMap(i=>i.tags||[]))];$('#tag-filters').innerHTML=tags.map(tag=>{const group=catalog.enemyGroups?.find(group=>group.name===tag&&group.seasons.includes(board.season));return `<button data-filter="tag" data-value="${escapeHTML(tag)}" class="${filters.tag===tag?'active':''}" aria-pressed="${filters.tag===tag}">${group?`<img src="${escapeHTML(group.image)}" alt="">`:''}${escapeHTML(tag)}</button>`;}).join('');
}
function clearFilters() {filters={tier:'',core:'',extra:'',tag:'',search:''};$('#search-input').value='';renderFilters();renderPool();}
function undo() {if(!history.length)return;const positions=capturePositions();future.push(clone(board));board=history.pop();$('#board-title').value=board.title;remember();renderBoard();renderPool();updateCounts();animatePositions(positions);}
function redo() {if(!future.length)return;const positions=capturePositions();history.push(clone(board));board=future.pop();$('#board-title').value=board.title;remember();renderBoard();renderPool();updateCounts();animatePositions(positions);}
async function api(path,body) {
  if(STATIC_MODE) {
    if(path==='/api/share')return {board:TierShareCodec.validate(body,catalog),code:await TierShareCodec.encode(body,catalog)};
    if(path==='/api/import')return {board:await TierShareCodec.decode(body.code,catalog)};
    throw new Error('不支持的操作');
  }
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||'操作失败，请重试');return result;
}
async function openShare(mode='export') {
  const requestId=++shareRequest;
  shareMode=mode;$('#share-error').textContent='';$('#export-tab').classList.toggle('active',mode==='export');$('#import-tab').classList.toggle('active',mode==='import');$('#code-label').textContent=mode==='export'?'你的排名码':'粘贴排名码或分享链接';$('#share-code').readOnly=mode==='export';$('#code-action').textContent=mode==='export'?'复制排名码 ↗':'导入并还原榜单 ↗';$('#copy-link').hidden=mode==='import';$('#share-code').value='';$('#code-action').disabled=true;$('#copy-link').disabled=true;
  if(!$('#share-dialog').open)$('#share-dialog').showModal();
  if(mode==='import') {$('#code-action').disabled=false;$('#share-code').focus();return;}
  try {const result=await api('/api/share',board);if(shareMode!=='export'||requestId!==shareRequest)return;$('#share-code').value=result.code;$('#code-action').disabled=false;$('#copy-link').disabled=false;}
  catch(error){if(requestId===shareRequest)$('#share-error').textContent=error.message;}
}
async function copy(text) {try {await navigator.clipboard.writeText(text);toast('已复制到剪贴板');}catch {$('#share-code').focus();$('#share-code').select();toast('请手动复制已选中的排名码');}}
function extractCode(value) {value=value.trim();if(/^SP[12]\./.test(value))return value;try{const url=new URL(value);return decodeURIComponent(url.hash.slice(1));}catch{return value;}}
async function restore(code) {
  const result=await api('/api/import',{code:extractCode(code)});remember();const incoming=result.board;
  if(incoming.kind===board.kind&&incoming.season===board.season){checkpoint();board=incoming;}else{switchContext(incoming.kind,incoming.season);checkpoint();board=incoming;}
  filters={tier:'',core:'',extra:'',tag:'',search:''};$('#search-input').value='';remember();renderAll();if($('#share-dialog').open)$('#share-dialog').close();toast('榜单已还原，可用撤销恢复原榜单');
}
function showItem(id) {
  const rawItem=itemMap.get(id);if(!rawItem)return;const item=activeItem(rawItem);selectedItem=id;
  const detail=item.seasonDetails?.[board.season]||item;
  const tags=[item.tier?`${item.tier} 阶`:'',item.leader||'',item.initialLife?`初始生命 ${item.initialLife}`:'',...(item.mainPacts||[item.mainPact]),...(item.subPacts||[]),...(item.tags||[])].filter(Boolean);
  const description=(item.kind==='strategy'&&item.unlock?`解锁条件：${item.unlock}\n\n`:'')+(detail.description||'此条目收录于本期卫戍协议资料。');
  $('#item-detail').innerHTML=`<div class="detail-head"><img src="${escapeHTML(item.image)}" alt="${escapeHTML(item.name)}"><div><h2>${escapeHTML(item.name)}</h2><div class="detail-tags">${tags.map(tag=>`<span>${escapeHTML(tag)}</span>`).join('')}</div></div></div><div class="description">${escapeHTML(plainDescription(description))}</div><div class="detail-sources"><a class="source-link" href="${escapeHTML(safeURL(item.entitySource||detail.source))}" target="_blank" rel="noopener noreferrer">在 PRTS 查看详细资料 ↗</a><a class="source-link" href="${escapeHTML(safeURL(detail.source))}" target="_blank" rel="noopener noreferrer">本期配置来源 ↗</a></div>`;
  $('#move-buttons').innerHTML=LEVELS.map((level,index)=>`<button data-move="${index}" title="${level.name}" aria-label="${level.name}">${level.short||level.name}</button>`).join('');$('#return-pool').disabled=!ranked().has(id);$('#item-dialog').showModal();
}
function showInfo(sources=false) {
  if(sources) {
    $('#info-content').innerHTML=`<h2>数据与素材来源</h2><p>本项目为明日方舟玩家自制工具。游戏头像、盟约与策略图像来自 PRTS；罗德岛标志来自明日方舟官网。素材版权归鹰角网络及其关联公司所有。资料按期数独立整理。</p><div class="source-list"><a href="https://ak.hypergryph.com/" target="_blank" rel="noopener noreferrer">明日方舟官网 · 罗德岛标志 ↗</a>${catalog.sources.map(source=>`<a href="${escapeHTML(safeURL(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title)} ↗</a>`).join('')}</div><h3>收录说明</h3><p>${catalog.seasons.map(s=>`${escapeHTML(s.name)}：${escapeHTML(s.description||'')}`).join('<br>')}</p><p>“进阶盟约”按盟约激活人数、在场人数或层数门槛拆分评价。开局策略包含正式名称、发起人、初始生命和解锁条件。甄选干员可自由编入，干员榜单以期内数据库为基础。</p><p>资料同步日期：${escapeHTML(catalog.updatedAt)}。修订记录与素材来源保存在项目数据中。</p>`;
  } else {
    $('#info-content').innerHTML='<h2>为你的战术理解排名。</h2><ol><li>先选择排名类型和活动期数；每个组合有独立的榜单。</li><li>拖动头像到五个主档位，或放入相邻档位间的细条区域，例如“夯 ↔ 顶级”。同档内可以调整顺序，拖回资料区可取消排名。</li><li>点击条目查看资料并直接选择九个位置之一。开局策略可按正式名称或发起人搜索，例如“变形者集群”“Pith”“佩佩”。</li><li>筛选器位于资料列表顶部；核心和附加盟约可折叠。筛选只影响待排名条目，榜单始终完整显示。</li><li>修改榜单名称后，可以导出 PNG、复制排名码或分享链接。新版码以 SP2. 开头，完整保留中间档位；旧 SP1. 排名码仍可导入。</li></ol><h3>自动保存与撤销</h3><p>旧版五层草稿会自动迁移到五个主档位。榜单保存在当前浏览器，清除浏览器数据会删除草稿，请导出排名码备份。Ctrl / ⌘ + Z 撤销；Ctrl / ⌘ + Shift + Z 重做；按 / 开始搜索。</p>';
  }
  $('#info-dialog').showModal();
}

// Pointer-based drag works on desktop and touch; a tap opens the accessible move menu.
function beginDrag(event) {
  if(event.button!==0||event.target.closest('dialog'))return;
  const entry=event.target.closest('.entry');if(!entry)return;
  drag={id:entry.dataset.id,entry,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,active:false,zone:null,before:null,ghost:null,marker:null,frame:null};
}
function dragMove(event) {
  if(!drag||event.pointerId!==drag.pointer)return;
  drag.x=event.clientX;drag.y=event.clientY;
  if(!drag.active) {
    if(Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<7)return;
    drag.active=true;suppressClick=true;drag.entry.classList.add('drag-origin');document.body.classList.add('dragging');
    drag.ghost=drag.entry.cloneNode(true);drag.ghost.classList.add('drag-ghost');drag.ghost.removeAttribute('aria-label');drag.ghost.style.width=drag.entry.offsetWidth+'px';drag.ghost.style.height=drag.entry.offsetHeight+'px';document.body.append(drag.ghost);
    drag.marker=document.createElement('span');drag.marker.className='drop-marker';
    drag.frame=requestAnimationFrame(autoScrollDrag);
  }
  event.preventDefault();drag.ghost.style.left=(event.clientX-drag.entry.offsetWidth/2)+'px';drag.ghost.style.top=(event.clientY-34)+'px';
  updateDragTarget();
}
function updateDragTarget() {
  if(!drag?.active)return;
  const hit=document.elementFromPoint(drag.x,drag.y);const zone=hit?.closest('.drop-zone')||hit?.closest('.tier-row')?.querySelector('.drop-zone');
  $$('.drop-zone.drag-over').forEach(el=>el.classList.remove('drag-over'));drag.marker.remove();drag.zone=zone;drag.before=null;
  if(zone){zone.classList.add('drag-over');const target=hit.closest('.entry');if(zone.dataset.row!=='pool'){
    if(target&&target.dataset.id!==drag.id){const rect=target.getBoundingClientRect();const after=drag.x>rect.left+rect.width/2;const entries=[...zone.querySelectorAll('.entry')].filter(el=>el.dataset.id!==drag.id);const before=after?entries[entries.indexOf(target)+1]:target;drag.before=before?.dataset.id||null;zone.insertBefore(drag.marker,before||null);}else{zone.append(drag.marker);}
  }}
}
function autoScrollDrag() {
  if(!drag?.active)return;
  let scrolling=false;
  if(drag.y<90){window.scrollBy(0,-12);scrolling=true;}else if(drag.y>window.innerHeight-70){window.scrollBy(0,12);scrolling=true;}
  const region=document.elementFromPoint(drag.x,drag.y)?.closest('.scroll-region');
  if(region){const rect=region.getBoundingClientRect();if(drag.y>rect.bottom-35){region.scrollTop+=10;scrolling=true;}else if(drag.y<rect.top+35){region.scrollTop-=10;scrolling=true;}}
  if(scrolling)updateDragTarget();drag.frame=requestAnimationFrame(autoScrollDrag);
}
function endDrag(event,cancel=false) {
  if(!drag||event.pointerId!==drag.pointer)return;
  const {id,zone,before,active}=drag;cancelAnimationFrame(drag.frame);drag.ghost?.remove();drag.marker?.remove();drag.entry.classList.remove('drag-origin');document.body.classList.remove('dragging');$$('.drop-zone.drag-over').forEach(el=>el.classList.remove('drag-over'));drag=null;
  if(active&&!cancel&&zone)moveItem(id,zone.dataset.row,before);
  if(active)setTimeout(()=>suppressClick=false,0);
}

async function exportImage() {
  return exportSnapshot(clone(board));
}
async function exportSnapshot(board) {
  const activeItem=item=>({...item,...(item.seasonDetails?.[board.season]||{})});
  const ranked=()=>new Set(board.rows.flat());
  const button=$('#image-btn');button.disabled=true;button.textContent='生成中…';
  try {
    const width=1400,pad=45,labelWidth=145,size=88,gap=10,perRow=Math.floor((width-pad*2-labelWidth-24)/(size+gap));
    const rowHeights=board.rows.map((row,index)=>Math.max(LEVELS[index].between?40:120,row.length?Math.ceil(row.length/perRow)*118+24:0));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=240+rowHeights.reduce((a,b)=>a+b,0)+90;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#080f11';ctx.fillRect(0,0,width,canvas.height);ctx.fillStyle='#11221c';ctx.fillRect(0,0,width,205);ctx.fillStyle='#4ddcbb';ctx.fillRect(0,202,width,3);
    await document.fonts.ready;
    ctx.fillStyle='#82ad98';ctx.font='18px sans-serif';ctx.fillText('STRONGHOLD PROTOCOL / ALLIANCE · TACTICAL ASSESSMENT',pad,48);
    ctx.fillStyle='#f4f6ec';let title=board.title;ctx.font='bold 38px "Microsoft YaHei", sans-serif';while(ctx.measureText(title).width>width-pad*2&&title.length>2)title=title.slice(0,-2)+'…';ctx.fillText(title,pad,110);
    const season=catalog.seasons.find(s=>s.id===board.season);ctx.fillStyle='#4ddcbb';ctx.font='20px "Microsoft YaHei", sans-serif';ctx.fillText(`${season.name} / ${KIND_NAMES[board.kind]} / ${ranked().size} 个已排名条目`,pad,158);
    const images=new Map();let failed=0;
    await Promise.all([...ranked()].map(async id=>{const img=new Image();img.src=activeItem(itemMap.get(id)).image;try{await img.decode();images.set(id,img);}catch{failed++;}}));
    let y=235;
    board.rows.forEach((row,index)=>{
      const level=LEVELS[index],height=rowHeights[index];ctx.fillStyle=level.between?'#10241c':'#101a1b';ctx.fillRect(pad,y,width-pad*2,height);ctx.fillStyle=level.between?'#142c21':'#1b3027';ctx.fillRect(pad,y,labelWidth,height);ctx.fillStyle=level.between?'#3b6c4f':level.color;ctx.fillRect(pad,y,4,height);ctx.strokeStyle='#2f4839';ctx.strokeRect(pad,y,width-pad*2,height);ctx.fillStyle=level.between?'#88ad93':level.color;ctx.font=level.between?'15px "Microsoft YaHei", sans-serif':'bold 34px "Microsoft YaHei", sans-serif';ctx.textAlign='center';ctx.fillText(level.short||level.name,pad+labelWidth/2,y+height/2+(level.between?5:6));if(!level.between){ctx.fillStyle='#6d8e79';ctx.font='12px sans-serif';ctx.fillText(level.en,pad+labelWidth/2,y+height/2+28);}ctx.textAlign='left';
      row.forEach((id,j)=>{const item=activeItem(itemMap.get(id)),x=pad+labelWidth+14+(j%perRow)*(size+gap),cy=y+13+Math.floor(j/perRow)*118;ctx.fillStyle='#1d3026';ctx.fillRect(x,cy,size,size);const img=images.get(id);if(img){if(['operator','strategy'].includes(item.kind)){const scale=Math.max(size/img.width,size/img.height);ctx.save();ctx.beginPath();ctx.rect(x,cy,size,size);ctx.clip();ctx.drawImage(img,x+(size-img.width*scale)/2,cy+(size-img.height*scale)/2,img.width*scale,img.height*scale);ctx.restore();}else{const scale=Math.min((size-10)/img.width,(size-10)/img.height);ctx.drawImage(img,x+(size-img.width*scale)/2,cy+(size-img.height*scale)/2,img.width*scale,img.height*scale);}}ctx.fillStyle='#b1cab6';ctx.font='14px "Microsoft YaHei", sans-serif';ctx.textAlign='center';let name=item.name;while(ctx.measureText(name).width>size&&name.length>2)name=name.slice(0,-2)+'…';ctx.fillText(name,x+size/2,cy+108);ctx.textAlign='left';});y+=height;
    });
    ctx.fillStyle='#678e74';ctx.font='15px "Microsoft YaHei", sans-serif';ctx.fillText('卫戍协议：盟约 · 从夯到拉 / 数据与素材来源：PRTS Wiki / 游戏素材 © 鹰角网络',pad,canvas.height-34);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('图片生成失败');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${board.title.replace(/[\\/:*?"<>|]/g,'_')}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(failed?`图片已导出，${failed} 个素材未能加载`:'榜单图片已导出');
  }catch(error){toast(error.message||'图片导出失败');}finally{button.disabled=false;button.textContent='↓ 导出图片';}
}

function bindEvents() {
  $('#kind-tabs').addEventListener('click',event=>{const target=event.target.closest('[data-kind]');if(target&&target.dataset.kind!==board.kind)switchContext(target.dataset.kind,board.season);});
  $('#season-select').addEventListener('change',event=>switchContext(board.kind,event.target.value));
  $('.filter-panel').addEventListener('click',event=>{const button=event.target.closest('[data-filter]');if(!button)return;filters[button.dataset.filter]=filters[button.dataset.filter]===button.dataset.value?'':button.dataset.value;renderFilters();renderPool();});
  $('#clear-filters').addEventListener('click',clearFilters);$('#search-input').addEventListener('input',event=>{filters.search=event.target.value.trim();renderPool();});
  $('#board-title').addEventListener('input',event=>{const title=event.target.value.trim()||`我的${KIND_NAMES[board.kind]}排行榜`;if(title!==board.title){checkpoint();board.title=title;remember();$('#undo-btn').disabled=false;$('#redo-btn').disabled=true;}});
  $('#board-title').addEventListener('change',event=>{event.target.value=board.title;});
  $('#undo-btn').addEventListener('click',undo);$('#redo-btn').addEventListener('click',redo);
  $('#reset-btn').addEventListener('click',()=>{if(!ranked().size){toast('榜单已经为空');return;}commit(()=>board.rows=Array.from({length:9},()=>[]));toast('榜单已重置，可以撤销');});
  $('#view-btn').addEventListener('click',()=>{document.body.classList.toggle('compact');$('#view-btn span').textContent=document.body.classList.contains('compact')?'标准视图':'紧凑视图';remember();});
  $('#share-btn').addEventListener('click',()=>openShare());$('#export-tab').addEventListener('click',()=>openShare('export'));$('#import-tab').addEventListener('click',()=>openShare('import'));
  $('#copy-link').addEventListener('click',()=>copy(`${location.origin}${location.pathname}#${$('#share-code').value}`));
  $('#code-action').addEventListener('click',async()=>{if(shareMode==='export'){await copy($('#share-code').value);return;}$('#code-action').disabled=true;$('#share-error').textContent='';try{await restore($('#share-code').value);}catch(error){$('#share-error').textContent=error.message;}finally{$('#code-action').disabled=false;}});
  $('#image-btn').addEventListener('click',exportImage);$('#help-btn').addEventListener('click',()=>showInfo());$('#sources-btn').addEventListener('click',()=>showInfo(true));
  $$('.close-dialog').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
  $$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
  $('#move-buttons').addEventListener('click',event=>{const button=event.target.closest('[data-move]');if(button){moveItem(selectedItem,button.dataset.move);$('#item-dialog').close();}});
  $('#return-pool').addEventListener('click',()=>{moveItem(selectedItem,'pool');$('#item-dialog').close();});
  document.addEventListener('click',event=>{const entry=event.target.closest('.entry');if(entry&&!suppressClick)showItem(entry.dataset.id);});
  document.addEventListener('pointerdown',beginDrag);document.addEventListener('pointermove',dragMove,{passive:false});document.addEventListener('pointerup',event=>endDrag(event));document.addEventListener('pointercancel',event=>endDrag(event,true));document.addEventListener('dragstart',event=>{if(event.target.closest('.entry'))event.preventDefault();});
  window.addEventListener('blur',()=>{if(drag)endDrag({pointerId:drag.pointer},true);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&drag){endDrag({pointerId:drag.pointer},true);return;}if(event.target.matches('input,textarea,select')||$('dialog[open]'))return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();}else if(event.key==='/'){event.preventDefault();$('#search-input').focus();}});
  window.addEventListener('hashchange',async()=>{if(!location.hash)return;try{await restore(decodeURIComponent(location.hash.slice(1)));}catch(error){toast(error.message);}});
}
async function init() {
  try {
    const response=await fetch(STATIC_MODE?'data/catalog.json':'/api/catalog');if(!response.ok)throw new Error('资料未能载入');catalog=prepareAssets(await response.json());if(!catalog.items?.length||!catalog.seasons?.length)throw new Error('资料库为空，请先同步游戏资料');
    itemMap=new Map(catalog.items.map(item=>[item.id,item]));pactMap=new Map(catalog.pacts.map(pact=>[pact.name,pact]));
    $('#hero-factions').innerHTML=catalog.pacts.filter(p=>p.type==='core').slice(0,5).map(p=>`<img src="${escapeHTML(p.image)}" alt="">`).join('');
    $('#season-select').innerHTML=catalog.seasons.map(s=>`<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)} · ${escapeHTML(s.date.slice(0,4))}</option>`).join('');
    const defaultSeason=catalog.seasons[catalog.seasons.length-1].id;
    let stored=null;try{stored=JSON.parse(localStorage.getItem(STORAGE)||'null');}catch{}
    if(stored&&typeof stored.drafts==='object'&&stored.drafts)drafts=stored.drafts;
    let active=typeof stored?.active==='string'?stored.active.split(':'):null;const season=active&&catalog.seasons.some(s=>s.id===active[0])?active[0]:defaultSeason;const kind=active&&Object.hasOwn(KIND_NAMES,active[1])?active[1]:'operator';
    board=validDraft(drafts[`${season}:${kind}`],kind,season)||defaultBoard(kind,season);
    if(stored?.compact){document.body.classList.add('compact');$('#view-btn span').textContent='标准视图';}
    renderAll();bindEvents();remember();
    if(location.hash){try{await restore(decodeURIComponent(location.hash.slice(1)));}catch(error){toast(error.message);}}
  }catch(error){$('#pool').innerHTML=`<div class="empty-state"><b>!</b><span>${escapeHTML(error.message)}</span><span>${STATIC_MODE?'请检查网络连接，稍后重新载入。':'请确认 Python 服务与 data/catalog.json 可用。'}</span><button onclick="location.reload()">重新载入</button></div>`;$('#save-status').textContent='资料载入失败';}
}
init();
