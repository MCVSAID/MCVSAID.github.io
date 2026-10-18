'use strict';
let csrf='', listing={}, cameras=[], working=false;
const selected=new Set(), samples=new Map(), result=document.querySelector('#result');
function node(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
function bytes(v){return Number.isFinite(v)?`${(v/1073741824).toFixed(2)} GiB`:'unknown';}
async function api(path,body){const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.detail||`HTTP ${r.status}`);return d;}
const activityLine=document.querySelector('#activity');
function gib(v){return v<1073741824?`${Math.round(v/1048576)} MiB`:`${(v/1073741824).toFixed(2)} GiB`;}
function span(seconds){if(!Number.isFinite(seconds))return 'unknown';const m=Math.ceil(seconds/60);return m>=60?`${Math.floor(m/60)} h ${m%60} min`:`${m} min`;}
async function operation(fn,label='Request'){if(working)return;working=true;const started=Date.now();
 activityLine.hidden=false;activityLine.className='activity running';activityLine.replaceChildren(document.createElement('progress'),node('span',`${label}: working…`));
 let failed=null;try{result.textContent=JSON.stringify(await fn(),null,2);}catch(e){failed=e.message;result.textContent=e.message;}
 finally{working=false;activityLine.className=`activity ${failed?'failed':'done'}`;activityLine.replaceChildren(node('span',`${label}: ${failed?`failed — ${failed}`:'sent'} (${new Date().toLocaleTimeString()}, ${((Date.now()-started)/1000).toFixed(1)} s)`));await refresh();}}
