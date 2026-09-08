/* Transparent metadata-neighborhood explorer; edges are NOT bibliographic citations. */
(function(root){
  'use strict';
  const bases=new Set(['all','topic','platform','co-mention']);
  const scopes=new Set(['direct','adjacent','background','survey','locomotion']);
  const text=v=>typeof v==='string'?v:'';
  const array=v=>Array.isArray(v)?v:[];
  const unique=v=>[...new Set(array(v).filter(x=>typeof x==='string'&&x.trim()))];
  const overlap=(a,b)=>{const set=new Set(unique(b));return unique(a).filter(x=>set.has(x));};
  const normalize=v=>text(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const name=v=>({'wbc':'Whole-body control','mpc':'Model predictive control','rl':'Reinforcement learning','imitation':'Imitation learning','sim2real':'Simulation to reality','sim-to-real':'Simulation to reality','vla':'Vision-language-action models'}[v]||text(v).split('-').map(x=>x?x[0].toUpperCase()+x.slice(1):'').join(' '));
  const scopeNames={direct:'Quadruped + arm',adjacent:'Adjacent embodiment',background:'Background',survey:'Survey',locomotion:'Quadruped locomotion'};
  function scoreRelation(a,b,basis='all'){
    if(!a||!b||a.id===b.id)return {score:0,topics:[],platforms:[],coMentions:[]};
    if(!bases.has(basis))basis='all';
    const topics=(basis==='all'||basis==='topic')?overlap(a.subtopics,b.subtopics).filter(t=>!['survey','surveys','review','reviews'].includes(t.toLowerCase())):[];
    const platforms=(basis==='all'||basis==='platform')?overlap(a.platforms,b.platforms):[];
    const other=new Set(array(b.contexts).map(c=>text(c?.text).trim()).filter(Boolean));
    const coMentions=[];const seen=new Set();
    if(basis==='all'||basis==='co-mention')for(const c of array(a.contexts)){const t=text(c?.text).trim();if(t&&other.has(t)&&!seen.has(t)){seen.add(t);coMentions.push({text:t,section:text(c.section)});}}
    return {score:3*topics.length+4*platforms.length+5*coMentions.length,topics,platforms,coMentions};
  }
  function buildNeighborhood(papers,seedId,options={}){
    const all=array(papers).filter(p=>p&&typeof p.id==='string'),seed=all.find(p=>p.id===seedId);
    if(!seed)return {seed:null,nodes:[],edges:[],total:0};
    const basis=bases.has(options.basis)?options.basis:'all',scope=scopes.has(options.scope)?options.scope:'',limit=Math.max(1,Math.min(24,Number(options.limit)||22));
    const ranked=all.filter(p=>p.id!==seed.id&&(!scope||p.scope===scope)).map(p=>({paper:p,relation:scoreRelation(seed,p,basis)})).filter(x=>x.relation.score>0).sort((a,b)=>b.relation.score-a.relation.score||text(a.paper.title).localeCompare(text(b.paper.title))||a.paper.id.localeCompare(b.paper.id));
    const nodes=[{paper:seed,relation:null},...ranked.slice(0,limit)];
    const edges=nodes.slice(1).map(n=>({from:seed.id,to:n.paper.id,relation:n.relation,seedEdge:true}));
    const secondary=[];for(let i=1;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const relation=scoreRelation(nodes[i].paper,nodes[j].paper,basis);if(relation.score)secondary.push({from:nodes[i].paper.id,to:nodes[j].paper.id,relation,seedEdge:false});}
    secondary.sort((a,b)=>b.relation.score-a.relation.score||a.from.localeCompare(b.from)||a.to.localeCompare(b.to));
    edges.push(...secondary.slice(0,24));return {seed,nodes,edges,total:ranked.length};
  }
  function mount({element,getPapers,onOpenPaper}){
    if(!element||typeof getPapers!=='function'||typeof onOpenPaper!=='function')throw Error('PaperGraph requires element, getPapers, and onOpenPaper.');
    const d=element.ownerDocument,svgNS='http://www.w3.org/2000/svg';let params=new URLSearchParams(),graph=null,lastGraphKey='',selected='',zoom=1,pan={x:0,y:0},currentPositions=new Map(),drag=null;
    const el=(tag,content,parent,cls)=>{const n=d.createElement(tag);if(content!==undefined)n.textContent=content;if(cls)n.className=cls;if(parent)parent.append(n);return n;};
    const sv=(tag,attrs,parent)=>{const n=d.createElementNS(svgNS,tag);Object.entries(attrs||{}).forEach(([k,v])=>n.setAttribute(k,String(v)));if(parent)parent.append(n);return n;};
    element.replaceChildren();element.classList.add('paper-graph');
    const heading=el('div',undefined,element,'pg-heading');el('p','RESEARCH CONNECTIONS',heading,'pg-eyebrow');el('h1','Find the next paper to read',heading);el('p','Explore shared research topics, robot platforms, and co-mentions in this review. These connections are not citation links or a measure of paper quality.',heading,'pg-intro');
    const controls=el('div',undefined,element,'pg-controls');const searchWrap=el('div',undefined,controls,'pg-search-wrap');const searchLabel=el('label','Find a starting paper',searchWrap);const search=el('input',undefined,searchLabel);search.type='search';search.placeholder='Search title, author, or paper ID';search.autocomplete='off';search.setAttribute('aria-controls','pg-search-results');
    const results=el('div',undefined,searchWrap,'pg-search-results');results.id='pg-search-results';results.hidden=true;
    function selectControl(label,items){const l=el('label',label,controls),s=el('select',undefined,l);for(const [value,label] of items){const o=el('option',label,s);o.value=value;}return s;}
    const basis=selectControl('Connect by',[['all','All relationships'],['topic','Shared research topic'],['platform','Shared robot platform'],['co-mention','Same review paragraph']]);
    const scope=selectControl('Nearby paper scope',[['','All scopes'],...Object.entries(scopeNames)]);
    const summary=el('p','',element,'pg-summary');summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');
    const body=el('div',undefined,element,'pg-body'),stage=el('div',undefined,body,'pg-stage'),aside=el('aside',undefined,body,'pg-detail');aside.setAttribute('aria-label','Selected paper and connection evidence');
    const toolbar=el('div',undefined,stage,'pg-toolbar');
    const button=(label,parent,fn,cls)=>{const b=el('button',label,parent,cls);b.type='button';b.addEventListener('click',fn);return b;};
    button('＋',toolbar,()=>changeZoom(1.2)).setAttribute('aria-label','Zoom in');button('−',toolbar,()=>changeZoom(1/1.2)).setAttribute('aria-label','Zoom out');button('Reset view',toolbar,reset);el('span','Drag to pan · Ctrl/⌘ + scroll to zoom',toolbar,'pg-pan-help');
    const svg=sv('svg',{viewBox:'0 0 1000 650',role:'group','aria-label':'Paper relationship network. Use the paper list below for keyboard navigation.'},stage);
    const viewport=sv('g',{},svg),edgeGroup=sv('g',{},viewport),nodeGroup=sv('g',{},viewport);
    const empty=el('p','',stage,'pg-network-empty');empty.hidden=true;
    const legend=el('div',undefined,stage,'pg-legend');el('span','Large node: starting paper',legend);el('span','Edges: shared catalog evidence',legend);for(const [key,label] of Object.entries(scopeNames))el('span',label,legend,'pg-color-key scope-'+key);
    const explainer=el('details',undefined,element,'pg-explainer');el('summary','How are these connections chosen?',explainer);el('p','A shared research subtopic adds 3 points (generic survey/review tags are excluded), an exact shared robot-platform label adds 4, and an identical review paragraph adds 5. The selected relation filter controls which evidence counts. Up to 22 nearby papers (12 on small screens) are shown by score, with title as a tie-breaker; up to 24 additional links show relationships among them. The starting paper is retained even when a scope filter excludes its scope. Layout and node size do not represent citation counts.',explainer);el('p','Co-mention means the catalog stores the same paragraph for both papers. It does not imply that either paper cites the other. Missing catalog metadata can hide real connections. Imported papers can connect through their supplied topics or platforms, but are not assigned review co-mentions.',explainer);
    const listSection=el('section',undefined,element,'pg-list-section');el('h2','Papers in this view',listSection);const paperList=el('div',undefined,listSection,'pg-paper-list');
    function navigate(seed,extra={}){const next=new URLSearchParams(params);next.set('seed',seed);for(const [k,v] of Object.entries(extra)){if(v)next.set(k,v);else next.delete(k);}const hash='#graph?'+next.toString();if(root.location.hash===hash)show(next);else root.location.hash=hash;}
    function searchPapers(){results.replaceChildren();const q=normalize(search.value).trim();if(!q){results.hidden=true;return;}const words=q.split(/\s+/),matches=array(getPapers()).filter(p=>words.every(w=>normalize([p.title,p.authors,p.id,p.arxiv].join(' ')).includes(w)));results.hidden=false;el('p',matches.length?Math.min(matches.length,10)+' of '+matches.length+' matches':'No papers found. Try a shorter title, author, or ID.',results,'pg-search-count');for(const p of matches.slice(0,10)){const b=button(p.title+' · '+(p.year||'Year unknown')+' · '+p.id,results,()=>{search.value='';results.hidden=true;navigate(p.id);});b.className='pg-search-result';}}
    search.addEventListener('input',searchPapers);search.addEventListener('keydown',e=>{if(e.key==='Escape')results.hidden=true;if(e.key==='ArrowDown'){const first=results.querySelector('button');if(first){e.preventDefault();first.focus();}}});basis.addEventListener('change',()=>navigate(params.get('seed')||graph?.seed?.id||'',{basis:basis.value}));scope.addEventListener('change',()=>navigate(params.get('seed')||graph?.seed?.id||'',{scope:scope.value}));
    function transform(){svg.classList.toggle('is-zoomed',zoom>1.5);viewport.setAttribute('transform','translate('+(500+pan.x)+' '+(325+pan.y)+') scale('+zoom+') translate(-500 -325)');}
    function changeZoom(factor){zoom=Math.max(.45,Math.min(3.5,zoom*factor));transform();}
    function reset(){zoom=1;pan={x:0,y:0};transform();}
    function point(e){const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const matrix=svg.getScreenCTM();return matrix?p.matrixTransform(matrix.inverse()):{x:e.clientX,y:e.clientY};}
    svg.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest?.('[data-node]'))return;const p=point(e);drag={id:e.pointerId,x:p.x,y:p.y,px:pan.x,py:pan.y};svg.setPointerCapture(e.pointerId);svg.classList.add('is-panning');});
    svg.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const p=point(e);pan={x:drag.px+p.x-drag.x,y:drag.py+p.y-drag.y};transform();});
    function stopDrag(e){if(drag&&e.pointerId===drag.id){drag=null;svg.classList.remove('is-panning');}}
    svg.addEventListener('pointerup',stopDrag);svg.addEventListener('pointercancel',stopDrag);svg.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();changeZoom(Math.exp(-e.deltaY*.004));}},{passive:false});
    function layout(nodes){
      const positions=new Map();if(!nodes.length)return positions;
      positions.set(nodes[0].paper.id,{x:500,y:325});
      nodes.slice(1).forEach((n,i)=>{const a=i*2.399963-1.1,r=75+42*Math.sqrt(i+1);positions.set(n.paper.id,{x:500+1.45*r*Math.cos(a),y:325+r*Math.sin(a)});});
      for(let pass=0;pass<240;pass++){
        const forces=new Map(nodes.map(n=>[n.paper.id,{x:0,y:0}]));
        for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
          const a=positions.get(nodes[i].paper.id),b=positions.get(nodes[j].paper.id);let dx=a.x-b.x,dy=a.y-b.y,d=Math.max(1,Math.hypot(dx,dy));
          let f=1900/(d*d);const gap=Math.hypot(dx/148,dy/92);if(gap<1)f+=(1-gap)*10;
          forces.get(nodes[i].paper.id).x+=dx/d*f;forces.get(nodes[i].paper.id).y+=dy/d*f;
          forces.get(nodes[j].paper.id).x-=dx/d*f;forces.get(nodes[j].paper.id).y-=dy/d*f;
        }
        for(const e of graph.edges){const a=positions.get(e.from),b=positions.get(e.to),dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy));const target=e.seedEdge?220:170;const f=(d-target)*.008;forces.get(e.from).x+=dx/d*f;forces.get(e.from).y+=dy/d*f;forces.get(e.to).x-=dx/d*f;forces.get(e.to).y-=dy/d*f;}
        nodes.slice(1).forEach(n=>{const p=positions.get(n.paper.id),f=forces.get(n.paper.id);p.x=Math.max(110,Math.min(890,p.x+f.x*.85+(500-p.x)*.0008));p.y=Math.max(60,Math.min(575,p.y+f.y*.85+(325-p.y)*.0008));});
      }
      return positions;
    }
    function reasonSummary(r){return [r.topics.length?'Topic: '+r.topics.map(name).join(', '):'',r.platforms.length?'Platform: '+r.platforms.join(', '):'',r.coMentions.length?r.coMentions.length+' shared review paragraph'+(r.coMentions.length===1?'':'s'):''].filter(Boolean).join(' · ');}
    function renderDetail(){aside.replaceChildren();const node=graph?.nodes.find(n=>n.paper.id===selected);if(!node)return;const p=node.paper,isSeed=p.id===graph.seed.id;el('p',isSeed?'STARTING PAPER':'SELECTED CONNECTION',aside,'pg-eyebrow');el('span',(p.year||'Year unknown')+' · '+(scopeNames[p.scope]||'Unclassified'),aside,'pg-detail-meta');el('h2',p.title,aside);el('p',p.authors?p.authors.split('; ').slice(0,5).join('; ')+(p.authors.split('; ').length>5?'; et al.':''):'Authors not provided',aside,'pg-authors');el('p',p.id+(p.localImported?' · Browser-local import':p.origin==='published-import'?' · Independent library addition':''),aside,'pg-detail-id');const links=el('div',undefined,aside,'pg-detail-actions');button('Open paper ↗',links,()=>onOpenPaper(p.id),'pg-primary');if(!isSeed)button('Make starting paper',links,()=>navigate(p.id));
      el('h3',isSeed?'Reading this map':'Why this paper is connected',aside);if(isSeed){el('p','Choose a nearby paper to see the exact topics, platform labels, and review paragraphs connecting it to this starting paper.',aside);}else{const r=node.relation;el('p','Relationship score '+r.score+' · for the selected filter only',aside,'pg-score');if(r.topics.length){el('h4','Shared research subtopics',aside);el('p',r.topics.map(name).join(' · '),aside);}if(r.platforms.length){el('h4','Shared platform labels',aside);el('p',r.platforms.join(' · '),aside);}if(r.coMentions.length){el('h4','Same review paragraphs',aside);for(const c of r.coMentions){const box=el('details',undefined,aside,'pg-context');el('summary',c.section||'Review passage',box);el('p',c.text,box);}}}
      if(p.localImported||p.origin==='published-import')el('p','Imported metadata is user supplied. Connections do not verify the underlying claims.',aside,'pg-import-note');
    }
    function select(id){selected=id;for(const g of nodeGroup.children){g.classList.toggle('is-selected',g.dataset.node===id);g.setAttribute('aria-pressed',String(g.dataset.node===id));}for(const b of paperList.querySelectorAll('button')){const active=b.dataset.select===id;b.setAttribute('aria-pressed',String(active));}for(const line of edgeGroup.children)line.classList.toggle('is-highlighted',id!==graph.seed.id&&(line.dataset.from===id||line.dataset.to===id));renderDetail();}
    function render(){edgeGroup.replaceChildren();nodeGroup.replaceChildren();paperList.replaceChildren();aside.replaceChildren();reset();if(!graph.seed){summary.textContent='The selected paper is not available in this library.';empty.textContent='Search above to choose a starting paper.';empty.hidden=false;return;}const n=graph.nodes.length-1;summary.textContent='Starting from '+graph.seed.title+' · Showing '+n+' of '+graph.total+' connected papers.';empty.hidden=n>0;empty.textContent='No nearby papers match these filters. Try another relationship or scope; missing metadata does not mean the paper is unrelated.';currentPositions=layout(graph.nodes);
      for(const e of graph.edges){const a=currentPositions.get(e.from),b=currentPositions.get(e.to);const line=sv('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:e.seedEdge?'pg-edge pg-seed-edge':'pg-edge pg-secondary-edge'},edgeGroup);line.dataset.from=e.from;line.dataset.to=e.to;const title=sv('title',{},line);title.textContent=reasonSummary(e.relation);}
      for(const [i,node] of graph.nodes.entries()){const p=node.paper,pos=currentPositions.get(p.id);const g=sv('g',{transform:'translate('+pos.x+' '+pos.y+')',class:'pg-node scope-'+(scopes.has(p.scope)?p.scope:'background')+(i===0?' pg-seed':''),role:'button',tabindex:0,'aria-label':p.title+(i===0?', starting paper':', '+reasonSummary(node.relation))},nodeGroup);g.dataset.node=p.id;sv('circle',{r:root.matchMedia?.('(max-width:760px)').matches?55:25,class:'pg-hit'},g);sv('circle',{r:i===0?20:9+Math.min(5,node.relation.score/6)},g);const title=sv('title',{},g);title.textContent=p.title;const year=sv('text',{x:0,y:i===0?-33:-24,'text-anchor':'middle',class:'pg-node-year'},g);year.textContent=p.year||'Unknown year';const label=sv('text',{x:0,y:i===0?42:34,'text-anchor':'middle',class:'pg-node-label'},g);const prefix=p.title.split(':')[0],words=p.title.split(/\s+/),short=prefix.length<24?prefix:words.slice(0,3).join(' ');label.textContent=short.length>26?short.slice(0,24)+'…':short+(short!==prefix&&words.length>3?'…':'');g.addEventListener('click',()=>select(p.id));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(p.id);}});const b=button('',paperList,()=>select(p.id),'pg-list-paper');b.dataset.select=p.id;el('span',i===0?'Starting paper':reasonSummary(node.relation),b,'pg-list-reason');el('strong',p.title,b);el('span',(p.year||'Year unknown')+' · '+p.id,b,'pg-list-meta');}
      select(graph.seed.id);
    }
    function show(input){params=new URLSearchParams(input||'');const all=array(getPapers());if(!params.has('seed'))params.set('seed',all.some(p=>p.id==='L260408508')?'L260408508':all[0]?.id||'');if(!bases.has(params.get('basis')))params.set('basis','all');if(!scopes.has(params.get('scope')))params.delete('scope');basis.value=params.get('basis');scope.value=params.get('scope')||'';results.hidden=true;const limit=root.matchMedia?.('(max-width:760px)').matches?12:22;const key=[params.get('seed'),basis.value,scope.value,limit].join('|');if(graph&&key===lastGraphKey)return;lastGraphKey=key;graph=buildNeighborhood(all,params.get('seed'),{basis:basis.value,scope:scope.value,limit});render();}
    return {show,invalidate:()=>{graph=null;show(params);}};
  }
  const api={mount,scoreRelation,buildNeighborhood};root.PaperGraph=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
