// Node built-in, deterministic tests for compiled privacy modules. Run after API build:
// node --test apps/api/test/privacy-coordinator.node.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const project = resolve(import.meta.dirname,'../../..');
const {OwnerPrivacyCoordinator,PrivacyIncompleteError,PrivacyUnavailableError} = await import(pathToFileURL(resolve(project,'apps/api/dist/account-settings/privacy/coordinator.js')));
const {AccountCorePrivacyAdapter} = await import(pathToFileURL(resolve(project,'apps/api/dist/account-settings/privacy/account-core-adapter.js')));
const {AccountStore} = await import(pathToFileURL(resolve(project,'apps/api/dist/account-settings/account-store.js')));
const migrations=resolve(project,'packages/db/migrations');
const needed=['documents','work','research','media','code','agent-studio','policy-projects'];
function seeded(options={}){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;');
 for(const filename of readdirSync(migrations).filter(n=>/^\d{4}.*\.sql$/.test(n)&&Number(n.slice(0,4))<=24).sort())db.exec(readFileSync(resolve(migrations,filename),'utf8').replaceAll('--> statement-breakpoint','\n'));
 db.exec(readFileSync(resolve(project,'apps/api/src/account-settings/migration.sql'),'utf8'));
 db.exec(readFileSync(resolve(migrations,'0030_owner_privacy_lifecycle.sql'),'utf8').replaceAll('--> statement-breakpoint','\n'));
 const t='2026-10-09T09:00:00Z';
 for(const owner of ['alice','bob']){
  const c=`chat-${owner}`,p=`project-${owner}`,pc=`pchat-${owner}`;
  db.prepare('INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(c,owner,owner,t,t);
  db.prepare('INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(p,owner,owner,'ACTIVE',t,t);
  db.prepare('INSERT INTO chats(id,project_id,kind,created_at) VALUES(?,?,?,?)').run(pc,p,'default',t);
  db.prepare('INSERT INTO general_chat_runs(id,chat_id,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(`run-${owner}`,c,'succeeded',t,t);
  db.prepare('INSERT INTO runs(id,project_id,chat_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(`prun-${owner}`,p,pc,'COMPLETED',t,t);
  const args=(id,run,where,status,input,output)=>[id,run,where,0,status,'r1','provider','model','model',input,output,null,input,output,null,null,null,t,t];
  db.prepare(`INSERT INTO general_chat_model_usage(usage_id,run_id,chat_id,attempt,status,registry_version,provider_id,model_requested,model_resolved,estimated_input_tokens,max_output_tokens,estimated_cost_amount,actual_input_tokens,actual_output_tokens,calculated_cost_amount,currency,error_code,created_at,updated_at) VALUES(${Array(19).fill('?').join(',')})`).run(...args(`g-${owner}`,`run-${owner}`,c,'committed',11,5));
  db.prepare(`INSERT INTO model_usage_ledger(usage_id,run_id,project_id,attempt,status,registry_version,provider_id,model_requested,model_resolved,estimated_input_tokens,max_output_tokens,estimated_cost_amount,actual_input_tokens,actual_output_tokens,calculated_cost_amount,currency,error_code,created_at,updated_at) VALUES(${Array(19).fill('?').join(',')})`).run(...args(`p-${owner}`,`prun-${owner}`,p,'committed',21,4));
 }
 const account=new AccountStore(db),coordinator=new OwnerPrivacyCoordinator(db,{maxExportBytes:options.maxBytes??20*1024*1024});
 const operations=[];
 coordinator.register(new AccountCorePrivacyAdapter(db,async(owner)=>{operations.push(`stop:${owner}`);}));
 const sections=options.sections??{};
 for(const name of needed){coordinator.register({id:name,async quiesce(owner,epoch){operations.push(`quiesce:${name}:${owner}`);if(options.failQuiesce===name)throw new Error('Cannot drain');return {drained:true,fence_epoch:epoch};},async export(owner){return sections[name]??{records:{items:[{owner,name}]},originals:[],complete:true};},async delete(owner){operations.push(`delete:${name}:${owner}`);if(options.failDelete===name)throw new Error('Deletion failed');return {deleted_records:1};},async readBinary(owner,id){if(id!=='opaque-key'||owner!=='alice')return null;return {original:{id:'opaque-key',filename:'source.pdf',content_type:'application/pdf',size_bytes:3,sha256:'a'.repeat(64)},stream:process.stdin};}});}
 return {db,account,coordinator,operations};
}
function confirmed(account,owner){return account.createDeleteChallenge(owner).confirmation_token;}
const deletion='УДАЛИТЬ МОИ ДАННЫЕ';

test('mandatory unknown stores refuse deletion/export before any mutation',async()=>{
 const ctx=seeded(); const {db,account}=ctx;
 const strict=new OwnerPrivacyCoordinator(db);strict.register(new AccountCorePrivacyAdapter(db,async()=>{}));
 assert.equal(strict.overview('alice').ready,false);assert.deepEqual(strict.overview('alice').missing,needed);
 await assert.rejects(strict.export('alice'),PrivacyUnavailableError);
 await assert.rejects(strict.delete('alice',confirmed(account,'alice'),deletion),PrivacyUnavailableError);
 assert.equal(db.prepare("SELECT count(*) n FROM general_chats WHERE owner_id='alice'").get().n,1);db.close();
});
test('complete owner-isolated export includes correct counts and session-only binary links',async()=>{
 const ctx=seeded({sections:{documents:{records:{documents:[{filename:'alice.md',text:'hello'}]},originals:[{id:'opaque-key',filename:'source.pdf',content_type:'application/pdf',size_bytes:3,sha256:'a'.repeat(64)}],complete:true}}});
 const result=await ctx.coordinator.export('alice');assert.equal(result.complete,true);assert.equal(result.original_count,1);
 assert.equal(result.sections.documents.originals[0].authentication,'owner-session');
 assert.equal(result.sections.documents.originals[0].href,'/api/v1/personal-settings/binaries/documents/opaque-key');
 assert.equal(result.sections['account-core'].records.chats[0].owner_id,'alice');
 assert.equal(result.sections['account-core'].records.chats.length,1);
 assert.equal(result.sections['account-core'].records.project_usage.length,1);
 assert.equal(ctx.coordinator.overview('alice').lifecycle,'active');
 assert.equal((await ctx.coordinator.binary('bob','documents','opaque-key')),null);
 assert.equal((await ctx.coordinator.binary('alice','documents','opaque-key'))?.original.filename,'source.pdf');ctx.db.close();
});
test('refuses incomplete and size-clipped exports without returning partial content',async()=>{
 let ctx=seeded({sections:{research:{records:{},originals:[],complete:false,limitations:['source 42 missing']}}});
 await assert.rejects(ctx.coordinator.export('alice'),PrivacyIncompleteError);assert.equal(ctx.coordinator.overview('alice').lifecycle,'active');ctx.db.close();
 ctx=seeded({maxBytes:100});await assert.rejects(ctx.coordinator.export('alice'),PrivacyIncompleteError);ctx.db.close();
});
test('retains canonical ledger costs and uncertain holds after actual FK cascades; fences late writes',async()=>{
 const {db,account,coordinator,operations}=seeded();
 const before=account.summary('alice').total_counted_tokens;assert.equal(before,41);
 const hold=account.reserve('alice','reservation-a',0,10,'main','chat-alice','p','m');account.uncertainReservation(hold,'main');
 const relay=account.reserve('alice','translation-a',0,6,'to_en','chat-alice','p','m');account.uncertainReservation(relay,'to_en');
 const totalBefore=account.summary('alice').total_counted_tokens;
 const confirmation=confirmed(account,'alice');const result=await coordinator.delete('alice',confirmation,deletion);
 assert.equal(result.deleted,true);assert.equal(result.by_store.documents,1);
 assert.equal(db.prepare("SELECT count(*) n FROM projects WHERE owner_id='alice'").get().n,0);
 assert.equal(db.prepare("SELECT count(*) n FROM general_chats WHERE owner_id='bob'").get().n,1);
 assert.equal(db.prepare("SELECT count(*) n FROM kosmora_retained_accounting WHERE owner_id='alice'").get().n,2);
 assert.equal(db.prepare("SELECT count(*) n FROM kosmora_retained_accounting WHERE owner_id='bob'").get().n,0);
 assert.equal(account.summary('alice').total_counted_tokens,totalBefore);
 assert.equal(db.prepare("SELECT count(*) n FROM kosmora_usage_holds WHERE owner_id='alice'").get().n,1);
 assert.equal(db.prepare("SELECT count(*) n FROM kosmora_relay_usage WHERE owner_id='alice'").get().n,1);
 assert.ok(operations.includes('delete:code:alice'));
 assert.throws(()=>db.prepare('INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('late','alice','late','x','x'),/OWNER_DATA_FENCED/);
 db.prepare('INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('bob-2','bob','allowed','x','x');
 await assert.rejects(coordinator.delete('alice',confirmation,deletion));db.close();
});
test('cascade accounting is retained also on ordinary independent chat/project deletes',()=>{
 const {db,account}=seeded();const before=account.summary('alice').total_counted_tokens;
 db.prepare("DELETE FROM general_chats WHERE owner_id='alice'").run();
 db.prepare("DELETE FROM projects WHERE owner_id='alice'").run();
 assert.equal(account.summary('alice').total_counted_tokens,before);
 assert.equal(db.prepare("SELECT count(*) n FROM kosmora_retained_accounting WHERE owner_id='alice'").get().n,2);db.close();
});
test('quiesce fails closed, preserves owner records and fences late writes',async()=>{
 const {db,account,coordinator}=seeded({failQuiesce:'research'});
 await assert.rejects(coordinator.delete('alice',confirmed(account,'alice'),deletion),/incomplete/i);
 assert.equal(coordinator.overview('alice').lifecycle,'error');
 assert.equal(db.prepare("SELECT count(*) n FROM general_chats WHERE owner_id='alice'").get().n,1);
 assert.throws(()=>db.prepare('INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('late','alice','x','ACTIVE','x','x'),/OWNER_DATA_FENCED/);
 db.close();
});
test('partial error never returns deleted:true, leaves owner fenced, other owners unaffected',async()=>{
 const {db,account,coordinator}=seeded({failDelete:'research'});
 await assert.rejects(coordinator.delete('alice',confirmed(account,'alice'),deletion),/incomplete/i);
 assert.equal(coordinator.overview('alice').lifecycle,'error');
 assert.equal(db.prepare("SELECT count(*) n FROM general_chats WHERE owner_id='bob'").get().n,1);db.close();
});
test('concurrent delayed quiesce fences inserts and does not race destructive cleanup',async()=>{
 const {db,account}=seeded();
 const coordinator=new OwnerPrivacyCoordinator(db,{required:['account-core','core-race']});
 coordinator.register(new AccountCorePrivacyAdapter(db,async()=>{}));
 let unblock=()=>{};
 let began=()=>{};
 const started=new Promise(resolve=>{began=resolve;});
 const pending=new Promise(resolve=>{unblock=resolve;});
 coordinator.register({id:'core-race',async quiesce(owner,epoch){began();await pending;return {drained:true,fence_epoch:epoch};},async export(){return {records:{},originals:[],complete:true};},async delete(owner){return {deleted_records:0};}});
 const deletionPromise=coordinator.delete('alice',confirmed(account,'alice'),deletion);
 await started;
 assert.equal(coordinator.overview('alice').lifecycle,'quiescing');
 assert.throws(()=>db.prepare('INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('not-allowed','alice','x','x','x'),/OWNER_DATA_FENCED/);
 db.prepare('INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('allowed-bob','bob','x','x','x');
 unblock(); const outcome=await deletionPromise;assert.equal(outcome.deleted,true);
 assert.equal(coordinator.overview('alice').lifecycle,'deleted');db.close();
});
test('a reserved unknown canonical amount survives project deletion with upper bound',()=>{
 const {db,account}=seeded();
 db.prepare("UPDATE model_usage_ledger SET status='reserved',actual_input_tokens=NULL,actual_output_tokens=NULL WHERE usage_id='p-alice'").run();
 const upper=account.summary('alice').total_counted_tokens;
 db.prepare("DELETE FROM projects WHERE owner_id='alice'").run();
 assert.equal(account.summary('alice').total_counted_tokens,upper);
 assert.equal(db.prepare("SELECT status FROM kosmora_retained_accounting WHERE usage_id='p-alice'").get().status,'reserved');db.close();
});
test('stored image original is named and hashed, not silently embedded or omitted from export',async()=>{
 const {db,coordinator}=seeded();
 const t='2026-10-09T09:00:00Z';
 const bytes=Buffer.from('89504e470d0a1a0a00000000','hex');
 const image={kind:'image',name:'proof.png',media_type:'image/png',data_base64:bytes.toString('base64')};
 db.prepare(`INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,attachments_json,status,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?)`).run('image-message','chat-alice','alice','user','text','Вложение',JSON.stringify([image]),'completed',t,t);
 const data=await coordinator.export('alice');
 const core=data.sections['account-core'];
 assert.equal(core.originals.length,1);
 assert.equal(core.originals[0].sha256,(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'));
 assert.equal(core.originals[0].href,'/api/v1/personal-settings/binaries/account-core/g%3Aimage-message%3A0');
 const exported=core.records.messages.find(m=>m.id==='image-message');
 assert.ok(exported.attachments_json.includes('original_id'));
 assert.equal(exported.attachments_json.includes(image.data_base64),false);
 const delivered=await coordinator.binary('alice','account-core','g:image-message:0');
 assert.ok(delivered);
 const parts=[];for await(const chunk of delivered.stream)parts.push(chunk);
 assert.deepEqual(Buffer.concat(parts),bytes);
 assert.equal(await coordinator.binary('bob','account-core','g:image-message:0'),null);
 db.close();
});
