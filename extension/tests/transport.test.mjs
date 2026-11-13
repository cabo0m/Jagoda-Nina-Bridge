import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve, dirname} from "node:path";
import {execFileSync, spawn} from "node:child_process";
import {createServer} from "node:net";
import {setTimeout as sleep} from "node:timers/promises";
import vm from "node:vm";
import {webcrypto} from "node:crypto";
import * as core from "../bridge-core.mjs";
import * as adapter from "../chatgpt-adapter.mjs";

const extension = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, "")), "..");
const server = resolve(extension, "..", "server");
const python = join(server, ".venv", "Scripts", "python.exe");
const source = readFileSync(join(extension, "background.js"), "utf8")
  .replace(/^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/(bridge-core|chatgpt-adapter)\.mjs["'];?\s*/gm, "");
assert.ok(!source.includes('from "./bridge-core.mjs"'), "Test must execute actual worker source");

function area() {
  const data = Object.create(null);
  return {
    data,
    async get(keys) {
      const result = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (Object.hasOwn(data, key)) result[key] = data[key];
      }
      return result;
    },
    async set(items) { Object.assign(data, items); },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
    async setAccessLevel() {},
  };
}

function createWorker(fetchOverride = fetch) {
  const local = area(), session = area();
  const permissions = new Set();
  const alarms = new Map();
  const listeners = {};
  const runtime = {
    id: "jnb-test",
    getURL(name) {return "chrome-extension://jnb-test/" + name;},
    onMessage: {addListener(fn) {listeners.message = fn;}},
    onInstalled: {addListener(fn) {listeners.installed = fn;}},
    onStartup: {addListener(fn) {listeners.startup = fn;}},
  };
  const chrome = {
    runtime,
    storage: {local, session},
    alarms: {
      onAlarm: {addListener(fn) {listeners.alarm = fn;}},
      async create(name, info) { alarms.set(name, info); },
      async clear(name) {return alarms.delete(name);},
    },
    permissions: {
      async contains({origins}) {return origins.every(origin => permissions.has(origin));},
    },
    sidePanel: {
      async setPanelBehavior(options) {listeners.sidePanelBehavior = options;},
    },
    tabs: {
      async query() {return [];},
    },
  };
  const context = vm.createContext({
    ...core, ...adapter, chrome, crypto: webcrypto, fetch: fetchOverride,
    URL, AbortController, setTimeout, clearTimeout, console,
  });
  new vm.Script(source, {filename: join(extension, "background.js")}).runInContext(context);
  assert.equal(typeof listeners.message, "function");
  async function call(message, sender={id: runtime.id, url: runtime.getURL("popup.html")}) {
    return await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error("Worker callback timed out")), 10000);
      const accepted = listeners.message(message, sender, value => {
        clearTimeout(timer);
        resolvePromise(value);
      });
      if (accepted === false && sender.id !== runtime.id) {
        // Security rejects return synchronously, still uses a callback.
      }
    });
  }
  async function good(message) {
    const result = await call(message);
    assert.equal(result.ok, true, result.error || "worker operation failed");
    return result.result;
  }
  async function bad(message, match) {
    const result = await call(message);
    assert.equal(result.ok, false);
    if (match) assert.match(result.error, match);
    return result.error;
  }
  return {
    chrome, permissions, alarms, local, session, listeners, call, good, bad,
    grant(origin) {permissions.add(origin);},
  };
}

async function freePort() {
  const socket = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    socket.once("error", rejectPromise);
    socket.listen(0, "127.0.0.1", resolvePromise);
  });
  const port = socket.address().port;
  await new Promise(resolvePromise => socket.close(resolvePromise));
  return port;
}

