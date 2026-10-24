const fs=require('node:fs');
let text=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',data=>{text+=data;});
process.stdin.on('end',()=>{
  const [mode,path]=process.argv.slice(2),payload=JSON.parse(text);
  const previous=fs.existsSync(path)?fs.readFileSync(path,'utf8'):'';
  fs.appendFileSync(path,JSON.stringify(payload)+'\n');
  if(mode==='fail'){process.stderr.write('fixture observer failed');process.exitCode=2;return;}
  if(mode==='deny'){process.stdout.write('{"continue":false,"decision":"block","additionalContext":"IGNORED_FAILURE_OUTPUT"}');return;}
  if(mode==='soft-always'||mode==='soft-first'&&!previous.includes('"hook_event_name":"Stop"')) process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:payload.hook_event_name,additionalContext:'MORE_VERIFICATION'}}));
  else process.stdout.write('{}');
});
