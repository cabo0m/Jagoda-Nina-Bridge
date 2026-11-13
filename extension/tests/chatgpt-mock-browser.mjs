/** Sprint 3 integration: real MV3 in Chromium, simulated ChatGPT DOM, real FastAPI HTTP.
 * NO actual ChatGPT session, no user profile, no paid API. Do not label as live model E2E.
 */
import assert from "node:assert/strict";
import {execFileSync, spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {createServer} from "node:net";
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join, dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {setTimeout as sleep} from "node:timers/promises";
import {chromium} from "playwright-core";

const extension = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = resolve(extension, "..", "server");
const python = join(server, ".venv", "Scripts", "python.exe");
const fixture = readFileSync(join(extension, "tests", "fake-chatgpt.html"), "utf8");

function browserExecutable() {
  const dir = join(homedir(), "AppData", "Local", "ms-playwright");
  for(const version of readdirSync(dir).filter(x => /^chromium-\d+$/.test(x)).sort().reverse()){
    const file=join(dir,version,"chrome-win64","chrome.exe");
    if(existsSync(file))return file;
  }
  throw new Error("Brak Chromium Playwright");
}

async function port() {
  const listener = createServer();
  await new Promise((resolvePromise,reject) => {
    listener.once("error", reject); listener.listen(0,"127.0.0.1",resolvePromise);
  });
  const n=listener.address().port;
  await new Promise(resolvePromise => listener.close(resolvePromise));
  return n;
}

async function httpJson(base, token, method, url, body) {
  const result=await fetch(base+url,{
    method,headers:{Authorization:`Bearer ${token}`,...(body?{"Content-Type":"application/json"}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(9000)
  });
  const data=await result.json();
  assert.ok(result.ok,`HTTP ${result.status} ${url}: ${JSON.stringify(data).slice(0,200)}`);
  return data;
}

async function browserProfile(dir, binary, base, config) {
  const context=await chromium.launchPersistentContext(dir,{
    executablePath:binary,headless:true,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,
      "--no-first-run","--no-default-browser-check"],
    viewport:{width:560,height:880}
  });
  try{
    const worker=context.serviceWorkers().find(x=>x.url().startsWith("chrome-extension://")) ??
      await context.waitForEvent("serviceworker",{timeout:16000});
    const id=new URL(worker.url()).hostname;
    const popup=await context.newPage();
    popup.on("pageerror", e=>console.error("POPUP ERROR:",e.message));
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator("#server-url").fill(base);
    await popup.locator("#conversation-id").fill(config.conversationId);
    await popup.locator("#participant").selectOption(config.participant);
    await popup.locator("#token").fill(config.token);
    await popup.locator("#save").click();
    await popup.waitForFunction(()=>
      document.querySelector("#notice")?.textContent.includes("Konfiguracja zapisana"),
      null,{timeout:9000});
    await popup.locator("#start").click();
    await popup.waitForFunction(()=>
      document.querySelector("#conversation-status")?.textContent.includes("aktywna"),
      null,{timeout:9000});
    return {context,popup,worker};
  } catch(error){await context.close();throw error;}
}

async function main(){
  const temp=mkdtempSync(join(tmpdir(),"jnb-s3-chromium-"));
  const sessions=[];
  let process;
  try{
    const db=join(temp,"bridge.sqlite3");
    const bootstrap=execFileSync(python,["-m","app.cli","--db",db],{
      cwd:server,windowsHide:true,encoding:"utf8"
    });
    const match=regex=>{const m=bootstrap.match(regex);assert.ok(m,"bootstrap failed");return m[1];};
    const conversationId=match(/Conversation ID:\s*([\da-f-]{36})/);
    const ninaToken=match(/NINA TOKEN:\s*(\S+)/);
    const jagodaToken=match(/JAGODA TOKEN:\s*(\S+)/);
    const httpPort=await port();
    const base=`http://127.0.0.1:${httpPort}`;
    process=spawn(python,["-m","uvicorn","app.main:app","--host","127.0.0.1",
      "--port",String(httpPort),"--no-access-log"],{
      cwd:server,env:{...globalThis.process.env,JNB_DB_PATH:db},
      windowsHide:true,stdio:"ignore"
    });
    let healthy=false;
    for(let i=0;i<90;i++){
      if(process.exitCode!==null)break;
      try{
        if((await fetch(base+"/v1/health",{signal:AbortSignal.timeout(800)})).ok){
          healthy=true;break;
        }
      }catch{}
      await sleep(120);
    }
    assert.ok(healthy,"Uvicorn failed startup");
    const executable=browserExecutable();
    const nina=await browserProfile(join(temp,"nina"),executable,base,{
      conversationId,participant:"nina",token:ninaToken
    });
    sessions.push(nina.context);
    const jagoda=await browserProfile(join(temp,"jagoda"),executable,base,{
      conversationId,participant:"jagoda",token:jagodaToken
    });
    sessions.push(jagoda.context);

    const chatUrl="https://chatgpt.com/c/"+randomUUID();
    const otherUrl="https://chatgpt.com/c/"+randomUUID();
    let fixtureBody = fixture;
    await jagoda.context.route("https://chatgpt.com/**",route =>
      route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:fixtureBody}));

    const irrelevant=await jagoda.context.newPage();
    await irrelevant.goto(otherUrl);
    const dedicated=await jagoda.context.newPage();
    await dedicated.goto(chatUrl);
    assert.ok((await dedicated.locator("#prompt-textarea").count())===1);

    // The popup must not bind an unrelated URL, even though another ChatGPT tab exists.
    await jagoda.popup.locator("#chat-url").fill("https://chatgpt.com/c/"+randomUUID());
    await jagoda.popup.locator("#bind-chatgpt").click();
    await jagoda.popup.waitForFunction(() =>
      document.querySelector("#notice")?.textContent.includes("Otwórz podany wątek"),
      null,{timeout:9000});
    assert.equal((await httpJson(base,jagodaToken,"GET",`/v1/conversations/${conversationId}`)).message_count,0);
    console.log("MOCK CHROMIUM BIND SCOPE PASS: unrelated tabs do not bind.");

    await nina.popup.locator("#message").fill("Cześć Jagodo, tu Nina (Sprint 3).");
    await nina.popup.locator("#send").click();
    await nina.popup.waitForFunction(()=>
      document.querySelector("#notice")?.textContent.includes("Wiadomość zapisana"),
      null,{timeout:9000});

    // A matching tab without a ready editor must not consume server claim/lease.
    await irrelevant.evaluate(() => document.querySelector("#prompt-textarea").remove());
    await jagoda.popup.locator("#chat-url").fill(otherUrl);
    await jagoda.popup.locator("#bind-chatgpt").click();
    await jagoda.popup.waitForFunction(() =>
      document.querySelector("#notice")?.textContent.includes("Brak gotowego edytora"),
      null,{timeout:9000});
    const untouched=await httpJson(base,jagodaToken,"GET","/v1/inbox");
    assert.equal(untouched.messages.length,1);
    assert.equal(untouched.messages[0].status,"queued");
    assert.equal(untouched.messages[0].attempts,0);
    console.log("MOCK CHROMIUM PRE-CLAIM GUARD PASS: missing composer leaves message queued.");

    await jagoda.popup.locator("#chat-url").fill(chatUrl);
    await jagoda.popup.locator("#bind-chatgpt").click();
    await jagoda.popup.waitForFunction(() =>
      document.querySelector("#chatgpt-status")?.textContent.includes("Przypięto") ||
      document.querySelector("#chatgpt-status")?.textContent.includes("Zadanie"),
      null,{timeout:13000});

    let result=null;
    const deadline=Date.now()+28000;
    while(Date.now()<deadline){
      result=await httpJson(base,ninaToken,"GET",`/v1/conversations/${conversationId}`);
      if(result.message_count===2 && result.completed_count>=1) break;
      await sleep(400);
    }
    assert.equal(result?.message_count,2,"Adapter did not publish a reply");
    assert.equal(result?.completed_count,1,"Jagoda did not ACK original message");

    const inbox=await httpJson(base,ninaToken,"GET","/v1/inbox");
    assert.equal(inbox.messages.length,1);
    const reply=inbox.messages[0];
    assert.equal(reply.sender_id,"jagoda");
    assert.ok(reply.content.includes("Cześć Nino! Tu Jagoda."));
    assert.ok(!reply.content.includes("OLD ASSISTANT"));
    assert.ok(!reply.content.includes("PRIVATE"));
    const lastUser=await dedicated.locator('[data-message-author-role="user"]').last().textContent();
    assert.ok(lastUser.includes("Cześć Jagodo, tu Nina (Sprint 3)."));
    assert.equal(await irrelevant.locator('[data-message-author-role="user"]').count(),0);
    console.log("MOCK CHROMIUM ADAPTER PASS: exact bound tab, one prompt, one extracted new answer, server reply + original ACK.");

    await nina.popup.locator("#sync").click();
    await nina.popup.waitForFunction(() =>
      document.querySelector("#inbox")?.textContent.includes("Cześć Nino! Tu Jagoda."),
      null,{timeout:9000});
    await nina.popup.getByRole("button",{name:"Potwierdź odbiór (ACK)"}).click();
    await nina.popup.waitForFunction(() =>
      document.querySelector("#conversation-status")?.textContent.includes("STOP"),
      null,{timeout:9000});
    const closed=await httpJson(base,ninaToken,"GET",`/v1/conversations/${conversationId}`);
    assert.equal(closed.status,"stopped");
    assert.equal(closed.message_count,2);
    assert.equal(closed.completed_count,2);
    console.log("MOCK CHROMIUM TWO-PARTY E2E PASS: Nina manual send, Jagoda automated DOM reply, Nina ACK, STOP.");
    // Manual STOP must prevent publication even when simulated generation
    // finishes after the operator has stopped the experiment.
    const stoppedConversation = randomUUID();
    execFileSync(python, [
      "-c",
      "import sqlite3,sys,datetime; c=sqlite3.connect(sys.argv[1]); c.execute('INSERT INTO conversations(id,status,max_messages,created_at) VALUES(?,?,2,?)',(sys.argv[2],sys.argv[3],datetime.datetime.now(datetime.timezone.utc).isoformat())); c.commit(); c.close()",
      db, stoppedConversation, "open",
    ], {cwd:server,windowsHide:true});
    const reconfigure = async (page, token) => {
      await page.locator("#conversation-id").fill(stoppedConversation);
      await page.locator("#token").fill(token);
      await page.locator("#save").click();
      await page.waitForFunction(() =>
        document.querySelector("#notice")?.textContent.includes("Konfiguracja zapisana"),
        null,{timeout:9000});
      await page.locator("#start").click();
      await page.waitForFunction(() =>
        document.querySelector("#conversation-status")?.textContent.includes("aktywna"),
        null,{timeout:9000});
    };
    await reconfigure(nina.popup,ninaToken);
    await reconfigure(jagoda.popup,jagodaToken);
    fixtureBody=fixture.replace("}, 500);","}, 4000);");
    const nextChatUrl="https://chatgpt.com/c/"+randomUUID();
    const nextChat=await jagoda.context.newPage();
    await nextChat.goto(nextChatUrl);
    await nina.popup.locator("#message").fill("Nina: kolejny test z ręcznym STOP.");
    await nina.popup.locator("#send").click();
    await nina.popup.waitForFunction(() =>
      document.querySelector("#notice")?.textContent.includes("Wiadomość zapisana"),
      null,{timeout:9000});
    await jagoda.popup.locator("#chat-url").fill(nextChatUrl);
    await jagoda.popup.locator("#bind-chatgpt").click();
    await jagoda.popup.waitForFunction(() =>
      document.querySelector("#chatgpt-status")?.textContent.includes("dispatched"),
      null,{timeout:10000});
    jagoda.popup.once("dialog", dialog => dialog.accept());
    await jagoda.popup.locator("#stop").click();
    await jagoda.popup.waitForFunction(() =>
      document.querySelector("#conversation-status")?.textContent.includes("STOP"),
      null,{timeout:9000});
    await sleep(5700);
    const stoppedState=await httpJson(base,ninaToken,"GET",
      `/v1/conversations/${stoppedConversation}`);
    assert.equal(stoppedState.status,"stopped");
    assert.equal(stoppedState.message_count,1,"STOP must suppress a late ChatGPT result");
    console.log("MOCK CHROMIUM STOP DURING GENERATION PASS: late model result not sent.");
    console.log("NOTICE: this used a synthetic ChatGPT DOM; no actual ChatGPT model or user account was tested.");
  } finally {
    for(const context of sessions.reverse()){try{await context.close();}catch{}}
    if(process && process.exitCode===null){
      await new Promise(resolvePromise=>{
        process.once("exit",resolvePromise);process.kill();setTimeout(resolvePromise,3500);
      });
    }
    try{rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:150});}
    catch(error){console.error("Temporary fixture cleanup:",error.message);}
  }
}
main().catch(error=>{console.error("SPRINT 3 CHROMIUM TEST FAILED:",error.stack);globalThis.process.exitCode=1;});
