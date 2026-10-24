import {createHash} from 'node:crypto';
export interface InstructionSource {
  source:'user-instructions'|'project-instructions'|'architecture-document'|'engineering-rule:user'|'engineering-rule:project'|'skill'|'agent-profile'|'application-instructions'|'memory';
  path?:string;
  instruction_id?:string;
  included_text_digest:string;
  included_characters:number;
}
export type InstructionSourceObserver=(source:InstructionSource)=>Promise<void>;
/** Only the included text's digest/length is observed; no instruction body or
 * credential material is passed to this lifecycle payload. */
export function instructionSource(source:InstructionSource['source'],included:string,identity:{path?:string;instruction_id?:string}={}):InstructionSource{
 return {source,...identity,included_text_digest:createHash('sha256').update(included).digest('hex'),included_characters:included.length};
}
