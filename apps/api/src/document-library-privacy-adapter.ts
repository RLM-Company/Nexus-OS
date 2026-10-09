import type { DocumentAnswerStore } from "@cosmora/db";
import type { DocumentAnswerService } from "./document-answer-service.js";

/** Owner-scoped adapter for the shared privacy coordinator. Original binary bytes are
 * NOT inlined into JSON: authenticated_url+hash+size form the FULL original manifest.
 * Coordinator MUST download binaries before invoking delete; a manifest is not the binary export.
 * Canonical accounting/audit rows are intentionally untouched by deleteOwner. */
export function createDocumentLibraryPrivacyAdapter(service: DocumentAnswerService,store:DocumentAnswerStore) {
  const quiesced=new Set<string>();
  const deleted=new Set<string>();
  return {
    id:"document-library",
    required:true,
    quiesce:async(ownerId:string)=>{await service.quiesce(ownerId);quiesced.add(ownerId);},
    export:(ownerId:string)=>{if(!quiesced.has(ownerId))throw Error("QUIESCE_REQUIRED");return store.exportOwner(ownerId);},
    delete:(ownerId:string)=>{
      if(!quiesced.has(ownerId))throw Error("QUIESCE_REQUIRED");
      const result=store.deleteOwner(ownerId);deleted.add(ownerId);return result;
    },
    resume:(ownerId:string)=>{
      if(deleted.has(ownerId))throw Error("OWNER_DELETED");
      quiesced.delete(ownerId);service.resume(ownerId);
    }
  };
}