async function withServer(run) {
  const temp = mkdtempSync(join(tmpdir(), "jnb-mv3-"));
  const db = join(temp, "bridge.sqlite3");
  let child;
  try {
    const stdout = execFileSync(python, ["-m", "app.cli", "--db", db], {
      cwd: server, encoding: "utf8", windowsHide: true,
    });
    const get = pattern => {
      const match = stdout.match(pattern);
      assert.ok(match, "Missing bootstrap value");
      return match[1];
    };
    const setup = {
      id: get(/Conversation ID:\s*([0-9a-f-]{36})/i),
      nina: get(/NINA TOKEN:\s*(\S+)/),
      jagoda: get(/JAGODA TOKEN:\s*(\S+)/),
    };
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    child = spawn(python, [
      "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
      "--port", String(port), "--no-access-log",
    ], {
      cwd: server,
      env: {...process.env, JNB_DB_PATH: db},
      stdio: "ignore",
      windowsHide: true,
    });
    let healthy = false;
    for (let i = 0; i < 80; i += 1) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(base + "/v1/health", {signal: AbortSignal.timeout(800)});
        if (response.ok) {healthy = true; break;}
      } catch {}
      await sleep(150);
    }
    assert.ok(healthy, "Real Uvicorn failed to start");
    await run({base, setup, db});
  } finally {
    if (child && child.exitCode === null) {
      await new Promise(resolvePromise => {
        child.once("exit", resolvePromise);
        child.kill();
        setTimeout(resolvePromise, 3000);
      });
    }
    try { rmSync(temp, {recursive: true, force: true, maxRetries: 5, retryDelay: 150}); }
    catch { /* Windows SQLite handles may linger briefly. */ }
  }
}

async function setupWorker(worker, base, setup, role) {
  const config = {
    serverUrl: base, conversationId: setup.id, participant: role,
  };
  worker.grant(core.permissionOrigin(base));
  await worker.good({type: "CONFIGURE", config, token: setup[role]});
  return config;
}

