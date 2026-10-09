#!/usr/bin/env node
/** Offline, explicit upgrade for 76e44320 SQLite databases that applied 26-28 before 25 existed. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, copyFileSync, existsSync, openSync, closeSync, fsyncSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const database=option('--database');const backup=option('--backup');
if(!args.includes('--apply')||!database||!backup||args.length!==5 || database===backup){
  console.error('Usage: node scripts/retrofit-document-library.mjs --apply --database /OFFLINE/db.sqlite --backup /SAFE/db-before-library.sqlite');
  process.exit(2);
}
const dbfile=resolve(database),backupfile=resolve(backup);
if(!existsSync(dbfile)||existsSync(backupfile)||existsSync(dbfile+'-wal')||existsSync(dbfile+'-shm'))
  throw Error('Database must be offline; source exists; backup absent; no active WAL/SHM');
const sqlite=new DatabaseSync(dbfile);
let applied=false;
try {
  sqlite.exec('PRAGMA foreign_keys=ON');
  const table=name=>!!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if(!table('project_memory')||!table('kosmora_account_preferences')||!table('research_v1_runs'))
    throw Error('Not a recognized upgraded 76e44320 schema; abort');
  if(table('document_library_files')||table('document_library_chunks')||table('document_library_fts'))
    throw Error('Document library already exists or is partially installed; do not overwrite');
  const valid=sqlite.prepare('PRAGMA integrity_check').all().every(row=>Object.values(row)[0]==='ok');
  if(!valid)throw Error('Source SQLite integrity_check failed');
  mkdirSync(dirname(backupfile),{recursive:true});
  copyFileSync(dbfile,backupfile,0x01/* COPYFILE_EXCL */);
  const fd=openSync(backupfile,'r');fsyncSync(fd);closeSync(fd);
  const backupHash=createHash('sha256').update(readFileSync(backupfile)).digest('hex');
  const sourceHash=createHash('sha256').update(readFileSync(dbfile)).digest('hex');
  if(backupHash!==sourceHash)throw Error('Backup bytes differ; abort');
  const file=fileURLToPath(new URL('../packages/db/migrations/0025_document_library.sql',import.meta.url));
  const text=readFileSync(file,'utf8');
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    for(const statement of text.split('--> statement-breakpoint'))if(statement.trim())sqlite.exec(statement);
    if(!table('document_library_files')||!table('document_library_chunks')||!table('document_library_fts'))
      throw Error('Library migration did not create all tables');
    const postIntegrity=sqlite.prepare('PRAGMA integrity_check').all().every(row=>Object.values(row)[0]==='ok');
    const orphanRows=sqlite.prepare('PRAGMA foreign_key_check').all();
    if(!postIntegrity||orphanRows.length) throw Error('Retrofit failed post integrity/foreign-key verification');
    sqlite.exec('COMMIT');applied=true;
  }catch(error){sqlite.exec('ROLLBACK');throw error;}
  console.log(JSON.stringify({status:'PASS',action:'retrofit-0025',backup:backupfile,backup_sha256:backupHash,database:dbfile,post_integrity:'ok'}));
}finally{sqlite.close();}
if(!applied)process.exitCode=1;