async function enter(session){csrf=session.csrf;document.querySelector('#password').value='';document.querySelector('#login').hidden=true;document.querySelector('#offload').hidden=false;window.concert.session=session;window.concert.nav(session.role);window.concert.tabs(document.querySelector('#recordings-tabs'),window.concert.recordingTabs,'/offload');await refresh();setInterval(refresh,2000);}
document.querySelector('#login').onsubmit=async e=>{e.preventDefault();try{await enter(await api('/api/login',{password:document.querySelector('#password').value}));}catch(e){result.textContent=e.message;}};
window.concert.resume().then(session=>{if(session)enter(session);});
function button(label,fn){const b=node('button',label);b.onclick=()=>operation(fn,label);return b;}
async function batch(action,filter){const outcomes=[];for(const j of listing.jobs.filter(filter)){try{outcomes.push(await api(`/api/offload/jobs/${encodeURIComponent(j.id)}/${action}`,{}));}catch(e){outcomes.push({job:j.id,error:e.message});}}return outcomes;}
function enqueue(records){return api('/api/offload/enqueue',{recordings:records.map(r=>({camera:r.camera,id:r.id}))});}
document.querySelector('#window').onclick=async ()=>{const minutes=Number(document.querySelector('#window-minutes').value);if(await concert.sure(`Confirm OBS production recording is stopped. Transfers may use camera Wi-Fi for the next ${minutes} minutes; close the window before recording again.`))operation(()=>api('/api/offload/window',{obs_recording_idle:true,minutes}),'Open offload window');};
document.querySelector('#library-form').onsubmit=e=>{e.preventDefault();const path=document.querySelector('#library-path').value;operation(async()=>{const saved=await api('/api/offload/library',{path});document.querySelector('#library-path').value=saved.library;return saved;},'Save folder');};
document.querySelector('#relocate').onclick=async ()=>{if(await concert.sure('Move every verified copy that is outside this folder into it, under its camera subfolder?'))operation(()=>api('/api/offload/library/relocate',{}),'Move existing copies');};
document.querySelector('#close-window').onclick=()=>operation(()=>api('/api/offload/window/close',{}),'Close offload window');
document.querySelector('#scan').onclick=()=>operation(()=>api('/api/offload/scan',{}),'Scan all cameras');
document.querySelector('#selected').onclick=()=>operation(()=>enqueue(listing.recordings.filter(r=>selected.has(`${r.camera}/${r.id}`))),'Queue selected recordings');
document.querySelector('#all').onclick=()=>operation(()=>enqueue(listing.recordings),'Queue all completed recordings');
for(const [id,action,filter] of [['pause','pause',j=>['UPLOADING','QUEUED'].includes(j.state)],['resume','resume',j=>j.state==='PAUSED'],['retry','retry',j=>j.state==='FAILED'],['verify','verify',j=>j.offset===JSON.parse(j.metadata).byte_count]])document.querySelector('#'+id).onclick=()=>operation(()=>batch(action,filter),document.querySelector('#'+id).textContent);
document.querySelector('#approve').onclick=async ()=>{if(await concert.sure('Approve deletion of selected verified originals? A second verified backup is recommended.'))operation(()=>batch('approve',j=>selected.has(`${j.camera}/${j.recording}`)&&j.state==='VERIFIED'),'Approve cleanup');};
// Test footage nobody wants: deleted on the camera with no copy made. Only recordings that have not been copied.
document.querySelector('#discard').onclick=async()=>{
 const uncopied=r=>!listing.jobs.some(j=>j.camera===r.camera&&j.recording===r.id&&['VERIFIED','DISCARDED'].includes(j.state));
 const chosen=listing.recordings.filter(r=>selected.has(`${r.camera}/${r.id}`)),doomed=chosen.filter(uncopied);
 if(!doomed.length){concert.tell(chosen.length?'Every selected recording has already been copied. Use Approve Cleanup for those.':'Tick the recordings to delete first.');return;}
 const name=r=>`${cameras.find(c=>c.id===r.camera)?.name||r.camera.slice(0,8)}: ${JSON.parse(r.metadata).filename}`;
 const total=doomed.reduce((n,r)=>n+JSON.parse(r.metadata).byte_count,0);
 const got=await concert.ask({title:'Delete from the cameras without copying',text:`DELETE ${doomed.length} recording${doomed.length===1?'':'s'} (${gib(total)}) from the cameras WITHOUT copying?\n\n${doomed.slice(0,12).map(r=>'  • '+name(r)).join('\n')}${doomed.length>12?`\n  … and ${doomed.length-12} more`:''}\n\nNo copy exists anywhere. This cannot be undone.${chosen.length>doomed.length?`\n(${chosen.length-doomed.length} selected recording(s) already copied are left alone.)`:''}\n\nType DELETE to go ahead.`,fields:[{name:'word',label:'Type DELETE to go ahead'}],ok:'Delete',danger:true});
 const typed=got?got.word:null;
 if(typed!=='DELETE'){if(typed!==null)concert.tell('Nothing deleted: the word typed was not DELETE.');return;}
 operation(()=>api('/api/offload/discard',{confirm:'DELETE',recordings:doomed.map(r=>({camera:r.camera,id:r.id}))}),'Delete from cameras without copying');};
