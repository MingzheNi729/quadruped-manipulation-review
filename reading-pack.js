/* Portable reading lists and a dependency-free ZIP pack; PDFs download locally. */
(function(root){
'use strict';
const string=v=>String(v??'');
function url(v){try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function csvCell(v){let s=string(v);if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function manifest(papers){return {schemaVersion:1,exportedAt:new Date().toISOString(),papers:papers.map(p=>({id:p.id,title:p.title,authors:p.authors,year:p.year,scope:p.scope,platforms:p.platforms||[],arms:p.arms||[],url:url(p.url),pdf:url(p.pdf),doi:p.doi||'',arxiv:p.arxiv||'',version:p.version||'',code:(p.resources?.code||[]).map(x=>url(x.url)).filter(Boolean),projects:(p.resources?.projects||[]).map(x=>url(x.url)).filter(Boolean)}))};}
function csv(papers){const rows=manifest(papers).papers;return '\uFEFF'+[['ID','Title','Authors','Year','Scope','Robot platforms','Manipulators','Paper URL','PDF URL','DOI','arXiv','Version','Code repositories','Project pages'],...rows.map(p=>[p.id,p.title,p.authors,p.year,p.scope,p.platforms.join(' | '),p.arms.join(' | '),p.url,p.pdf,p.doi,p.arxiv,p.version,p.code.join(' | '),p.projects.join(' | ')])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';}
function bib(papers){return papers.map(p=>string(p.bib).trim()).filter(Boolean).join('\n\n')+'\n';}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(data){let crc=0xffffffff;for(const b of data)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function zip(files){const encoder=new TextEncoder(),parts=[],directory=[];let offset=0;
 for(const [name,content] of Object.entries(files)){
  if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw Error('Invalid ZIP filename');
  const filename=encoder.encode(name),bytes=typeof content==='string'?encoder.encode(content):content,crc=crc32(bytes);
  const head=new Uint8Array(30+filename.length),v=new DataView(head.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,filename.length,true);head.set(filename,30);parts.push(head,bytes);
  const central=new Uint8Array(46+filename.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);central.set(filename,46);directory.push(central);offset+=head.length+bytes.length;
 }
 const length=directory.reduce((n,x)=>n+x.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,directory.length,true);v.setUint16(10,directory.length,true);v.setUint32(12,length,true);v.setUint32(16,offset,true);parts.push(...directory,end);const all=new Uint8Array(offset+length+22);let n=0;for(const p of parts){all.set(p,n);n+=p.length;}return all;
}
function instructions(count){return `LEGGED & ARMED — READING PACK\n\n${count} selected papers. This ZIP contains the list and a downloader, not the PDFs.\n\n1. Extract ALL files into one folder.\n2. Install Python 3 if it is not already available. No extra packages are required.\n3. Open a terminal in that folder and run:\n\n   macOS / Linux: python3 download_papers.py\n   Windows:       py -3 download_papers.py\n\nPDFs are saved in pdfs/ next to the script. The downloader skips valid PDFs already there, retries transient failures, and writes a CSV download log. Run it again to retry unfinished items. Missing PDF links and blocked/failed downloads are logged; use the paper URLs in papers.csv for manual access. Only publicly accessible HTTPS PDFs are downloaded; no account credentials or paywall bypass are used.\n\nContents:\n  papers.csv          Spreadsheet-friendly reading list and resource links\n  references.bib      Bibliography for Zotero / LaTeX\n  papers.json         Metadata and PDF links used by the downloader\n  download_papers.py  Local Python 3 download script\n  README.txt          These instructions\n\nCollections saved on the website remain local to that browser. This exported list is a portable copy; it does not automatically synchronize favorites or modify the review.\n`;}
function save(content,name,type){const address=URL.createObjectURL(new Blob([content],{type})),a=root.document.createElement('a');a.href=address;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(address),30000);}
function init({getSaved,getFiltered}){
 const d=root.document,el=(tag,text,parent)=>{const n=d.createElement(tag);if(text!==undefined)n.textContent=text;if(parent)parent.append(n);return n;};
 const dialog=el('dialog',undefined,d.body);dialog.className='reading-pack-dialog';dialog.setAttribute('aria-labelledby','reading-pack-title');el('h2','Export a reading list',dialog).id='reading-pack-title';el('p','Saved papers stay in this browser. Export a portable list or a pack for downloading the available PDFs on your computer.',dialog);
 const label=el('label','Which papers?',dialog),select=el('select',undefined,label);select.id='reading-pack-scope';for(const [v,t] of [['saved','All saved papers'],['filtered','Current filtered results']]){const o=el('option',t,select);o.value=v;}
 const summary=el('p','',dialog);summary.setAttribute('role','status');summary.id='reading-pack-summary';const actions=el('div',undefined,dialog);actions.className='reading-pack-actions';let selected=[];
 const button=(label,fn)=>{const b=el('button',label,actions);b.type='button';b.addEventListener('click',fn);return b;};
 const csvButton=button('Download CSV list',()=>save(csv(selected),'reading-list-'+selected.length+'.csv','text/csv;charset=utf-8'));
 const bibButton=button('Download BibTeX',()=>save(bib(selected),'reading-list-'+selected.length+'.bib','application/x-bibtex;charset=utf-8'));
 const zipButton=button('Download reading pack (.zip)',async()=>{
  const snapshot=selected.slice();if(!snapshot.length)return;zipButton.disabled=true;select.disabled=true;status.textContent='Preparing your reading pack…';
  try{const response=await fetch('assets/download_papers.py');if(!response.ok)throw Error('Could not load the downloader. Please retry.');const script=await response.text();if(!script.includes('import ')||script.startsWith('<'))throw Error('Invalid downloader response. Please refresh.');const files={'papers.csv':csv(snapshot),'references.bib':bib(snapshot),'papers.json':JSON.stringify(manifest(snapshot),null,2),'download_papers.py':script,'README.txt':instructions(snapshot.length)};save(zip(files),'reading-pack-'+snapshot.length+'.zip','application/zip');status.textContent='Pack ready. Extract it, then follow README.txt to download the PDFs.';}catch(e){status.textContent=e.message;}finally{select.disabled=false;update();}
 });
 const help=el('div',undefined,dialog);help.className='reading-pack-help';el('strong','How bulk PDF download works',help);el('p','The pack contains the list and a Python script—not the PDFs. Extract it and run the command below. Available PDFs go into pdfs/; existing valid files are skipped and failures are logged.',help);el('code','python3 download_papers.py',help);el('p','Windows: py -3 download_papers.py. Python 3 is required; no extra packages are needed.',help);
 const status=el('p','',dialog);status.setAttribute('role','status');status.className='reading-pack-status';button('Close',()=>dialog.close());
 function update(){selected=(select.value==='saved'?getSaved():getFiltered()).slice();const pdfs=selected.filter(p=>url(p.pdf)).length;summary.textContent=`${selected.length} papers · ${pdfs} PDF links · ${selected.length-pdfs} without a PDF link`;for(const b of [csvButton,bibButton,zipButton])b.disabled=!selected.length;}
 select.addEventListener('change',()=>{status.textContent='';update();});
 return {open:()=>{select.value='saved';status.textContent='';update();dialog.showModal();}};
}
const api={init,manifest,csv,bib,zip,instructions};root.ReadingPack=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
