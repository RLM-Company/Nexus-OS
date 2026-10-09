#!/usr/bin/env node
/** Explicit offline bridge from the EARLIER unshipped 0030 (without run_id).
 * Reject nonempty retained history: legacy rows have already lost their run IDs,
 * which cannot be reconstructed from original usage_id safely. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, copyFileSync, openSync, fsyncSync, closeSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const argv=process.argv.slice(2);
const param=(name)=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:null;};
const from=param('--database'),to=param('--backup');
if(argv.length!==5||!argv.includes('--apply')||!from||!to){
 console.error('Usage: node scripts/retrofit-retained-accounting.mjs --apply --database /OFFLINE/db.sqlite --backup /SAFE/original.sqlite');
 process.exit(2);
}
const dbfile=resolve(from),backup=resolve(to);
if(dbfile===backup||!existsSync(dbfile)||existsSync(backup)||existsSync(dbfile+'-wal')||existsSync(dbfile+'-shm'))
 throw Error('Offline source required; distinct backup absent; WAL/SHM must not exist');
const source=readFileSync(fileURLToPath(new URL('../packages/db/migrations/0030_owner_privacy_lifecycle.sql',import.meta.url)),'utf8');
const all=source.split('--> statement-breakpoint');
const names=['kosmora_retain_general_usage_before_delete','kosmora_retain_project_usage_before_delete',
 'kosmora_retain_general_on_chat_delete','kosmora_retain_project_on_project_delete'];
const triggers=names.map(name=>{
 const fragment=all.find(part=>new RegExp('CREATE TRIGGER\\s+'+name+'\\b').test(part));
 if(!fragment)throw Error('Missing canonical 0030 trigger '+name);
 return fragment.trim();
});
const db=new DatabaseSync(dbfile);
try{
 db.exec('PRAGMA foreign_keys=ON');
 const present=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kosmora_retained_accounting'").get();
 if(!present)throw Error('Not a previously migrated 0030 database');
 const cols=db.prepare('PRAGMA table_info(kosmora_retained_accounting)').all();
 if(cols.some(row=>row.name==='run_id'))throw Error('Retained accounting already has run_id; no retrofit necessary');
 const count=Number(db.prepare('SELECT count(*) AS n FROM kosmora_retained_accounting').get().n);
 if(count!==0)throw Error('NONEMPTY_LEGACY_RETAINED_HISTORY: run_id irrecoverable; manual recovery required; database untouched');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SQLite integrity check failed');
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign keys invalid; manual repair required');
 for(const name of names)if(!db.prepare('SELECT 1 FROM sqlite_master WHERE type=\'trigger\' AND name=?').get(name))
   throw Error('Unexpected 0030 trigger layout: '+name);
 mkdirSync(dirname(backup),{recursive:true});
 copyFileSync(dbfile,backup,0x01);
 const fd=openSync(backup,'r');fsyncSync(fd);closeSync(fd);
 const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
 const original=digest(dbfile);
 if(digest(backup)!==original)throw Error('Backup hash mismatch; abort');
 db.exec('BEGIN IMMEDIATE');
 try{
   for(const name of names)db.exec(`DROP TRIGGER ${name}`);
   db.exec("ALTER TABLE kosmora_retained_accounting ADD COLUMN run_id TEXT NOT NULL DEFAULT '' CHECK(length(run_id)>0)");
   // Canonical 0030 triggers use explicit columns, so ALTER's appended run_id
   // cannot silently misplace (or discard) retained audit records.
   for(const ddl of triggers)db.exec(ddl);
   if(!db.prepare('PRAGMA table_info(kosmora_retained_accounting)').all().some(row=>row.name==='run_id'))throw Error('Missing run_id');
   if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok' || db.prepare('PRAGMA foreign_key_check').all().length)
     throw Error('Post-retrofit integrity failure');
   db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 console.log(JSON.stringify({status:'PASS',action:'retrofit-retained-accounting',backup,backup_sha256:digest(backup),database:dbfile,post_integrity:'ok'}));
}finally{db.close();}
