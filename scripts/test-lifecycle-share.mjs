import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let signedIn=true, allowed=true;
let upload={ownerId:'owner',status:'ready',mediaType:'video',deletedAt:null};
const events=[];
const analytics=[];
const exports={};
const source=fs.readFileSync('src/routes/api/recordings.$id.shared.ts','utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports, URL,
 require(name){
  if(name==='@tanstack/react-router')return {createFileRoute:()=>x=>x};
  if(name==='cloudflare:workers')return {env:{DB:{}}};
  if(name==='@/lib/api.server')return {json:(body,status=200)=>Response.json(body,{status})};
  if(name==='@/lib/recordings.server')return {ownedUpload:async()=>upload,userApi:async(_r,fn)=>signedIn?fn({sub:'owner'}):new Response(null,{status:401})};
  if(name==='@/lib/rate-limit.server')return {allow:async()=>allowed};
  if(name==='@/lib/lifecycle-events.server')return {recordLifecycleEvent:async(_db,id,event)=>events.push({id,event})};
  if(name==='@/lib/posthog.server')return {captureServer:(event,id)=>analytics.push({id,event})};
  throw Error(name);
 }
});
const post=(origin='https://vertov.app')=>exports.Route.server.handlers.POST({params:{id:'video'},request:new Request('https://vertov.app/api/recordings/video/shared',{method:'POST',headers:origin?{origin}:{}})});
signedIn=false;assert.equal((await post()).status,401);signedIn=true;
assert.equal((await post('https://other.example')).status,403);
assert.equal((await post('')).status,403);
upload={...upload,ownerId:'other'};assert.equal((await post()).status,404);
upload={...upload,ownerId:'owner',status:'recording'};assert.equal((await post()).status,404);
upload={...upload,status:'ready',mediaType:'image'};assert.equal((await post()).status,404);
upload={...upload,mediaType:'video',deletedAt:'2026-11-21'};assert.equal((await post()).status,404);
upload={...upload,deletedAt:null};allowed=false;assert.equal((await post()).status,429);allowed=true;
assert.equal(events.length,0);
assert.equal(analytics.length,0);
assert.equal((await post()).status,200);
assert.deepEqual(events,[{id:'owner',event:'shared'}]);
assert.deepEqual(analytics,[{id:'owner',event:'recording_share_copied'}]);
console.log('PASS authenticated same-origin owner-only ready-video sharing-intent endpoint, deleted/image rejection, bounded rate limit and fixed event type');
