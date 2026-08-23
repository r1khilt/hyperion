import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { generate } from "../src/lib/generate";
async function main(){const dir=join(process.cwd(),"data/evals");const files=(await readdir(dir)).filter(x=>x.endsWith(".json"));for(const file of files){const rows=JSON.parse(await readFile(join(dir,file),"utf8")) as Array<{id:string;prompt:string}>;for(const row of rows){try{const result=await generate(row.prompt,"balanced");console.log(JSON.stringify({id:row.id,model:result.model,latency_ms:result.latency_ms,cost_usd:result.usage.cost_usd}));}catch(error){console.error(JSON.stringify({id:row.id,error:error instanceof Error?error.message:"failed"}));}}}}main();
