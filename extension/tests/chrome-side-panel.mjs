/** Real Chromium MV3 side-panel configuration and responsive-height integration.
 * Isolated temporary Chrome profile, no private ChatGPT account or production tokens.
 */
import assert from "node:assert/strict";
import {existsSync, mkdtempSync, readdirSync, rmSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright-core";
const extension=resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache=join(homedir(),"AppData","Local","ms-playwright");
const installed=readdirSync(cache).filter(x=>/^chromium-\d+$/.test(x)).sort().reverse();
const binary=installed.map(v=>join(cache,v,"chrome-win64","chrome.exe")).find(existsSync);
assert.ok(binary,"Brak testowego Chromium");
const temp=mkdtempSync(join(tmpdir(),"jnb-side-panel-"));
let context;
try {
  context=await chromium.launchPersistentContext(temp,{
    executablePath:binary,headless:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,
      "--no-first-run","--no-default-browser-check"],
    viewport:{width:900,height:820}
  });
  const worker=context.serviceWorkers().find(x=>x.url().startsWith("chrome-extension://")) ??
    await context.waitForEvent("serviceworker",{timeout:15000});
  const extensionId=new URL(worker.url()).hostname;
  let result;
  for(let i=0;i<20;i++){
    result=await worker.evaluate(async()=>{
      const options=await chrome.sidePanel.getOptions({});
      const behavior=await chrome.sidePanel.getPanelBehavior();
      return {
        path:options.path,
        enabled:options.enabled!==false,
        openOnClick:behavior.openPanelOnActionClick,
        manifest:chrome.runtime.getManifest(),
      };
    });
    if(result.openOnClick)break;
    await new Promise(ok=>setTimeout(ok,150));
  }
  assert.equal(result.manifest.manifest_version,3);
  assert.equal(result.manifest.version,"0.3.4");
  assert.ok(result.manifest.permissions.includes("sidePanel"));
  assert.equal(result.manifest.action.default_popup,undefined);
  assert.equal(result.path,"popup.html");
  assert.equal(result.enabled,true);
  assert.equal(result.openOnClick,true);
  console.log("REAL CHROMIUM SIDE PANEL CONFIG PASS: global side panel + action click enabled.");
  const page=await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const ui=await page.evaluate(()=>{
    const body=getComputedStyle(document.body);
    const main=getComputedStyle(document.querySelector("main"));
    return {
      bodyWidth:document.body.getBoundingClientRect().width,
      mainHeight:document.querySelector("main").getBoundingClientRect().height,
      clientHeight:document.documentElement.clientHeight,
      maxHeight:main.maxHeight,
      noticeCount:document.querySelectorAll("#notice").length,
      bindCurrent:Boolean(document.querySelector("#bind-current-chatgpt")),
      bindManual:Boolean(document.querySelector("#bind-chatgpt")),
      isSidePanel:document.body.classList.contains("side-panel"),
      errorsVisibleStyle:getComputedStyle(document.querySelector("#notice")).position,
      bodyCSSWidth:body.width,
    };
  });
  assert.ok(ui.mainHeight > 600,"Panel nadal ograniczony do małego popupu");
  assert.ok(ui.mainHeight < ui.clientHeight);
  assert.equal(ui.noticeCount,1);
  assert.equal(ui.bindCurrent,true);
  assert.equal(ui.bindManual,true);
  assert.equal(ui.isSidePanel,true);
  assert.equal(ui.errorsVisibleStyle,"sticky");
  console.log("REAL CHROMIUM FULL-HEIGHT UI PASS:",JSON.stringify({
    viewport:ui.clientHeight,panelHeight:ui.mainHeight,bindCurrent:true,stickyErrors:true
  }));
  // Scroll section: adapter must be reachable and its status visible.
  await page.locator("#bind-current-chatgpt").scrollIntoViewIfNeeded();
  assert.equal(await page.locator("#bind-current-chatgpt").isVisible(),true);
  assert.equal(await page.locator("#use-current").isVisible(),true,
    "Przycisk zmiany rozmowy Bridge musi być widoczny w panelu.");
  assert.ok((await page.locator("#chatgpt-status").textContent()).includes("Brak przypiętej"));
  console.log("REAL CHROMIUM ADAPTER UI PASS: separate ChatGPT bind control and no silent status change.");

  const config = {
    serverUrl: "http://127.0.0.1:58473", // No test server. STOP will be locally verified.
    conversationId: "00000000-0000-4000-8000-000000000012",
    participant: "jagoda",
  };
  const fakeToken = "isolated-cryptographic-test-token-".repeat(2);
  const configured = await page.evaluate(async ({config, token}) =>
    chrome.runtime.sendMessage({type:"CONFIGURE",config,token}),
    {config,token:fakeToken});
  assert.equal(configured?.ok,true,configured?.error);
  assert.equal(configured.result.tokenReady,true);
  const persisted = await page.evaluate(async () => {
    const data=await chrome.storage.local.get(["jnb.token","jnb.config"]);
    return {token:data["jnb.token"],config:data["jnb.config"]};
  });
  assert.equal(persisted.token,fakeToken);
  assert.equal(persisted.config.conversationId,config.conversationId);

  let confirmDialogCount = 0;
  page.on("dialog", async dialog => {
    confirmDialogCount += 1;
    await dialog.dismiss();
  });
  await page.locator("#stop").click();
  await page.waitForFunction(() => /NIEPOTWIERDZONY|nie potwierdził|Nie udało się potwierdzić/.test(document.querySelector("#notice")?.textContent || ""),
    null,{timeout:12000});
  assert.equal(confirmDialogCount,0,"STOP must not use modal confirm()");
  const stopped=await page.evaluate(()=>chrome.runtime.sendMessage({type:"GET_STATUS"}));
  assert.equal(stopped.result.active,false);
  assert.equal(stopped.result.snapshot.remoteStopUnknown,true);
  console.log("REAL CHROMIUM MODAL-FREE STOP PASS: local emergency stop, remote uncertainty stated.");

  // Reopen the SAME real Chrome user profile. This is stronger than a tab
  // refresh and simulates the entire browser restarting after an update.
  // In some headless Chromium builds chrome.runtime.reload() permanently
  // blocks the unpacked extension; a fresh process is the portable path.
  await context.close();
  context = await chromium.launchPersistentContext(temp, {
    executablePath:binary,headless:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,
      "--no-first-run","--no-default-browser-check"],
    viewport:{width:900,height:820}
  });
  const restartedWorker=context.serviceWorkers().find(x=>x.url().startsWith("chrome-extension://")) ??
    await context.waitForEvent("serviceworker",{timeout:15000});
  assert.equal(new URL(restartedWorker.url()).hostname,extensionId,"Extension ID changed on restart");
  const restoredPage=await context.newPage();
  await restoredPage.goto(`chrome-extension://${extensionId}/popup.html`);
  const restored=await restoredPage.evaluate(()=>chrome.runtime.sendMessage({type:"GET_STATUS"}));
  assert.equal(restored?.ok,true,"Extension did not recover after Chrome restart");
  assert.equal(restored.result.tokenReady,true,"Token vanished after Chrome restart");
  assert.equal(restored.result.active,false,"Restart must not restart the experiment");
  assert.equal(restored.result.config.conversationId,config.conversationId);
  console.log("REAL CHROMIUM TOKEN PERSISTENCE PASS: same credentials across full Chrome restart, START remains off.");
} finally {
  if(context) await context.close();
  rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:120});
}
