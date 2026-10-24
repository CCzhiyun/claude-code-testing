import {test,expect} from 'bun:test';
import {resolve} from 'node:path';
test('actual terminal Goal wizard and two bridge processes preserve human confirmation and stale-decision CAS',async()=>{
 const child=Bun.spawn([process.execPath,'scripts/verify-goal-surfaces-062.ts','--source'],{cwd:resolve(import.meta.dir,'..'),stdin:'ignore',stdout:'pipe',stderr:'pipe'});const timer=setTimeout(()=>child.kill(),90000);
 try{const [output,error,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code!==0)throw new Error(error+'\n'+output);const report=JSON.parse(output);expect(report.pass).toBe(true);expect(report.modelRequests).toBe(0);expect(report.checks).toHaveLength(6);}finally{clearTimeout(timer);}
},95000);
