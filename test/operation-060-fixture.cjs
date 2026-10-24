const fs=require('node:fs'),readline=require('node:readline');
const path=process.argv[2];
readline.createInterface({input:process.stdin}).on('line',line=>{
 const req=JSON.parse(line);if(!req.id)return;
 let result={};
 if(req.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'operation-fixture',version:'1'}};
 else if(req.method==='tools/call'){
  const state=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,'utf8')):{charges:0,refunds:0,keys:[]},args=req.params.arguments||{},tool=req.params.name;
  if(tool==='charge'){if(!state.keys.includes(args.request_id)){state.keys.push(args.request_id);state.charges++;}}
  else if(tool==='refund')state.refunds++;
  fs.writeFileSync(path,JSON.stringify(state));result={content:[{type:'text',text:JSON.stringify({...state,operation_id:args.operation_id})}]};
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\n');
});
