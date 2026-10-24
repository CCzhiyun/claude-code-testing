import type {PlatformConfig} from '../types.js';
import {createQuestionDialog,type QuestionDialogState} from './questionDialog.js';
import {reviewConflictResolution,resolveConflict,type ConflictChoice} from '../conflictResolution.js';
import {previewConflictRestore,restoreConflictResolution} from '../conflictRestore.js';
export type LocalConflictDialog={file:string;version:string;choice?:ConflictChoice;restore?:{id:string;digest:string}};
export async function createConflictRestoreDialog(cwd:string,id:string,config:PlatformConfig){
 const review=await previewConflictRestore(cwd,id,config);
 const dialog=createQuestionDialog('local-conflict-restore',JSON.stringify({type:'questions',questions:[{id:'confirm',question:`Undo this exact conflict resolution?\n${JSON.stringify(review,null,2)}\nOriginal working/index bytes will be restored. Any later edit, staging or HEAD change blocks recovery. Current bytes are retained. No commit/push.`,choices:['Cancel — change nothing','Restore reviewed original bytes']}]}))!;
 dialog.localConflict={file:review.path,version:review.reviewDigest,restore:{id,digest:review.reviewDigest}};return dialog;
}
const choices:Record<string,ConflictChoice>={'Use ours (absent means delete)':'ours','Use theirs (absent means delete)':'theirs','Use manually edited working bytes/deletion':'working','Delete the conflicted path':'delete'};
export async function createConflictDialog(cwd:string,file:string,config:PlatformConfig){
 const reviewed=await reviewConflictResolution(cwd,file,config);const dialog=createQuestionDialog('local-conflict-review',JSON.stringify({type:'questions',questions:[{id:'choice',question:`Resolve ${reviewed.path}\n${JSON.stringify(reviewed,null,2)}\nNo action until a second explicit confirmation.`,choices:['Cancel — change nothing',...Object.keys(choices)]}]}))!;
 dialog.localConflict={file:reviewed.path,version:reviewed.version};return dialog;
}
export async function completeConflictDialog(cwd:string,state:QuestionDialogState,config:PlatformConfig):Promise<{dialog?:QuestionDialogState;result?:unknown}>{
 const local=state.localConflict;if(!local)throw new Error('Not a local conflict dialog');const answer=state.answers[state.questions[0]!.id]?.[0];
 if(answer==='Cancel — change nothing')return {result:'Conflict resolution cancelled; no files or index changed.'};
 if(local.restore){if(answer!=='Restore reviewed original bytes')throw new Error('Explicit restore confirmation required');return {result:await restoreConflictResolution(cwd,local.restore.id,local.restore.digest,true,config)};}
 if(!local.choice){const choice=choices[answer??''];if(!choice)throw new Error('Choose an exact conflict side');const fresh=await reviewConflictResolution(cwd,local.file,config);if(fresh.version!==local.version)throw new Error('Conflict changed; reopen review');
  const dialog=createQuestionDialog('local-conflict-confirm',JSON.stringify({type:'questions',questions:[{id:'confirm',question:`Apply ${choice} to ${local.file}?\nReviewed version ${local.version}\nOriginal working bytes and index will be retained. Resolution will be staged; no commit/push.\nAbsent side means deletion, NOT an empty file.`,choices:['Cancel — change nothing','Apply reviewed resolution']}]}))!;dialog.localConflict={...local,choice};return {dialog};
 }
 if(answer!=='Apply reviewed resolution')throw new Error('Explicit conflict confirmation required');return {result:await resolveConflict(cwd,local.file,local.choice,local.version,true,config)};
}
