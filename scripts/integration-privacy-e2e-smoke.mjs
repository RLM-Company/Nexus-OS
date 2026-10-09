#!/usr/bin/env node
import { ts } from './offline-typescript.mjs';
/** A complete owner export/delete lifecycle on real SQLite plus actual store adapters (workers inert). */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..');const temp=mkdtempSync(join(tmpdir(),'kosmora-privacy-e2e-'));
const emit=(source,target)=>{
 const out=ts.transpileModule(readFileSync(resolve(root,source),'utf8'),{fileName:source,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const p=join(temp,target);mkdirSync(resolve(p,'..'),{recursive:true});writeFileSync(p,out);
};
const load=target=>import(pathToFileURL(join(temp,target)));
try{
 writeFileSync(join(temp,'package.json'),'{"type":"module"}');
 for(const [src,dst] of [
 ['apps/api/src/account-settings/account-store.ts','account-store.js'],
 ['apps/api/src/account-settings/migration.ts','migration.js'],
 ['apps/api/src/account-settings/privacy/archive.ts','privacy/archive.js'],
 ['apps/api/src/account-settings/privacy/coordinator.ts','privacy/coordinator.js'],
 ['apps/api/src/account-settings/privacy/account-core-adapter.ts','privacy/account-core-adapter.js'],
 ['apps/api/src/account-settings/privacy/integrated-adapters.ts','privacy/integrated-adapters.js'],
 ['packages/db/src/document-library-store.ts','document-library-store.js'],
 ['packages/db/src/document-answer-store.ts','document-answer-store.js']
 ])emit(src,dst);
 const {AccountStore}=await load('account-store.js');
 const {DocumentLibraryStore}=await load('document-library-store.js');
 const {DocumentAnswerStore}=await load('document-answer-store.js');
 const {OwnerPrivacyCoordinator}=await load('privacy/coordinator.js');
 const {AccountCorePrivacyAdapter}=await load('privacy/account-core-adapter.js');
 const {DocumentsPrivacyAdapter,WorkPrivacyAdapter,ResearchIntegratedPrivacyAdapter,
  MediaIntegratedPrivacyAdapter,CodeIntegratedPrivacyAdapter,AgentStudioPrivacyAdapter,
  PolicyProjectsPrivacyAdapter}=await load('privacy/integrated-adapters.js');
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const entry of JSON.parse(readFileSync(resolve(root,'packages/db/migrations/meta/_journal.json'))).entries){
   for(const stmt of readFileSync(resolve(root,'packages/db/migrations',entry.tag+'.sql'),'utf8').split('--> statement-breakpoint'))
     if(stmt.trim())sql.exec(stmt);
 }
 const now=new Date().toISOString();
 for(const [id,owner] of [['project-alice','alice'],['project-bob','bob']])
   sql.prepare('INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,owner,'Test','active',now,now);
 const library=new DocumentLibraryStore(sql);const answers=new DocumentAnswerStore(sql);
 const original=Buffer.from('Текст оригинального файла.','utf8');
 const staged=library.stage('project-alice','alice','original.txt',original);
 library.complete('project-alice','alice',staged.id,[{page:null,text:original.toString('utf8')}],[{ordinal:0,page:null,line_start:1,line_end:1,content:original.toString('utf8')}]);
 library.stage('project-bob','bob','other.txt',Buffer.from('Other'));
 assert.equal(library.list('project-alice','alice').length,1);
 assert.throws(()=>library.list('project-alice','bob'),/NOT_FOUND/);
 assert.equal(library.search('project-alice','alice',['текст'],[staged.id]).length,1);
 assert.deepEqual(library.original('project-alice','alice',staged.id).bytes,original);
 assert.throws(()=>library.search('project-alice','bob',['текст'],[staged.id]),/NOT_FOUND/);
 console.log('PASS root library FTS, original bytes and cross-owner isolation');
 sql.prepare('INSERT INTO chats(id,project_id,kind,created_at) VALUES(?,?,?,?)').run('chat-a','project-alice','main',now);
 sql.prepare('INSERT INTO runs(id,project_id,chat_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)')
   .run('run-a','project-alice','chat-a','succeeded',now,now);
 sql.prepare(`INSERT INTO model_usage_ledger(usage_id,run_id,project_id,attempt,status,registry_version,provider_id,
   model_requested,estimated_input_tokens,max_output_tokens,actual_input_tokens,actual_output_tokens,calculated_cost_amount,currency,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('ledger-a','run-a','project-alice',1,'committed','r1','provider','model',120,80,12,19,0.003,'USD',now,now);
 const account=new AccountStore(sql);
 // Crash-window hold from the SAME committed canonical run must survive deletion
 // without charging its 200-token reserved bound a second time.
 const shadowHold=account.reserve('alice','run-a',1,200,'main','project-alice','provider','model');
 account.uncertainReservation(shadowHold,'main');
 const reservation=account.reserve('alice','unknown-for-deletion',1,55,'main','project-alice','provider','model');
 account.uncertainReservation(reservation,'main');
 assert.equal(account.summary('alice').total_counted_tokens,31+55);
 const privacy=new OwnerPrivacyCoordinator(sql);
 privacy.register(new AccountCorePrivacyAdapter(sql,async()=>{}));
 const documents=new DocumentsPrivacyAdapter(sql,library,answers,{quiesce:async()=>{},resume:()=>{}});
 privacy.register(documents);
 let workQuiesced=0,workResumed=0;
 privacy.register(new WorkPrivacyAdapter(sql,{quiesceOwner:async()=>{workQuiesced++;},resumeOwner:()=>{workResumed++;}}));
 let fenced=false;
 privacy.register(new ResearchIntegratedPrivacyAdapter(sql,{list:()=>[],isFenced:()=>fenced,unfence:()=>{fenced=false;},deleteOwner:()=>0},()=>({quiesce:async()=>{fenced=true;}})));
 privacy.register(new MediaIntegratedPrivacyAdapter({storageReady:()=>true,quiesce:async()=>{},resume:()=>{},list:()=>[],deleteOwner:async()=>({deleted_jobs:0})}));
 privacy.register(new CodeIntegratedPrivacyAdapter(sql,{quiesceOwner:async()=>{}}));
 privacy.register(new AgentStudioPrivacyAdapter(sql));
 privacy.register(new PolicyProjectsPrivacyAdapter(sql));
 assert.equal(privacy.overview('alice').ready,true);
 // A descriptor mismatch MUST abort the entire archive and release owner export fences.
 const canonicalRead=documents.readBinary.bind(documents);
 documents.readBinary=async(owner,id)=>{
   const result=await canonicalRead(owner,id);
   return result?{...result,original:{...result.original,content_type:'application/corrupt'}}:null;
 };
 await assert.rejects(privacy.exportArchive('alice'),/Original changed during snapshot/);
 assert.equal(privacy.overview('alice').lifecycle,'active');
 documents.readBinary=canonicalRead;
 console.log('PASS archive rejects changed binary metadata; non-destructive fence released');
 const buffer=await privacy.exportArchive('alice');
 const magic=buffer.readUInt32LE(0);assert.equal(magic,0x04034b50);
 const names=[];let offset=0;
 while(buffer.readUInt32LE(offset)===0x04034b50){
  const size=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28);
  const start=offset+30+nameLength+extra;
  names.push({name:buffer.subarray(offset+30,offset+30+nameLength).toString(),bytes:buffer.subarray(start,start+size)});
  offset=start+size;
 }
 const manifest=JSON.parse(names.find(x=>x.name==='manifest.json').bytes.toString());
 assert.equal(manifest.complete,true);assert.equal(manifest.original_count,1);
 assert.deepEqual(names.find(x=>x.name==='originals/documents/00000.bin').bytes,original);
 assert.equal(manifest.archive_originals[0].sha256,createHash('sha256').update(original).digest('hex'));
 assert.equal(privacy.overview('alice').lifecycle,'active');
 assert.equal(workQuiesced,2);assert.equal(workResumed,2);
 console.log('PASS complete ZIP export with original and manifest under quiesce');
 const challenge=account.createDeleteChallenge('alice');
 const result=await privacy.delete('alice',challenge.confirmation_token,challenge.required_phrase);
 assert.equal(result.deleted,true);
 assert.equal(privacy.overview('alice').lifecycle,'deleted');
 assert.equal(sql.prepare("SELECT count(*) n FROM projects WHERE owner_id='alice'").get().n,0);
 assert.equal(sql.prepare("SELECT count(*) n FROM document_library_files WHERE owner_id='alice'").get().n,0);
 assert.equal(sql.prepare("SELECT count(*) n FROM projects WHERE owner_id='bob'").get().n,1);
 assert.equal(sql.prepare('SELECT status FROM kosmora_usage_holds WHERE id=?').get(reservation).status,'uncertain');
 assert.equal(sql.prepare('SELECT status FROM kosmora_usage_holds WHERE id=?').get(shadowHold).status,'uncertain');
 assert.equal(account.summary('alice').total_counted_tokens,31+55);
 assert.equal(sql.prepare("SELECT count(*) n FROM kosmora_retained_accounting WHERE owner_id='alice' AND usage_id='ledger-a'").get().n,1);
 assert.throws(()=>library.stage('project-bob','alice','bad.txt',Buffer.from('X')),/NOT_FOUND/);
 console.log('PASS confirmed owner deletion (retained usage without duplicate hold, auth/ledger/other owner intact, late writes denied)');
 sql.close();
}finally{rmSync(temp,{recursive:true,force:true});}
