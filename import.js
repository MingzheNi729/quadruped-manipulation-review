/* Browser-local bibliography import. No network calls or dependencies. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'la-imported-papers';
  const MAX_BYTES = 2 * 1024 * 1024, MAX_RECORDS = 500, MAX_LOCAL = 1000;
  const plain = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const compact = value => plain(value).replace(/\s+/g, ' ');
  const titleKey = value => compact(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const byteSize = value => new TextEncoder().encode(value).length;
  function safeURL(value) {
    try { const u = new URL(plain(value)); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
  }
  function doiKey(value) { return plain(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase(); }
  function arxivKey(value) { return plain(value).replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '').replace(/^arxiv:\s*/i, '').replace(/\.pdf$/i, '').replace(/v\d+$/i, ''); }
  const validArxiv = value => /^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]+(?:\.[A-Z]{2})?\/\d{7})$/i.test(value);
  function stableID(value) { let h = 14695981039346656037n; for (const c of new TextEncoder().encode(value)) { h ^= BigInt(c); h = BigInt.asUintN(64, h * 1099511628211n); } return 'IMPORT' + h.toString(16).toUpperCase().padStart(16, '0'); }
  function list(value) { return (Array.isArray(value) ? value : []).map(compact).filter(Boolean).slice(0, 40).map(s => s.slice(0, 200)); }
  function texText(value) { return plain(value).replace(/\\(?:&|%|_|#|\$)/g, m => m.slice(1)).replace(/[{}]/g, '').replace(/\s+/g, ' ').trim(); }
  function bibValue(value) { return plain(value).replace(/[\\{}%&#_$]/g, c => ({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','%':'\\%','&':'\\&','#':'\\#','_':'\\_','$':'\\$'}[c])); }
  function makeBib(p) {
    const fields = {title:p.title, author:p.authors.replace(/;\s*/g, ' and '), year:p.year, doi:p.doi, url:p.url};
    if (p.arxiv) { fields.eprint = p.arxiv + p.version; fields.archivePrefix = 'arXiv'; }
    return '@misc{' + p.id + ',\n' + Object.entries(fields).filter(([,v])=>v).map(([k,v])=>'  '+k+' = {'+bibValue(v)+'}').join(',\n') + '\n}';
  }
  // Balanced BibTeX parser: braced/quoted/numeric values, nested braces, and # concatenation.
  // String macros are deliberately not guessed. Unsupported entries produce explicit errors.
  function parseBib(source) {
    let i = 0; const records = [], errors = [], warnings = [];
    function skip() { while (i < source.length) { if (/\s/.test(source[i])) i++; else if(source[i]==='%') { while(i<source.length && source[i]!=='\n') i++; } else break; } }
    function readValue() {
      skip(); const c=source[i]; let out='';
      if(c==='{') { i++; let depth=1; while(i<source.length) { const ch=source[i++]; if(ch==='\\'&&i<source.length){out+=ch+source[i++];continue;} if(ch==='{')depth++; if(ch==='}')depth--; if(!depth)return out; out+=ch; } throw Error('Unclosed braced value'); }
      if(c==='"') { i++; let depth=0; while(i<source.length) { const ch=source[i++]; if(ch==='\\'&&i<source.length){out+=ch+source[i++];continue;} if(ch==='{')depth++; if(ch==='}')depth--; if(ch==='"'&&depth===0)return out; if(depth<0)throw Error('Unbalanced quoted value'); out+=ch; } throw Error('Unclosed quoted value'); }
      const m=/^[^\s,#}\)]+/.exec(source.slice(i)); if(!m)throw Error('Missing field value'); i+=m[0].length;
      if(/^\d+$/.test(m[0]))return m[0];
      const months={jan:'January',feb:'February',mar:'March',apr:'April',may:'May',jun:'June',jul:'July',aug:'August',sep:'September',oct:'October',nov:'November',dec:'December'};
      if(months[m[0].toLowerCase()])return months[m[0].toLowerCase()];
      throw Error('Unsupported bare value or string macro: '+m[0].slice(0,60));
    }
    while(i<source.length) {
      skip(); if(i===source.length)break;
      if(source[i]!=='@') { errors.push('Unexpected text near character '+(i+1)+'. Use BibTeX entries or JSON.'); const next=source.indexOf('@',i+1); if(next<0)break; i=next; }
      const start=i++; const type=/^[a-z]+/i.exec(source.slice(i)); if(!type){errors.push('Invalid entry at character '+(start+1));continue;} i+=type[0].length; skip();
      const open=source[i],close=open==='{'?'}':')'; if(open!=='{'&&open!=='('){errors.push('Expected entry delimiter at character '+(i+1));continue;} i++;
      if(/^(comment|string|preamble)$/i.test(type[0])) { let depth=1,quote=false; while(i<source.length&&depth){const c=source[i++];if(c==='\\'){i++;continue;}if(c==='"')quote=!quote;if(!quote){if(c===open)depth++;if(c===close)depth--;}} warnings.push('@'+type[0]+' skipped; custom string macros are not resolved.'); continue; }
      try {
        skip(); const km=/^[^,\s{}()]+/.exec(source.slice(i)); if(!km)throw Error('Missing citation key'); const record=Object.create(null);record.sourceId=km[0];i+=km[0].length;skip();if(source[i++]!==',')throw Error('Missing comma after citation key');
        while(i<source.length){skip();if(source[i]===close){i++;records.push(record);break;}if(source[i]===','){i++;continue;}const fm=/^[a-z][a-z0-9_-]*/i.exec(source.slice(i));if(!fm)throw Error('Invalid field name');i+=fm[0].length;skip();if(source[i++]!=='=')throw Error('Missing = after '+fm[0]);let value=readValue();skip();while(source[i]==='#'){i++;value+=readValue();skip();}const field=fm[0].toLowerCase();if(Object.hasOwn(record,field))warnings.push('Duplicate field '+field+' in '+record.sourceId+'; last value used.');record[field]=value;if(source[i]!==','&&source[i]!==close)throw Error('Missing field separator');}
        if(source[i-1]!==close)throw Error('Unclosed entry');
      } catch(e) { errors.push('Entry near character '+(start+1)+': '+e.message);const next=source.indexOf('@',i);i=next<0?source.length:next; }
      if(records.length>MAX_RECORDS)throw Error('Import at most '+MAX_RECORDS+' records at a time.');
    }
    return {records,errors,warnings};
  }
  function normalizeRecord(raw, warnings) {
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Each paper must be a JSON object.');
    const title=texText(raw.title); if(!title)throw Error('A title is required.'); if(title.length>2000)throw Error('Title exceeds 2,000 characters.');
    const authors=Array.isArray(raw.authors)?raw.authors.map(compact).filter(Boolean).join('; '):texText(raw.authors||raw.author).replace(/\s+and\s+/g,'; ');
    const possibleDoiURL=/^https:\/\/(?:dx\.)?doi\.org\//i.test(plain(raw.url))?raw.url:'';const rawDoi=doiKey(raw.doi||possibleDoiURL);let doi=/^10\.\d{4,9}\/[^\s<>"{}]+$/i.test(rawDoi)?rawDoi:'';if(rawDoi&&!doi)warnings.push(title+': invalid DOI omitted.');
    const rawArxiv=plain(raw.arxiv||raw.arxiv_id||(!raw.archivePrefix&&!raw.archiveprefix||String(raw.archivePrefix||raw.archiveprefix).toLowerCase()==='arxiv'?raw.eprint:''));
    let arxiv=arxivKey(rawArxiv);if(arxiv&&!validArxiv(arxiv)){warnings.push(title+': invalid arXiv ID omitted.');arxiv='';}
    let version=plain(raw.version)||(rawArxiv.match(/(v\d+)(?:\.pdf)?$/i)||[])[1]||'';if(version&&!/^v?\d+$/.test(version)){warnings.push(title+': invalid version omitted.');version='';}if(version)version='v'+version.replace(/^v/,'');
    const rawURL=plain(raw.url||raw.paper_url), rawPDF=plain(raw.pdf||raw.pdf_url);let url=safeURL(rawURL),pdf=safeURL(rawPDF);if(rawURL&&!url)warnings.push(title+': non-HTTPS or invalid source URL omitted.');if(rawPDF&&!pdf)warnings.push(title+': non-HTTPS or invalid PDF URL omitted.');
    if(!arxiv&&url){const u=new URL(url);if(u.hostname==='arxiv.org'){const m=u.pathname.match(/^\/(?:abs|pdf)\/(.+)$/);if(m&&validArxiv(arxivKey(m[1]))){arxiv=arxivKey(m[1]);version=(m[1].match(/(v\d+)(?:\.pdf)?$/)||[])[1]||version;}}}
    if(!url)url=arxiv?'https://arxiv.org/abs/'+arxiv+version:doi?'https://doi.org/'+encodeURI(doi):'';
    if(!pdf&&arxiv)pdf='https://arxiv.org/pdf/'+arxiv+version;
    const id=stableID(doi?'doi:'+doi:arxiv?'arxiv:'+arxiv:'title:'+titleKey(title));
    const p={id,number:null,title,authors:authors.slice(0,12000),year:/^\d{4}$/.test(plain(raw.year))?plain(raw.year):'',scope:['direct','adjacent','background','survey','locomotion'].includes(raw.scope)?raw.scope:'background',depth:'metadata',topics:list(raw.topics),subtopics:list(raw.subtopics),facets:[...new Set(['Local import',...list(raw.facets)])],platforms:list(raw.platforms),arms:list(raw.arms),setting:['hardware','simulation','mixed'].includes(raw.setting)?raw.setting:'not_recorded',hardwareEvidence:plain(raw.hardwareEvidence).slice(0,5000),hardwareSource:safeURL(raw.hardwareSource),url,pdf,arxiv,version,doi,abstract:plain(raw.abstract).slice(0,50000),contexts:[],versionNote:'User-imported metadata; not independently verified or cited in the review.',verification:'User supplied; not independently verified.',localImported:true,origin:'browser-local',sourceId:plain(raw.sourceId||raw.id).slice(0,200)};
    const resourceList=(value,code)=> (Array.isArray(value)?value:[]).slice(0,20).filter(x=>x&&typeof x==='object'&&safeURL(x.url)).map(x=>({url:safeURL(x.url),label:compact(x.label).slice(0,300)||'User-supplied link',source:safeURL(x.source),...(code?{license:'',reportedLicense:compact(x.reportedLicense||x.license).slice(0,300),openSource:false}:{}),verification:'User supplied; not independently verified.'}));
    p.resources={code:resourceList(raw.resources?.code,true),projects:resourceList(raw.resources?.projects,false)};
    if(raw.overview&&safeURL(raw.overview.src))p.overview={src:safeURL(raw.overview.src),caption:plain(raw.overview.caption).slice(0,2000),source:safeURL(raw.overview.source),page:Number.isInteger(raw.overview.page)&&raw.overview.page>0?raw.overview.page:null,figureLabel:compact(raw.overview.figureLabel).slice(0,100),alt:plain(raw.overview.alt).slice(0,1000)||'User-supplied paper overview'};
    p.bib=makeBib(p);p.search=titleKey([p.title,p.authors].join(' '));return p;
  }
  function tokens(p) { return [p.id&&'id:'+p.id,p.sourceId&&'id:'+p.sourceId,p.doi&&'doi:'+doiKey(p.doi),(p.arxiv||p.arxiv_id)&&'arxiv:'+arxivKey(p.arxiv||p.arxiv_id),p.title&&'title:'+titleKey(p.title)].filter(Boolean); }
  function classify(records, existing=[]) { const index=new Map();existing.forEach(p=>tokens(p).forEach(t=>index.set(t,p)));const accepted=[],duplicates=[];for(const p of records){const hit=tokens(p).map(t=>index.get(t)).find(Boolean);if(hit){duplicates.push({paper:p,existing:hit.id||hit.title});continue;}accepted.push(p);tokens(p).forEach(t=>index.set(t,p));}return {accepted,duplicates}; }
  function parse(source,existing=[]) {
    if(typeof source!=='string'||byteSize(source)>MAX_BYTES)throw Error('Use a file or pasted text smaller than 2 MB.');source=source.replace(/^\uFEFF/,'').trim();if(!source)throw Error('Paste BibTeX or JSON first.');
    let raw,errors=[],warnings=[];
    if(/^[\[{]/.test(source)){let value;try{value=JSON.parse(source);}catch(e){throw Error('Invalid JSON: '+e.message);}if(Array.isArray(value))raw=value;else if(value&&Array.isArray(value.papers)){if(value.schemaVersion!==undefined&&value.schemaVersion!==1)throw Error('Unsupported backup schema version.');raw=value.papers;}else if(value&&value.title)raw=[value];else throw Error('JSON must be a paper, an array, or {schemaVersion:1,papers:[…]}.');}
    else{const result=parseBib(source);raw=result.records;errors=result.errors;warnings=result.warnings;}
    if(raw.length>MAX_RECORDS)throw Error('Import at most '+MAX_RECORDS+' records at a time.');
    const records=[];raw.forEach((r,i)=>{try{records.push(normalizeRecord(r,warnings));}catch(e){errors.push('Record '+(i+1)+': '+e.message);}});return {...classify(records,existing),records,errors,warnings};
  }
  function init(options) {
    if(!options||typeof options.getPapers!=='function'||typeof options.onChange!=='function')throw Error('getPapers and onChange callbacks are required.');
    let local=[],preview=null;const d=root.document;const el=(tag,text,parent)=>{const n=d.createElement(tag);if(text!==undefined)n.textContent=text;if(parent)parent.append(n);return n;};
    const dialog=el('dialog');dialog.setAttribute('aria-labelledby','library-import-title');dialog.style.cssText='width:min(760px,92vw);max-height:90vh;overflow:auto;padding:24px;border:1px solid #aaa;border-radius:12px;color:#18201d;background:#fff';
    const title=el('h2','Import papers',dialog);title.id='library-import-title';dialog.classList.add('import-dialog');el('p','Add BibTeX or JSON to this browser only. Imports are unverified library additions, separate from the review. No data is uploaded.',dialog);
    const guide=el('a','Import formats & shared-site publishing guide ↗',dialog);guide.href='https://github.com/MingzheNi729/quadruped-manipulation-review/blob/main/IMPORT.md';guide.target='_blank';guide.rel='noopener noreferrer';guide.className='import-guide';
    const label=el('label','Paste BibTeX or JSON',dialog);const area=el('textarea',undefined,label);area.rows=8;area.style.cssText='display:block;width:100%;box-sizing:border-box;margin:8px 0;font:14px monospace';area.maxLength=MAX_BYTES;
    const fileLabel=el('label','Or choose a .bib or .json file (up to 2 MB): ',dialog);const file=el('input',undefined,fileLabel);file.type='file';file.accept='.bib,.json,application/json,text/plain';
    const actions=el('div',undefined,dialog);actions.style.cssText='display:flex;gap:10px;flex-wrap:wrap;margin:16px 0';const button=(text,parent,fn)=>{const b=el('button',text,parent);b.type='button';b.addEventListener('click',fn);return b;};
    const status=el('p','',dialog);status.setAttribute('role','status');status.setAttribute('aria-live','polite');const result=el('div',undefined,dialog);result.style.overflowWrap='anywhere';
    const managed=el('details',undefined,dialog);el('summary','Manage browser-local papers',managed);const managedList=el('div',undefined,managed);
    function notify(){options.onChange(local.map(p=>({...p})));}
    function save(next){if(next.length>MAX_LOCAL)throw Error('This browser collection is limited to '+MAX_LOCAL+' papers. Export a backup, then remove some records.');const encoded=JSON.stringify({schemaVersion:1,papers:next});if(byteSize(encoded)>4*1024*1024)throw Error('Local collection exceeds 4 MB. Export a backup and remove some records.');try{root.localStorage.setItem(STORAGE_KEY,encoded);}catch{throw Error('Browser storage is unavailable or full. Nothing was changed.');}local=next;notify();renderManaged();}
    function renderManaged(){managedList.replaceChildren();el('p',local.length+' local papers. Removing a paper here does not change the published library.',managedList);for(const p of local){const row=el('div',undefined,managedList);row.style.cssText='display:flex;gap:12px;align-items:center;margin:8px 0';el('span',p.title,row);button('Remove',row,()=>{try{save(local.filter(x=>x.id!==p.id));status.textContent='Removed '+p.title;invalidate();}catch(e){status.textContent=e.message;}});} }
    function invalidate(){preview=null;apply.disabled=true;result.replaceChildren();}
    button('Preview import',actions,()=>{try{preview=parse(area.value,[...options.getPapers(),...local]);result.replaceChildren();status.textContent=preview.accepted.length+' ready to add · '+preview.duplicates.length+' duplicates skipped · '+preview.errors.length+' errors.';for(const [heading,items] of [['Ready to add',preview.accepted.map(p=>p.title+' — '+(p.authors||'Authors not provided')+' ('+(p.year||'year unknown')+') · '+p.scope+' · '+p.id+(p.url?' · '+p.url:''))],['Duplicates',preview.duplicates.map(x=>x.paper.title+' → '+x.existing)],['Errors',preview.errors],['Notes',preview.warnings]]){if(!items.length)continue;el('h3',heading,result);const ul=el('ul',undefined,result);items.forEach(v=>el('li',v,ul));}apply.disabled=!preview.accepted.length;}catch(e){invalidate();status.textContent=e.message;}});
    const apply=button('Add previewed papers',actions,()=>{if(!preview)return;try{const fresh=classify(preview.accepted,[...options.getPapers(),...local]);save([...local,...fresh.accepted]);status.textContent='Added '+fresh.accepted.length+' papers to this browser. Export a backup to keep a portable copy.';invalidate();area.value='';file.value='';}catch(e){status.textContent=e.message;}});apply.disabled=true;
    button('Export local JSON backup',actions,()=>{const blob=new Blob([JSON.stringify({schemaVersion:1,papers:local},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download='legged-armed-local-papers.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Exported '+local.length+' local papers.';});
    button('Close',actions,()=>dialog.close());d.body.append(dialog);
    const launcher=options.mount?button('Import papers',options.mount,()=>dialog.showModal()):null;if(launcher)launcher.dataset.libraryImport='open';
    area.addEventListener('input',invalidate);file.addEventListener('change',async()=>{invalidate();const selected=file.files[0];if(!selected)return;if(selected.size>MAX_BYTES){status.textContent='File exceeds 2 MB.';file.value='';return;}try{area.value=await selected.text();status.textContent='File loaded. Select Preview import before adding papers.';}catch{status.textContent='Could not read this file.';}});
    try { const saved=root.localStorage.getItem(STORAGE_KEY);if(saved){if(byteSize(saved)>4*1024*1024)throw Error('Saved collection exceeds the storage limit.');const value=JSON.parse(saved);if(!Array.isArray(value)&&value.schemaVersion!==1)throw Error('Unsupported saved schema version.');const raw=Array.isArray(value)?value:value.papers;if(!Array.isArray(raw)||raw.length>MAX_LOCAL)throw Error('Invalid saved collection.');const normalized=[];for(const r of raw)normalized.push(normalizeRecord(r,[]));local=classify(normalized,options.getPapers().filter(p=>!p.localImported)).accepted;} }catch(e){status.textContent='Saved imports could not be restored: '+e.message+' The stored copy has not been overwritten.';}
    renderManaged();notify();return {open:()=>dialog.showModal(),getLocalPapers:()=>local.map(p=>({...p})),destroy:()=>{dialog.remove();launcher?.remove();}};
  }
  const api={init,parse,normalizeRecord:(r)=>normalizeRecord(r,[]),classify,safeURL,STORAGE_KEY};root.LibraryImport=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
