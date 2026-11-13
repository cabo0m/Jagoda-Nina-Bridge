/** Isolated Chrome + one-shot host helper integration. Only fake credentials. */
import assert from "node:assert/strict";
import {existsSync, mkdtempSync, readdirSync, writeFileSync, rmSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
import {createConnection} from "node:net";
import {setTimeout as sleep} from "node:timers/promises";
import {chromium} from "playwright-core";

const extension=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const project=resolve(extension,"..");
const helper=join(project,"tools","local_bootstrap.py");
const python=join(project,"server",".venv","Scripts","python.exe");
const chromiumCache=join(homedir(),"AppData","Local","ms-playwright");
const binary=readdirSync(chromiumCache).filter(x=>/^chromium-\d+$/.test(x))
  .sort().reverse().map(v=>join(chromiumCache,v,"chrome-win64","chrome.exe")).find(existsSync);
assert.ok(binary,"Chromium test browser missing");
const root=mkdtempSync(join(tmpdir(),"jnb-recovery-"));
const fakeConversation="1e593071-c283-4942-8eb0-7294eaa517b1";
const fakeToken="This-is-a-FAKE-token-only-for-isolated-test-"+("X".repeat(40));
const credentials=join(root,"credentials.env");
writeFileSync(credentials,`JNB_CONVERSATION_ID=${fakeConversation}\nJNB_JAGODA_TOKEN=${fakeToken}\n`,"utf8");
let browser, server;
async function waitPort(port) {
  for(let i=0;i<50;i++){
    const ok=await new Promise(resolve=>{
      const s=createConnection({host:"127.0.0.1",port});
      s.once("connect",()=>{s.destroy();resolve(true);});
      s.once("error",()=>resolve(false));
      s.setTimeout(300,()=>{s.destroy();resolve(false);});
    });
    if(ok)return;
    await sleep(100);
  }
  throw new Error("One-shot helper failed to start");
}
try {
  browser=await chromium.launchPersistentContext(join(root,"profile"),{
    executablePath:binary,headless:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,
      "--no-first-run","--no-default-browser-check"],
    viewport:{width:900,height:850},
  });
  const worker=browser.serviceWorkers().find(w=>w.url().startsWith("chrome-extension://")) ??
    await browser.waitForEvent("serviceworker",{timeout:15000});
  const id=new URL(worker.url()).hostname;
  const page=await browser.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  const config={
    serverUrl:"http://127.0.0.1:8765",
    participant:"jagoda",
    conversationId:fakeConversation,
  };
  const original=await page.evaluate(({config,token})=>
    chrome.runtime.sendMessage({type:"CONFIGURE",config,token}),{
      config,token:"DUMMY-ONLY-PLACEHOLDER-NOT-THE-RECOVERY-SECRET-"+("Y".repeat(35))
    });
  assert.equal(original?.ok,true,original?.error);
  await page.evaluate(()=>chrome.storage.local.remove("jnb.token"));
  const missing=await page.evaluate(()=>chrome.runtime.sendMessage({type:"GET_STATUS"}));
  assert.equal(missing?.ok,true);
  assert.equal(missing.result.tokenReady,false);

  server=spawn(python,[helper,"--credentials-file",credentials,
    "--extension-id",id,"--port","8766","--expires-seconds","90"],{
    cwd:project,windowsHide:true,stdio:"ignore"
  });
  await waitPort(8766);
  const forged=await fetch("http://127.0.0.1:8766/bootstrap",{
    method:"POST",headers:{"Origin":"https://evil.example","X-JNB-Local-Setup":"1"}
  });
  assert.equal(forged.status,403,"Wrong origin accepted by helper");

  const recovered=await page.evaluate(() =>
    chrome.runtime.sendMessage({type:"RECOVER_LOCAL_TOKEN"}));
  assert.equal(recovered?.ok,true,recovered?.error);
  assert.equal(recovered.result.tokenReady,true);
  assert.equal(recovered.result.active,false);
  assert.equal(recovered.result.config.conversationId,fakeConversation);
  assert.ok(!JSON.stringify(recovered).includes(fakeToken),"Token leaked to UI");
  const localStored=await page.evaluate(() =>chrome.storage.local.get("jnb.token"));
  assert.equal(localStored["jnb.token"],fakeToken);
  console.log("CHROMIUM LOCAL TOKEN RECOVERY PASS: exact extension Origin, single-use loopback, no secret in status.");

  let closed=false;
  for(let i=0;i<30;i++){
    if(server.exitCode!==null){closed=true;break;}
    await sleep(80);
  }
  assert.equal(closed,true,"One-shot server did not shut down after valid request");
  console.log("ONE-SHOT HELPER TERMINATION PASS.");
} finally {
  if(server && server.exitCode===null){server.kill();}
  if(browser)await browser.close();
  rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
