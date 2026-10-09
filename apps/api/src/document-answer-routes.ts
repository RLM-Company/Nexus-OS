import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IdentityContext } from "@cosmora/contracts";
import { Type } from "typebox";
import { DocumentAnswerError } from "@cosmora/db";
import { DocumentAnswerService, DocumentAnswerUnavailable } from "./document-answer-service.js";

export function registerDocumentAnswerRoutes(app:FastifyInstance, service:DocumentAnswerService,
  identityFor:(request:FastifyRequest)=>IdentityContext):void {
  const base="/api/v1/projects/:projectId/document-library/answers";
  const scope=Type.Object({projectId:Type.String({minLength:1,maxLength:120})});
  const item=Type.Object({projectId:Type.String({minLength:1,maxLength:120}),id:Type.String({minLength:1,maxLength:120})});
  const err=(reply:{code:(status:number)=>{send:(v:unknown)=>unknown}},cause:unknown)=>{
    if (cause instanceof DocumentAnswerUnavailable) return reply.code(503).send({error:{code:"MODEL_OR_OWNER_BUDGET_UNAVAILABLE"}});
    if (cause instanceof DocumentAnswerError) return reply.code(cause.code==="NOT_FOUND"?404:cause.code==="QUIESCED"?423:422)
      .send({error:{code:cause.code}});
    throw cause;
  };
  app.get<{Params:{projectId:string}}>(base,{schema:{params:scope}},(req,reply)=>{
    try {return {answers:service.store.list(req.params.projectId,identityFor(req).owner_id),available:service.isAvailable()};}
    catch(cause){return err(reply,cause);}
  });
  app.post<{Params:{projectId:string};Body:{question:string;file_ids:string[]}}>(base,{
    schema:{params:scope,body:Type.Object({question:Type.String({minLength:2,maxLength:500}),
      file_ids:Type.Array(Type.String({minLength:1,maxLength:120}),{minItems:1,maxItems:20})},{additionalProperties:false})}
  },async(req,reply)=>{
    try {
      const answer=await service.ask(req.params.projectId,identityFor(req).owner_id,
        req.body.question,req.body.file_ids);
      return reply.code(202).send(answer);
    }catch(cause){return err(reply,cause);}
  });
  app.get<{Params:{projectId:string;id:string}}>(`${base}/:id`,{schema:{params:item}},(req,reply)=>{
    const answer=service.store.get(req.params.projectId,identityFor(req).owner_id,req.params.id);
    return answer ?? reply.code(404).send({error:{code:"NOT_FOUND"}});
  });
  app.post<{Params:{projectId:string;id:string}}>(`${base}/:id/cancel`,{schema:{params:item}},async(req,reply)=>{
    const cancelled=await service.cancel(req.params.projectId,identityFor(req).owner_id,req.params.id);
    return cancelled?{status:"cancel_requested"}:reply.code(404).send({error:{code:"NOT_FOUND"}});
  });
}
