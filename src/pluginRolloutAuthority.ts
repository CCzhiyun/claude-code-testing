import {AsyncLocalStorage} from 'node:async_hooks';
const approval=new AsyncLocalStorage<string>();
/** Internal bridge: only the reviewed rollout applies an expiring receipt. */
export function withReviewedRollout<T>(candidate:string,action:()=>T):T{return approval.run(candidate,action);}
export function reviewedRolloutCandidate():string|undefined{return approval.getStore();}