test("normalization, strict scope and minimum manifest permissions", () => {
  assert.equal(core.normalizeServerUrl("http://127.0.0.1:8765/"), "http://127.0.0.1:8765");
  assert.equal(core.normalizeServerUrl("https://bridge.example.org/"), "https://bridge.example.org");
  for (const url of [
    "http://example.org/", "https://user:pass@example.org/", "https://example.org/api",
    "https://example.org/?token=x", "file:///etc/passwd",
  ]) {
    assert.throws(() => core.normalizeServerUrl(url));
  }
  assert.throws(() => core.validateUuid("not-an-uuid"));
  assert.throws(() => core.validateToken("test"));
  const manifest = JSON.parse(readFileSync(join(extension, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions, ["storage", "alarms", "scripting", "sidePanel"]);
  assert.equal(manifest.side_panel.default_path, "popup.html");
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.manifest_version, 3);
  assert.ok(!("content_scripts" in manifest));
  assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1/*", "http://localhost/*", "https://chatgpt.com/*"]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
  assert.ok(!manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(!manifest.permissions.includes("tabs"));
  assert.ok(!("content_scripts" in manifest));
});

test("two isolated extension workers exchange two messages over REAL HTTP and STOP", async () => {
  await withServer(async ({base, setup}) => {
    const nina = createWorker();
    const jagoda = createWorker();
    await setupWorker(nina, base, setup, "nina");
    await setupWorker(jagoda, base, setup, "jagoda");
    const initial = await nina.good({type: "GET_STATUS"});
    assert.equal(initial.tokenReady, true);
    assert.ok(!JSON.stringify(initial).includes(setup.nina));
    assert.ok(!JSON.stringify(nina.local.data[core.CONFIG_KEY]).includes(setup.nina));
    assert.equal(nina.local.data[core.TOKEN_KEY], setup.nina);
    assert.equal(nina.session.data[core.TOKEN_KEY], undefined);
    await nina.good({type: "START"});
    await jagoda.good({type: "START"});
    assert.ok(nina.alarms.has(core.ALARM_NAME));
    const send = await nina.good({type: "SEND", content: "Nina: Cześć Jagodo."});
    assert.equal(send.duplicate, false);
    const firstId = send.id;
    await jagoda.good({type: "SYNC"});
    const inboxJagoda = await jagoda.good({type: "GET_STATUS"});
    assert.equal(inboxJagoda.snapshot.messages.length, 1);
    assert.equal(inboxJagoda.snapshot.messages[0].id, firstId);
    assert.equal(inboxJagoda.snapshot.messages[0].content, "Nina: Cześć Jagodo.");
    assert.equal((await nina.good({type: "GET_STATUS"})).snapshot.messages.length, 0);
    await jagoda.good({type: "ACK", messageId: firstId});
    assert.equal((await jagoda.good({type: "GET_STATUS"})).snapshot.lastInboundId, firstId);
    const reply = await jagoda.good({type: "SEND", content: "Jagoda: Cześć Nino!"});
    await nina.good({type: "SYNC"});
    const inboxNina = (await nina.good({type: "GET_STATUS"})).snapshot.messages;
    assert.equal(inboxNina.length, 1);
    assert.equal(inboxNina[0].id, reply.id);
    assert.equal(inboxNina[0].reply_to_id, firstId);
    await nina.good({type: "ACK", messageId: reply.id});
    const result = await nina.good({type: "GET_STATUS"});
    assert.equal(result.snapshot.conversation.status, "stopped");
    assert.equal(result.snapshot.conversation.message_count, 2);
    assert.equal(result.snapshot.conversation.completed_count, 2);
    assert.equal(result.active, false);
    assert.equal(nina.alarms.has(core.ALARM_NAME), false);
    await nina.bad({type: "START"}, /zatrzymana/i);
    await jagoda.good({type: "SYNC"});
    assert.equal((await jagoda.good({type: "GET_STATUS"})).active, false);
    const denied = await nina.call({type: "GET_STATUS"}, {id: "unrelated-extension"});
    assert.equal(denied.ok, false);
  });
});

test("timeout after server accepted send reuses same idempotency key", async () => {
  await withServer(async ({base, setup}) => {
    let dropResponse = true;
    const flakyFetch = async (url, init) => {
      const response = await fetch(url, init);
      if (dropResponse && init.method === "POST" && url.endsWith("/messages")) {
        dropResponse = false;
        throw new Error("simulated response lost after commit");
      }
      return response;
    };
    const nina = createWorker(flakyFetch);
    await setupWorker(nina, base, setup, "nina");
    await nina.good({type: "START"});
    await nina.bad({type: "SEND", content: "test once"}, /response lost/);
    assert.equal((await nina.good({type: "GET_STATUS"})).pendingSend, true);
    await nina.bad({type: "SEND", content: "DIFFERENT"}, /Ponów ten sam tekst/);
    const retry = await nina.good({type: "SEND", content: "test once"});
    assert.equal(retry.duplicate, true);
    const summary = await nina.good({type: "GET_STATUS"});
    assert.equal(summary.pendingSend, false);
    assert.equal(summary.snapshot.conversation.message_count, 1);
  });
});

test("STOP is local-first and reports remote failure until explicit retry", async () => {
  await withServer(async ({base, setup}) => {
    let failStop = true;
    const flakyFetch = async (url, init) => {
      if (failStop && url.endsWith("/stop")) {
        throw new Error("simulated network outage");
      }
      return fetch(url, init);
    };
    const nina = createWorker(flakyFetch);
    await setupWorker(nina, base, setup, "nina");
    await nina.good({type: "START"});
    const incomplete = await nina.good({type: "STOP"});
    assert.equal(incomplete.localStopped, true);
    assert.equal(incomplete.remoteStopped, false);
    let status = await nina.good({type: "GET_STATUS"});
    assert.equal(status.active, false);
    assert.equal(status.snapshot.remoteStopUnknown, true);
    await nina.bad({type: "START"}, /nie został potwierdzony/);
    failStop = false;
    const complete = await nina.good({type: "STOP"});
    assert.equal(complete.remoteStopped, true);
    status = await nina.good({type: "GET_STATUS"});
    assert.equal(status.snapshot.conversation.status, "stopped");
    assert.equal(status.snapshot.remoteStopUnknown, false);
  });
});

test("forbidden origin and persistent local token survive loss of session storage", async () => {
  const worker = createWorker();
  const fake = {
    serverUrl: "http://127.0.0.1:8765",
    conversationId: "00000000-0000-0000-0000-000000000001",
    participant: "nina",
  };
  await worker.bad({type: "CONFIGURE", config: fake, token: "x".repeat(40)}, /Brak zgody/);
  worker.grant(core.permissionOrigin(fake.serverUrl));
  await worker.good({type: "CONFIGURE", config: fake, token: "x".repeat(40)});
  await worker.session.remove(core.TOKEN_KEY);
  const retained = await worker.good({type: "GET_STATUS"});
  assert.equal(retained.tokenReady, true);
  assert.equal(worker.local.data[core.TOKEN_KEY], "x".repeat(40));
  await worker.local.remove(core.TOKEN_KEY);
  const lost = await worker.good({type: "GET_STATUS"});
  assert.equal(lost.tokenReady, false);
  await worker.bad({type: "START"}, /token/i);
});

test("ChatGPT thread binding requires exact dedicated UUID and no other paths", () => {
  const id = "f00df00d-1111-4222-8333-aabbccddee11";
  assert.equal(adapter.normalizeThreadUrl("https://chatgpt.com/c/" + id), "https://chatgpt.com/c/" + id);
  for (const invalid of [
    "https://chatgpt.com/", "https://chatgpt.com/c",
    "https://chatgpt.com/c/" + id + "?model=gpt",
    "https://www.chatgpt.com/c/" + id,
    "https://chatgpt.com/g/gpt-example/c/" + id,
    "http://chatgpt.com/c/" + id,
    "https://chatgpt.com/c/" + id + "/other",
    "https://attacker.example/c/" + id,
  ]) {
    assert.throws(() => adapter.normalizeThreadUrl(invalid));
  }
  const prompt=adapter.formatBridgePrompt("Cześć Jagodo, tu Nina.");
  assert.ok(prompt.includes("[POCZĄTEK WIADOMOŚCI NINY]"));
  assert.ok(prompt.includes("Cześć Jagodo, tu Nina."));
  assert.ok(prompt.includes("NIE ujawniaj prywatnej pamięci"));
  assert.equal(adapter.validateBridgeOutput("  Cześć Nino  "), "Cześć Nino");
  assert.throws(() => adapter.validateBridgeOutput(" ".repeat(5)));
  assert.throws(() => adapter.validateBridgeOutput("x".repeat(4001)));
});

test("emergency STOP bypasses a blocked inbox fetch and never resumes stale polling", async () => {
  await withServer(async ({base, setup}) => {
    let blockInbox = false;
    let releaseInbox = null;
    const delayed = async (url, options) => {
      if (blockInbox && url.endsWith("/v1/inbox?limit=10")) {
        await new Promise(resolve => { releaseInbox = resolve; });
      }
      return fetch(url, options);
    };
    const nina = createWorker(delayed);
    await setupWorker(nina, base, setup, "nina");
    await nina.good({type: "START"});
    blockInbox = true;
    const delayedSync = nina.good({type: "SYNC"});
    try {
      for (let i = 0; i < 100 && !releaseInbox; ++i) await sleep(20);
      assert.equal(typeof releaseInbox, "function", "Fetch must be held before STOP");
      const result = await Promise.race([
        nina.good({type: "STOP"}),
        sleep(4000).then(() => {throw new Error("STOP waited for a blocked inbox fetch");}),
      ]);
      assert.equal(result.localStopped, true);
      assert.equal(result.remoteStopped, true);
      assert.equal(nina.local.data[core.ACTIVE_KEY], false);
    } finally {
      if (releaseInbox) releaseInbox();
    }
    await delayedSync;
    const final = await nina.good({type: "GET_STATUS"});
    assert.equal(final.snapshot.conversation.status, "stopped");
    assert.equal(final.active, false);
    assert.equal(final.snapshot.remoteStopUnknown, false);
  });
});

test("STOP works locally even after both token stores were erased", async () => {
  const worker = createWorker();
  const config = {
    serverUrl: "http://127.0.0.1:8765",
    conversationId: "00000000-0000-0000-0000-000000000001",
    participant: "jagoda",
  };
  worker.grant(core.permissionOrigin(config.serverUrl));
  await worker.good({type: "CONFIGURE", config, token: "x".repeat(40)});
  await worker.local.remove(core.TOKEN_KEY);
  await worker.session.remove(core.TOKEN_KEY);
  await worker.local.set({[core.ACTIVE_KEY]: true});
  const status = await worker.good({type: "STOP"});
  assert.equal(status.localStopped, true);
  assert.equal(status.remoteStopped, false);
  assert.equal(worker.local.data[core.ACTIVE_KEY], false);
  assert.equal((await worker.good({type: "GET_STATUS"})).snapshot.remoteStopUnknown, true);
});


test("switch to fresh server conversation retains token and starts without reconfiguration", async () => {
  await withServer(async ({base, setup, db}) => {
    const jagoda=createWorker();
    await setupWorker(jagoda,base,setup,"jagoda");
    await jagoda.good({type:"START"});
    await jagoda.good({type:"STOP"});
    const stopped=await jagoda.good({type:"GET_STATUS"});
    assert.equal(stopped.snapshot.conversation.status,"stopped");
    const newId="a22ba41e-9674-4b15-a858-504b37c31222";
    execFileSync(python,["-c",
      "import sqlite3,sys,datetime; c=sqlite3.connect(sys.argv[1]); c.execute('INSERT INTO conversations(id,status,max_messages,created_at) VALUES(?,?,2,?)',(sys.argv[2],'open',datetime.datetime.now(datetime.timezone.utc).isoformat())); c.commit(); c.close()",
      db,newId],{cwd:server,windowsHide:true});
    const selected=await jagoda.good({type:"USE_CURRENT_CONVERSATION"});
    assert.equal(selected.active,true);
    assert.equal(selected.tokenReady,true);
    assert.equal(selected.config.conversationId,newId);
    assert.equal(selected.snapshot.conversation.status,"open");
    assert.equal(selected.snapshot.conversation.message_count,0);
    assert.equal(jagoda.local.data[core.TOKEN_KEY],setup.jagoda);
    assert.equal(jagoda.local.data[core.CONFIG_KEY].conversationId,newId);
    assert.ok(!JSON.stringify(selected).includes(setup.jagoda));
    const old=await fetch(base+"/v1/conversations/"+setup.id,{
      headers:{"Authorization":"Bearer "+setup.jagoda}
    });
    assert.equal((await old.json()).status,"stopped");
  });
});


test("fresh conversation is created on demand after STOP without reentering token", async () => {
  await withServer(async ({base, setup}) => {
    const jagoda=createWorker();
    await setupWorker(jagoda,base,setup,"jagoda");
    await jagoda.good({type:"START"});
    await jagoda.good({type:"STOP"});
    const next=await jagoda.good({type:"USE_CURRENT_CONVERSATION"});
    assert.notEqual(next.config.conversationId,setup.id);
    assert.equal(next.snapshot.conversation.status,"open");
    assert.equal(next.active,true);
    assert.equal(next.tokenReady,true);
    assert.equal(jagoda.local.data[core.TOKEN_KEY],setup.jagoda);
    const active=await fetch(base+"/v1/current-conversation",{
      headers:{"Authorization":"Bearer "+setup.jagoda}
    });
    assert.equal((await active.json()).id,next.config.conversationId);
  });
});


test("hashed extension control tab is trusted but query paths and foreign pages are rejected", async () => {
  const worker=createWorker();
  const trusted={id:worker.chrome.runtime.id,
    url:worker.chrome.runtime.getURL("popup.html")+"#chatgpt-title"};
  const status=await worker.call({type:"GET_STATUS"},trusted);
  assert.equal(status.ok,true,status.error);
  for (const value of [
    worker.chrome.runtime.getURL("popup.html")+"?privileged=true",
    worker.chrome.runtime.getURL("background.html"),
    "https://chatgpt.com/c/00000000-0000-4000-8000-000000000000",
  ]) {
    const reply=await worker.call({type:"GET_STATUS"},{
      id:worker.chrome.runtime.id,url:value,
    });
    assert.equal(reply.ok,false,"Accepted untrusted sender: "+value);
    assert.match(reply.error,/Odrzucono/);
  }
});

test("saved token can be reused when editing UUID without exposing it or changing identity", async () => {
  const worker=createWorker();
  const url="http://127.0.0.1:8765";
  const previous={
    serverUrl:url,conversationId:"00000000-0000-4000-8000-000000000042",
    participant:"jagoda",
  };
  worker.grant(core.permissionOrigin(url));
  const token="A".repeat(48);
  await worker.good({type:"CONFIGURE",config:previous,token});
  const updated={...previous,conversationId:"00000000-0000-4000-8000-000000000043"};
  const changed=await worker.good({type:"CONFIGURE",config:updated,token:""});
  assert.equal(changed.tokenReady,true);
  assert.equal(changed.config.conversationId,updated.conversationId);
  assert.ok(!JSON.stringify(changed).includes(token));
  assert.equal(worker.local.data[core.TOKEN_KEY],token);
  await worker.bad({type:"CONFIGURE",
    config:{...updated,participant:"nina"},token:""},/token/i);
  assert.equal(worker.local.data[core.CONFIG_KEY].participant,"jagoda");
});
