import {createHash} from 'node:crypto';
export interface CompactionQualityPolicy {requiredTerms:string[];minimumCoverage?:number}
export function validateCompactionQuality(p:CompactionQualityPolicy){
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['requiredTerms','minimumCoverage'].includes(k))||!Array.isArray(p.requiredTerms)||!p.requiredTerms.length||p.requiredTerms.length>64||new Set(p.requiredTerms).size!==p.requiredTerms.length||p.requiredTerms.some(t=>typeof t!=='string'||!t.trim()||t.length>256||/[\x00-\x1f\x7f]/.test(t))||p.minimumCoverage!==undefined&&(!Number.isFinite(p.minimumCoverage)||p.minimumCoverage<0||p.minimumCoverage>1))throw new Error('contextCompaction.quality requires 1–64 unique bounded terms and minimumCoverage 0–1');
}
/** Deterministic coverage, NOT semantic equivalence or a zero-loss guarantee.
 * Only terms present in source are required, so unrelated new terms are never
 * invented. Diagnostics persist hashes/counts, not the sensitive source terms. */
export function evaluateCompactionQuality(source:string,summary:string,policy:CompactionQualityPolicy){
 validateCompactionQuality(policy);if(Buffer.byteLength(source)>16*1024*1024||Buffer.byteLength(summary)>2*1024*1024)throw new Error('Compaction evaluation exceeds bounded input');
 const relevant=policy.requiredTerms.filter(t=>source.includes(t)),missing=relevant.filter(t=>!summary.includes(t)),coverage=relevant.length?(relevant.length-missing.length)/relevant.length:1;
 return {passed:coverage>=(policy.minimumCoverage??1),coverage,required:relevant.length,preserved:relevant.length-missing.length,missingHashes:missing.map(t=>createHash('sha256').update(t).digest('hex')),semanticEquivalenceVerified:false as const};
}