document.querySelector('#cleanup').onclick=async ()=>{if(await concert.sure('Delete ONLY explicitly approved, verified originals from their cameras?'))operation(()=>batch('cleanup',j=>j.cleanup==='APPROVED'),'Clean verified originals');};
async function refresh(){if(!csrf)return;try{
 listing=await api('/api/offload');const data=await api('/api/cameras');cameras=data.cameras;
 document.querySelector('#capacity').textContent=`Destination: ${bytes(listing.destination.free_bytes)} free / ${bytes(listing.destination.total_bytes)} · Window ${listing.offload_window_until*1000>Date.now()?`open until ${new Date(listing.offload_window_until*1000).toLocaleTimeString()}`:'closed'} · Cleanup ${listing.cleanup_enabled?'enabled':'disabled'}`;
 const field=document.querySelector('#library-path');if(document.activeElement!==field)field.value=listing.destination.root;
 const outside=listing.jobs.filter(j=>j.state==='VERIFIED'&&!(j.library_path||'').startsWith(listing.destination.root+'/')).length;
 document.querySelector('#relocate').hidden=!outside;document.querySelector('#relocate').textContent=`Move ${outside} existing cop${outside===1?'y':'ies'} here`;
 document.querySelector('#library-example').textContent=`${listing.destination.root}/${(cameras.find(c=>c.name)?.name||'Camera-1').replace(/[^A-Za-z0-9._-]+/g,'_')}/`;
 const grid=document.querySelector('#devices');grid.replaceChildren();
 for(let slot=1;slot<=data.camera_capacity;slot++){const c=cameras.find(c=>c.slot===slot);const card=node('article','');card.append(node('h2',c?.name||`Camera ${slot} — not paired`));if(c){card.append(node('p',`${c.online?'Online':'Offline'} · ${bytes(c.storage?.free_bytes)} free / ${bytes(c.storage?.total_bytes)} total`));
 const t=c.telemetry||{},mine=listing.jobs.filter(j=>j.camera===c.id),waiting=mine.filter(j=>['QUEUED','UPLOADING'].includes(j.state)).length,deleting=mine.filter(j=>j.cleanup==='REQUESTED').length,scanning=(listing.scans||[]).includes(c.id),pending=waiting||deleting||scanning;
 const capturing=t.recording||t.streaming||t.capture?.streamRequested,windowOpen=listing.offload_window_until*1000>Date.now();
 const blocker=!c.online?'camera is offline':t.locked_since_boot?'phone needs its screen lock entered once after restarting':capturing?'camera is streaming or recording':!windowOpen?'offload window is closed':null;
 const doing=node('p','');doing.className=`activity ${pending&&blocker?'failed':pending?'running':''}`;
 if(pending&&!blocker)doing.append(document.createElement('progress'));
 doing.append(node('span',pending&&blocker?`Waiting: ${blocker}. Pending: ${[waiting&&`${waiting} transfer(s)`,deleting&&`${deleting} cleanup(s)`,scanning&&'scan'].filter(Boolean).join(', ')}.`:`Camera reports: ${(t.offload_status==='Hashing finalized recordings'&&listing.scans&&!scanning)?'Idle (last scan finished)':t.offload_status||'no offload status'}${pending?` · pending: ${[waiting&&`${waiting} transfer(s)`,deleting&&`${deleting} cleanup(s)`,scanning&&'scan'].filter(Boolean).join(', ')}`:''}`));
 card.append(doing);card.append(button('Scan camera',()=>api('/api/offload/scan',{camera_ids:[c.id]})),button('Offload completed',()=>enqueue(listing.recordings.filter(r=>r.camera===c.id))),button('Pause camera transfers',()=>batch('pause',j=>j.camera===c.id&&['UPLOADING','QUEUED'].includes(j.state))));
 card.append(button('Resume camera transfers',()=>batch('resume',j=>j.camera===c.id&&j.state==='PAUSED')),
 button('Retry camera failures',()=>batch('retry',j=>j.camera===c.id&&j.state==='FAILED')),
 button('Verify camera files',()=>batch('verify',j=>j.camera===c.id&&j.offset===JSON.parse(j.metadata).byte_count)));
 const approve=button('Approve selected camera cleanup',async ()=>await concert.sure(`Approve deletion of selected verified originals on ${c.name}? A second verified backup is recommended.`)?batch('approve',j=>j.camera===c.id&&selected.has(`${j.camera}/${j.recording}`)&&j.state==='VERIFIED'):{cancelled:true});
 const cleanup=button('Clean approved camera originals',async ()=>await concert.sure(`Delete explicitly approved originals on ${c.name}?`)?batch('cleanup',j=>j.camera===c.id&&j.cleanup==='APPROVED'):{cancelled:true});
 approve.disabled=!listing.cleanup_enabled;cleanup.disabled=!listing.cleanup_enabled;card.append(approve,cleanup);
 }grid.append(card);}
 const recordings=document.querySelector('#recordings');recordings.replaceChildren();
 for(const error of listing.scan_errors||[])recordings.append(node('p',`${error.camera} / ${error.recording}: ${error.error}`));
 const size=list=>gib(list.reduce((n,x)=>n+JSON.parse(x.metadata).byte_count,0));
 const jobFor=r=>listing.jobs.find(j=>j.camera===r.camera&&j.recording===r.id&&j.state!=='CANCELLED');
 const standing=r=>{const j=jobFor(r);return !j?'only on camera':j.state==='DISCARDED'?(j.cleanup==='FAILED'?'DELETE WITHOUT COPY FAILED':'being deleted from camera, not copied'):j.state==='FAILED'?'copy failed':j.state==='PAUSED'?'copy paused':j.state==='VERIFIED'?(j.cleanup==='REQUESTED'?'copied · deletion requested':j.cleanup==='APPROVED'?'copied · cleanup approved':'copied and verified'):'copying';};
 // Forget ticks for recordings that are no longer listed, so the count stays true.
 const listed=new Set(listing.recordings.map(r=>`${r.camera}/${r.id}`));for(const key of [...selected])if(!listed.has(key))selected.delete(key);
 if(listing.recordings.length){const all=node('label','');all.className='select-all';const box=document.createElement('input');box.type='checkbox';box.id='select-all';
  box.checked=selected.size===listed.size;box.indeterminate=selected.size>0&&selected.size<listed.size;
  box.onchange=()=>{if(box.checked)for(const key of listed)selected.add(key);else selected.clear();refresh();};
  all.append(box,node('span',`Select all ${listed.size} · ${selected.size} selected${selected.size?` (${size(listing.recordings.filter(r=>selected.has(`${r.camera}/${r.id}`)))})`:''}`));recordings.append(all);}
 for(const r of listing.recordings){const m=JSON.parse(r.metadata);const label=node('label','');const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(`${r.camera}/${r.id}`);check.onchange=()=>{check.checked?selected.add(`${r.camera}/${r.id}`):selected.delete(`${r.camera}/${r.id}`);refresh();};label.append(check,node('span',`${cameras.find(c=>c.id===r.camera)?.name||r.camera}: ${m.filename} · ${bytes(m.byte_count)} · ${(m.duration_ms/1000).toFixed(1)}s · ${standing(r)}`));recordings.append(label);}
 // One plain summary of where things stand and which button comes next.
 const open=listing.offload_window_until*1000>Date.now(),lines=[];
 const uncopied=listing.recordings.filter(r=>!jobFor(r)),moving=listing.jobs.filter(j=>['QUEUED','UPLOADING'].includes(j.state)),failedJobs=listing.jobs.filter(j=>j.state==='FAILED'),paused=listing.jobs.filter(j=>j.state==='PAUSED');
 const kept=listing.jobs.filter(j=>j.state==='VERIFIED'&&!['REQUESTED','DELETED'].includes(j.cleanup)&&listing.recordings.some(r=>r.camera===j.camera&&r.id===j.recording)),approved=kept.filter(j=>j.cleanup==='APPROVED'),deleting=listing.jobs.filter(j=>j.cleanup==='REQUESTED');
 if(moving.length)lines.push(open?`Copying ${moving.length} recording(s) from the cameras (${size(moving)}). Progress is under Transfer jobs.`:`${moving.length} recording(s) are queued but the offload window is closed. Press “Open offload window”.`);
 if(uncopied.length)lines.push(`${uncopied.length} recording(s) (${size(uncopied)}) are only on the cameras. Press “Offload All Completed Recordings”, or tick some and press “Offload Selected Recordings”.`);
 if(failedJobs.length)lines.push(`${failedJobs.length} copy(ies) failed. Press “Retry Failed Transfers”.`);
 if(paused.length)lines.push(`${paused.length} copy(ies) are paused. Press “Resume Transfers”.`);
 if(deleting.length)lines.push(open?`${deleting.length} original(s) are waiting for their camera to delete them.`:`${deleting.length} deletion(s) are waiting, but the offload window is closed. Press “Open offload window”.`);
 if(kept.length)lines.push(!listing.cleanup_enabled?`${kept.length} recording(s) (${size(kept)}) are copied and verified; their originals are still on the cameras (cleanup is switched off).`:approved.length===kept.length?`${kept.length} verified original(s) (${size(kept)}) are approved for deletion. Press “Clean Verified Originals”.`:`${kept.length} recording(s) (${size(kept)}) are copied and verified; their originals still take space on the cameras. To free it: tick them under Available recordings, press “Approve Cleanup”, then “Clean Verified Originals”.`);
 if(!lines.length)lines.push(listing.recordings.length?'Nothing waiting.':'No recordings are listed on the cameras. Press “Scan All Cameras” to look again.');
 const headline=document.querySelector('#headline');headline.replaceChildren(...lines.map(text=>node('p',text)));headline.className=`activity ${moving.length&&open?'running':failedJobs.length||((moving.length||deleting.length)&&!open)?'failed':''}`;
 const jobs=document.querySelector('#jobs');jobs.replaceChildren();let total=0,sent=0,rate=0,verified=0;for(const j of listing.jobs){const m=JSON.parse(j.metadata), old=samples.get(j.id), now=Date.now();const speed=old&&now>old.time?Math.max(0,j.offset-old.offset)/((now-old.time)/1000):0;samples.set(j.id,{offset:j.offset,time:now});const card=node('article','');const bar=document.createElement('progress');bar.max=m.byte_count;bar.value=j.offset;
 const moving=j.state==='UPLOADING'&&speed>0,checking=j.state==='UPLOADING'&&j.offset===m.byte_count;
 const stage=j.state==='DISCARDED'?(j.cleanup==='DELETED'?'Deleted from camera without copying':j.cleanup==='FAILED'?'Camera refused to delete it':'Waiting for the camera to delete it (not copied)'):j.cleanup==='DELETED'?'Original deleted from camera':j.cleanup==='REQUESTED'?'Waiting for the camera to delete its original':j.cleanup==='APPROVED'?'Verified · cleanup approved, not yet requested':j.state==='VERIFIED'?'Verified':checking?'Uploaded · verifying copy':j.state==='UPLOADING'?`Uploading ${(100*j.offset/m.byte_count).toFixed(1)}%${moving?` · ${(speed/1048576).toFixed(1)} MiB/s · about ${span((m.byte_count-j.offset)/speed)} left`:''}`:j.state==='QUEUED'?'Queued · waiting for the camera':j.state;
 if(j.cleanup==='REQUESTED'||checking)bar.removeAttribute('value');
 card.append(node('h3',m.filename),bar,node('p',`${stage} · ${gib(j.offset)} of ${gib(m.byte_count)}`),node('small',`SHA-256 ${j.destination_hash===m.sha256?'matches':'pending/failed'} · Media ${j.media&&j.state==='VERIFIED'?'passed':'pending/failed'} · Cleanup ${j.cleanup||'not approved'}`));
 if(['QUEUED','UPLOADING','PAUSED'].includes(j.state)){total+=m.byte_count;sent+=j.offset;rate+=speed;}
 if(j.state==='VERIFIED')verified++;if(j.error)card.append(node('p',j.error));if(j.cleanup_result)card.append(node('p',`Cleanup result: ${j.cleanup_result}`));for(const a of ['pause','resume','cancel','retry','verify'])card.append(button(a,()=>api(`/api/offload/jobs/${j.id}/${a}`,{})));jobs.append(card);}
 const summary=document.querySelector('#summary');summary.replaceChildren();
 if(listing.jobs.length){const overall=document.createElement('progress');overall.max=Math.max(total,1);overall.value=total?sent:1;
  summary.append(overall,node('p',`${verified} of ${listing.jobs.length} recordings verified${total?` · ${gib(sent)} of ${gib(total)} uploaded${rate>0?` · ${(rate/1048576).toFixed(1)} MiB/s · about ${span((total-sent)/rate)} left`:' · not moving right now'}`:' · nothing waiting to upload'}`));}
 document.querySelector('#approve').disabled=!listing.cleanup_enabled;document.querySelector('#cleanup').disabled=!listing.cleanup_enabled;document.querySelector('#discard').disabled=!listing.cleanup_enabled;
 }catch(e){result.textContent=e.message;}}
