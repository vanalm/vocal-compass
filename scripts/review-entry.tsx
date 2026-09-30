/** Isolated design preview. NEVER imported by src/main.tsx or shipped as the production app. */
import "fake-indexeddb/auto";
import { createRoot } from "react-dom/client";
import App from "../src/ui/App";
import { IndexedDbTrialRepository } from "../src/core/storage/IndexedDbTrialRepository";
import { fixtureBlock } from "../tests/auditFixtures";

// Deliberately transient. No accounts, user data, media or real endpoints in this preview.
let previewId=0;
if(!crypto.randomUUID)Object.defineProperty(crypto,"randomUUID",{value:()=>`00000000-0000-4000-8000-${String(++previewId).padStart(12,"0")}`,configurable:true});
const storage=new Map<string,string>();
const store={getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>{storage.set(k,String(v));},removeItem:(k:string)=>{storage.delete(k);},clear:()=>storage.clear(),key:(i:number)=>[...storage.keys()][i]??null,get length(){return storage.size;}};
Object.defineProperty(window,"localStorage",{value:store,configurable:true});
window.fetch=async()=>new Response(JSON.stringify({user:null,detail:"Preview: accounts disabled"}),{status:200,headers:{"Content-Type":"application/json"}});
Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>{throw new Error("Microphone is disabled in the design preview. Use the installed app for real practice.");},enumerateDevices:async()=>[]}});
window.addEventListener("click",e=>{const a=(e.target as Element)?.closest("a");if(a?.getAttribute("href")?.startsWith("/api")){e.preventDefault();}},true);
const repository=new IndexedDbTrialRepository();
let root:ReturnType<typeof createRoot>|null=null;
async function mount(sample:boolean){
 root?.unmount();await repository.clear();
 if(sample)for(const t of [...fixtureBlock("demo-first","2026-09-01T12:00:00Z",8),...fixtureBlock("demo-later","2026-09-08T12:00:00Z",12)])await repository.save(t);
 document.getElementById("preview-label")!.textContent=sample?"DESIGN PREVIEW · fabricated sample progress · temporary data · microphone and accounts disabled":"DESIGN PREVIEW · empty state · temporary data · microphone and accounts disabled";
 window.location.hash=sample?"progress":"today";
 root=createRoot(document.getElementById("root")!);root.render(<App/>);
}
document.getElementById("preview-demo")!.addEventListener("click",()=>void mount(true));
document.getElementById("preview-empty")!.addEventListener("click",()=>void mount(false));
void mount(false);
