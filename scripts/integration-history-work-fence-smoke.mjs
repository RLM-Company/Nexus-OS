#!/usr/bin/env node
import { ts } from './offline-typescript.mjs';
/** Owner isolation and durable Work queue fence on real migrated SQLite, offline. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo=resolve(import.meta.dirname,'..');
const dir=mkdtempSync(join(tmpdir(),'kosmora-history-fence-'));
const emit=(file,dst)=>{
  const text=readFileSync(join(repo,file),'utf8');
  const p=join(dir,dst);mkdirSync(resolve(p,'..'),{recursive:true});
  writeFileSync(p,ts.transpileModule(text,{fileName:file,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
};
try{
  writeFileSync(join(dir,'package.json'),'{"type":"module"}');
  for(const name of ['project-memory-store','work-runtime-store','project-store'])
    writeFileSync(join(dir,name+'.js'),`export class ${{'project-memory-store':'ProjectMemoryStore','work-runtime-store':'WorkRuntimeStore','project-store':'ProjectStore'}[name]} { constructor(){} }`);
  emit('packages/db/src/chat-history-search-store.ts','history.js');
  emit('packages/db/src/manager-work-store.ts','manager-work-store.js');
  const {ChatHistorySearchStore}=await import(pathToFileURL(join(dir,'history.js')));
  const {ManagerWorkStore}=await import(pathToFileURL(join(dir,'manager-work-store.js')));
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  const journal=JSON.parse(readFileSync(join(repo,'packages/db/migrations/meta/_journal.json'),'utf8'));
  for(const entry of journal.entries){
    for(const stmt of readFileSync(join(repo,'packages/db/migrations',entry.tag+'.sql'),'utf8').split('--> statement-breakpoint'))
      if(stmt.trim())sql.exec(stmt);
  }
  const at='2026-10-09T00:00:00.000Z';
  for(const owner of ['alice','bob']){
    const id='p-'+owner;
    sql.prepare('INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,owner,'Спутник проект','ACTIVE',at,at);
    sql.prepare('INSERT INTO chats(id,project_id,kind,created_at) VALUES(?,?,?,?)').run('c-'+owner,id,'main',at);
    sql.prepare('INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run('g-'+owner,owner,'Спутник личный',at,at);
    sql.prepare(`INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run('gm-'+owner,'g-'+owner,owner,'user','text','Описание орбиты Спутник','completed',at,at);
    sql.prepare(`INSERT INTO messages(id,project_id,chat_id,role,content_type,content,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run('pm-'+owner,id,'c-'+owner,'user','text','Спутник тестовый запуск','completed',at,at);
  }
  const search=new ChatHistorySearchStore(sql);
  const a=search.search({ownerId:'alice',query:'Спутник',archive:'all'});
  assert.equal(a.items.length,4);
  assert(a.items.every(hit=>!hit.chat_id.endsWith('-bob')));
  const onlyGeneral=search.search({ownerId:'alice',query:'Спутник',scope:'general',archive:'all'});
  assert.equal(onlyGeneral.items.length,2);
  const onlyProject=search.search({ownerId:'alice',query:'Спутник',projectId:'p-alice',archive:'all'});
  assert.equal(onlyProject.items.length,2);
  assert.equal(search.search({ownerId:'alice',query:'Спутник',projectId:'p-bob'}).items.length,0);
  assert.deepEqual(search.search({ownerId:'alice',query:'" OR *',archive:'all'}).items,[]);
  console.log('PASS FTS history: title/message, project filter, literal escaping, other-owner isolation');
  const work=new ManagerWorkStore(sql);
  assert.equal(work.ownerWritable('alice'),true);
  sql.prepare('INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('alice',1,'quiescing','privacy-export',at,at);
  assert.equal(work.ownerWritable('alice'),false);
  assert.equal(work.ownerWritable('bob'),true);
  sql.prepare("UPDATE kosmora_owner_data_lifecycle SET state='active' WHERE owner_id='alice'").run();
  assert.equal(work.ownerWritable('alice'),true);
  sql.prepare("UPDATE kosmora_owner_data_lifecycle SET state='deleted' WHERE owner_id='alice'").run();
  assert.equal(work.ownerWritable('alice'),false);
  console.log('PASS Work queue: durable quiesce, resume, delete fence; other owner allowed');
  assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  sql.close();
}finally{rmSync(dir,{recursive:true,force:true});}
