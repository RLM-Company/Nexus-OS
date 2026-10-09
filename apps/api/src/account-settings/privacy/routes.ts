import type { FastifyInstance,FastifyRequest } from 'fastify';
import { Type } from 'typebox';
import type { IdentityContext } from '@cosmora/contracts';
import type { AccountStore } from '../account-store.js';
import { OwnerPrivacyCoordinator,PrivacyIncompleteError,PrivacyUnavailableError } from './coordinator.js';

const confirm=Type.Object({confirmation_token:Type.String({minLength:20,maxLength:128}),phrase:Type.Literal('УДАЛИТЬ МОИ ДАННЫЕ')},{additionalProperties:false});
const binaryParams=Type.Object({store:Type.String({maxLength:64}),id:Type.String({maxLength:500})});
const noCache=(reply:{header(name:string,value:string):unknown})=>{reply.header('Cache-Control','private, no-store');reply.header('X-Content-Type-Options','nosniff');};
const safeFilename=(name:string)=>name.replace(/[\r\n"\\/\x00-\x1f\x7f]/g,'_').slice(0,180)||'original';
export function registerPrivacyRoutes(app:FastifyInstance, coordinator:OwnerPrivacyCoordinator, account:AccountStore, identityFor:(request:FastifyRequest)=>IdentityContext):void {
  app.get('/api/v1/personal-settings/privacy', async(request,reply)=>{
    noCache(reply);return coordinator.overview(identityFor(request).owner_id);
  });
  app.get('/api/v1/personal-settings/privacy/preview',async(request,reply)=>{
    noCache(reply);
    try {
      const result=await coordinator.export(identityFor(request).owner_id);
      return {complete:true,generated_at:result.generated_at,record_count:result.record_count,original_count:result.original_count,
        sections:Object.fromEntries(Object.entries(result.sections).map(([name,s])=>[name,{records:s.count,originals:s.originals.length,collections:Object.fromEntries(Object.entries(s.records).map(([key,rows])=>[key,rows.length]))}])),retained:result.retained};
    }catch(e){return reply.status(e instanceof PrivacyIncompleteError?413:503).send({error:{code:e instanceof PrivacyIncompleteError?e.code:'PRIVACY_NOT_READY',message:e instanceof Error?e.message:'Unavailable'}});}
  });
  app.get('/api/v1/personal-settings/export',async(request,reply)=>{
    noCache(reply);
    try{
      const archive=await coordinator.exportArchive(identityFor(request).owner_id);
      reply.header('Content-Type','application/zip');
      reply.header('Content-Disposition','attachment; filename="kosmora-complete-export.zip"');
      reply.header('Content-Length',String(archive.byteLength));
      return reply.send(archive);
    }catch(e){return reply.status(e instanceof PrivacyIncompleteError?413:503).send({error:{code:e instanceof PrivacyIncompleteError?e.code:'PRIVACY_NOT_READY',message:e instanceof Error?e.message:'Unavailable'}});}
  });
  app.get('/api/v1/personal-settings/binaries/:store/:id',{schema:{params:binaryParams}},async(request,reply)=>{
    noCache(reply);
    const params=request.params as {store:string;id:string};
    try{
      const output=await coordinator.binary(identityFor(request).owner_id,params.store,params.id);
      if(!output)return reply.status(404).send({error:{code:'BINARY_NOT_FOUND'}});
      reply.header('Content-Disposition',`attachment; filename="${safeFilename(output.original.filename)}"`);
      reply.header('Content-Type',output.original.content_type);
      reply.header('Content-Length',String(output.original.size_bytes));
      return reply.send(output.stream);
    }catch{return reply.status(503).send({error:{code:'BINARY_UNAVAILABLE'}});}
  });
  app.post('/api/v1/personal-settings/delete-challenge',async(request,reply)=>{
    noCache(reply);
    const owner=identityFor(request).owner_id;
    if(!coordinator.overview(owner).ready)return reply.status(409).send({error:{code:'PRIVACY_ADAPTERS_UNAVAILABLE',message:'Required stores or owner lifecycle not ready'}});
    return account.createDeleteChallenge(owner);
  });
  app.post('/api/v1/personal-settings/delete',{schema:{body:confirm}},async(request,reply)=>{
    noCache(reply);
    const body=request.body as {confirmation_token:string;phrase:string};
    try{return await coordinator.delete(identityFor(request).owner_id,body.confirmation_token,body.phrase);}
    catch(e){return reply.status(e instanceof PrivacyUnavailableError?503:409).send({error:{code:e instanceof Error&&'code'in e?String(e.code):'PRIVACY_DELETE_BLOCKED',message:e instanceof Error?e.message:'Deletion blocked'}});}
  });
}
