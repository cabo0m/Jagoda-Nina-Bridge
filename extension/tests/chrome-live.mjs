/** Real Chromium unpacked-extension E2E. Runs two clean browser profiles and real Uvicorn.
 * Only local temporary SQLite; no user Chrome profiles, ChatGPT sessions or user secrets.
 */
import assert from "node:assert/strict";
import {existsSync, mkdtempSync, readdirSync, rmSync} from "node:fs";
import {tmpdir, homedir} from "node:os";
import {join, resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {spawn, execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {createServer} from "node:net";
import {setTimeout as sleep} from "node:timers/promises";
import {chromium} from "playwright-core";

const extension = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = resolve(extension, "..", "server");
const python = join(server, ".venv", "Scripts", "python.exe");

function findChromium() {
  const cache = join(homedir(), "AppData", "Local", "ms-playwright");
  for (const name of readdirSync(cache).filter(x => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const binary = join(cache, name, "chrome-win64", "chrome.exe");
    if (existsSync(binary)) return binary;
  }
  throw new Error("No installed Playwright Chromium found");
}

async function getPort() {
  const listener = createServer();
  await new Promise((ok, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", ok);
  });
  const port = listener.address().port;
  await new Promise(resolvePromise => listener.close(resolvePromise));
  return port;
}

async function provision(path) {
  const raw = execFileSync(python, ["-m", "app.cli", "--db", path], {
    cwd: server, encoding: "utf8", windowsHide: true,
  });
  const pick = pattern => {
    const m = raw.match(pattern);
    assert.ok(m, "Missing bootstrap field");
    return m[1];
  };
  return {
    conversationId: pick(/Conversation ID:\s*([0-9a-f-]{36})/i),
    nina: pick(/NINA TOKEN:\s*(\S+)/),
    jagoda: pick(/JAGODA TOKEN:\s*(\S+)/),
  };
}

async function openProfile(profile, binary, role, base, setup) {
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: binary,
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    viewport: {width: 480, height: 850},
  });
  try {
    const worker = context.serviceWorkers().find(w => w.url().startsWith("chrome-extension://")) ??
      await context.waitForEvent("serviceworker", {timeout: 13000});
    assert.ok(worker.url().startsWith("chrome-extension://"), "Extension service worker not loaded");
    const extensionId = new URL(worker.url()).hostname;
    const page = await context.newPage();
    page.on("pageerror", error => console.error(`[${role}] POPUP ERROR: ${error.message}`));
    worker.on("console", message => {
      if (message.type() === "error") console.error(`[${role}] WORKER ERROR: ${message.text()}`);
    });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.locator("#server-url").fill(base);
    await page.locator("#participant").selectOption(role);
    await page.locator("#conversation-id").fill(setup.conversationId);
    await page.locator("#token").fill(setup[role]);
    console.log(`[${role}] extension loaded, submitting configuration`);
    await page.locator("#save").click();
    try {
      await page.waitForFunction(() => document.querySelector("#notice")?.textContent.trim().length > 0, null, {timeout: 9000});
    } catch {
      const snapshot = await page.locator("#notice").textContent();
      throw new Error(`[${role}] CONFIG timeout; notice=${JSON.stringify(snapshot)}`);
    }
    const configured = await page.locator("#notice").textContent();
    if (!configured.includes("Konfiguracja zapisana")) {
      throw new Error(`[${role}] CONFIG failure: ${configured}`);
    }
    console.log(`[${role}] config saved, starting synchronization`);
    await page.locator("#start").click();
    try {
      await page.waitForFunction(() => document.querySelector("#conversation-status")?.textContent.includes("aktywna"), null, {timeout: 9000});
    } catch {
      throw new Error(`[${role}] START failure: ${await page.locator("#notice").textContent()}`);
    }
    return {context, page};
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function waitText(page, selector, needle, timeout = 9000) {
  await page.waitForFunction(
    ([selector, needle]) => document.querySelector(selector)?.textContent.includes(needle),
    [selector, needle],
    {timeout},
  );
}

async function main() {
  const directory = mkdtempSync(join(tmpdir(), "jnb-real-chrome-"));
  let serverProcess;
  const contexts = [];
  try {
    const db = join(directory, "bridge.sqlite3");
    const setup = await provision(db);
    const port = await getPort();
    const base = `http://127.0.0.1:${port}`;
    serverProcess = spawn(python, [
      "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
      "--port", String(port), "--no-access-log",
    ], {
      cwd: server, env: {...process.env, JNB_DB_PATH: db},
      stdio: "ignore", windowsHide: true,
    });
    let healthy = false;
    for (let i = 0; i < 80; i++) {
      if (serverProcess.exitCode !== null) break;
      try {
        const answer = await fetch(base + "/v1/health", {signal: AbortSignal.timeout(800)});
        if (answer.ok) {healthy = true; break;}
      } catch {}
      await sleep(150);
    }
    assert.ok(healthy, "Local HTTP server unavailable");
    const binary = findChromium();
    const nina = await openProfile(join(directory, "chrome-nina"), binary, "nina", base, setup);
    contexts.push(nina.context);
    const jagoda = await openProfile(join(directory, "chrome-jagoda"), binary, "jagoda", base, setup);
    contexts.push(jagoda.context);

    await nina.page.locator("#message").fill("Nina: Cześć Jagodo! (real Chromium)");
    await nina.page.locator("#send").click();
    await waitText(nina.page, "#notice", "Wiadomość zapisana");

    // Check the real Chrome alarm: Jagoda should receive the message without
    // pressing refresh or recreating the popup (may take ~30 seconds).
    await waitText(jagoda.page, "#inbox", "Nina: Cześć Jagodo! (real Chromium)", 55000);
    console.log("REAL CHROMIUM ALARM PASS: background inbox updated without manual refresh.");
    await jagoda.page.getByRole("button", {name: "Potwierdź odbiór (ACK)"}).click();
    await waitText(jagoda.page, "#notice", "Odbiór wiadomości potwierdzony");

    await jagoda.page.locator("#message").fill("Jagoda: Cześć Nino! (real Chromium)");
    await jagoda.page.locator("#send").click();
    await waitText(jagoda.page, "#notice", "Wiadomość zapisana");

    await nina.page.locator("#sync").click();
    await waitText(nina.page, "#inbox", "Jagoda: Cześć Nino! (real Chromium)");
    await nina.page.getByRole("button", {name: "Potwierdź odbiór (ACK)"}).click();
    await waitText(nina.page, "#conversation-status", "STOP");

    const response = await fetch(base + "/v1/conversations/" + setup.conversationId, {
      headers: {Authorization: `Bearer ${setup.nina}`},
    });
    assert.equal(response.status, 200);
    const finalState = await response.json();
    assert.equal(finalState.status, "stopped");
    assert.equal(finalState.message_count, 2);
    assert.equal(finalState.completed_count, 2);
    console.log("REAL CHROMIUM E2E PASS: 2 unpacked instances, 2 profiles, real FastAPI HTTP, 2 messages, 2 ACK, STOP.");

    // Separate temporary conversation tests the actual visible manual STOP
    // button and confirmation dialog. This is only a test fixture, not a
    // runtime operation supported for end users in the first MVP.
    const manualConversation = randomUUID();
    execFileSync(python, [
      "-c",
      "import sqlite3,sys,datetime; c=sqlite3.connect(sys.argv[1]); c.execute('INSERT INTO conversations(id,status,max_messages,created_at) VALUES(?,?,2,?)',(sys.argv[2],sys.argv[3],datetime.datetime.now(datetime.timezone.utc).isoformat())); c.commit(); c.close()",
      db, manualConversation, "open",
    ], {cwd: server, windowsHide: true});
    await nina.page.locator("#conversation-id").fill(manualConversation);
    await nina.page.locator("#token").fill(setup.nina);
    await nina.page.locator("#save").click();
    await waitText(nina.page, "#notice", "Konfiguracja zapisana");
    await nina.page.locator("#start").click();
    await waitText(nina.page, "#conversation-status", "aktywna");
    nina.page.once("dialog", dialog => dialog.accept());
    await nina.page.locator("#stop").click();
    await waitText(nina.page, "#conversation-status", "STOP");
    const stopResponse = await fetch(base + "/v1/conversations/" + manualConversation, {
      headers: {Authorization: `Bearer ${setup.nina}`},
    });
    assert.equal((await stopResponse.json()).status, "stopped");
    console.log("REAL CHROMIUM MANUAL STOP PASS: confirmed in popup and server.");
    console.log("Both temporary browser profiles and local server are cleaned up.");
  } finally {
    for (const context of contexts.reverse()) {
      try { await context.close(); } catch {}
    }
    if (serverProcess && serverProcess.exitCode === null) {
      await new Promise(resolvePromise => {
        serverProcess.once("exit", resolvePromise);
        serverProcess.kill();
        setTimeout(resolvePromise, 3500);
      });
    }
    try {rmSync(directory, {recursive: true, force: true, maxRetries: 6, retryDelay: 200});}
    catch (error) {console.error("Temporary files could not be fully deleted:", error.message);}
  }
}

main().catch(error => {
  console.error("REAL CHROMIUM E2E FAILED:", error.message);
  process.exitCode = 1;
});
