import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFile } from 'node:child_process';

// Le runner lance la commande sur un port interne et se place devant elle en proxy.
// Chaque page HTML reçoit un petit script qui ouvre une connexion SSE vers le proxy :
// une connexion = un onglet ouvert. Plus aucune connexion → on tue le serveur.
const ALIVE = '/__click-builder/alive';
const ALIVE_JS = '/__click-builder/alive.js';
const SCRIPT_TAG = `<script src="${ALIVE_JS}"></script>`;
const ALIVE_SOURCE = `new EventSource(${JSON.stringify(ALIVE)});\n`;

const GRACE_MS = 10_000; // laisse le temps à un rechargement de page de se reconnecter
const FIRST_TAB_MS = 60_000; // le navigateur doit s'être connecté dans ce délai
const READY_TIMEOUT_MS = 120_000; // npx peut devoir télécharger le paquet au premier lancement
const PUBLIC_PORT = 4900; // port stable pour garder le même origin (localStorage) d'une fois sur l'autre

const log = (...args) => console.log(`[click-builder ${new Date().toLocaleTimeString()}]`, ...args);

export async function run(action, target) {
  const internalPort = await freePort(0);
  const quoted = process.platform === 'win32' ? `"${target}"` : `'${target.replace(/'/g, `'\\''`)}'`;
  const command = action.command.replaceAll('{path}', quoted).replaceAll('{port}', String(internalPort));
  const cwd = fs.statSync(target).isDirectory() ? target : path.dirname(target);

  log(`$ ${command}`);
  // detached : la commande a son propre groupe de processus, qu'on peut tuer d'un coup (npx → node).
  const child = spawn(command, { shell: true, cwd, stdio: 'inherit', detached: process.platform !== 'win32' });
  const stop = (reason) => {
    log(`arrêt : ${reason}`);
    killTree(child);
    setTimeout(() => process.exit(0), 3000).unref();
  };
  child.on('exit', (code) => {
    log(`la commande s'est terminée (code ${code})`);
    process.exit(code ?? 0);
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(signal));

  try {
    await waitForPort(internalPort, READY_TIMEOUT_MS);
  } catch (err) {
    return stop(err.message);
  }

  let tabs = 0;
  let timer = setTimeout(() => stop('aucun onglet ne s\'est connecté'), FIRST_TAB_MS);
  const proxy = createProxy(internalPort, (req, res) => {
    clearTimeout(timer);
    tabs++;
    log(`onglet connecté (${tabs})`);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    res.write('retry: 1000\n\n');
    const beat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(beat);
      tabs--;
      log(`onglet fermé (${tabs})`);
      if (tabs === 0) timer = setTimeout(() => stop('plus aucun onglet ouvert'), GRACE_MS);
    });
  });

  const publicPort = await freePort(PUBLIC_PORT);
  proxy.listen(publicPort, '127.0.0.1');
  const url = `http://127.0.0.1:${publicPort}/`;
  log(`prêt → ${url}`);
  openBrowser(url);
}

function createProxy(port, onAlive) {
  const server = http.createServer((req, res) => {
    if (req.url === ALIVE) return onAlive(req, res);
    if (req.url === ALIVE_JS) {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end(ALIVE_SOURCE);
    }

    // Host et Origin sont transmis tels quels : ils restent cohérents entre eux pour l'app.
    // Pas de compression, pour pouvoir injecter le script dans le HTML.
    const headers = { ...req.headers };
    delete headers['accept-encoding'];
    const upstream = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, (up) => {
      const html = /text\/html/i.test(up.headers['content-type'] ?? '');
      if (!html || req.method === 'HEAD') {
        res.writeHead(up.statusCode, up.headers);
        return up.pipe(res);
      }
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const injected = body.includes('</body>') ? body.replace('</body>', `${SCRIPT_TAG}</body>`) : body + SCRIPT_TAG;
        const outHeaders = { ...up.headers };
        delete outHeaders['content-length'];
        res.writeHead(up.statusCode, outHeaders);
        res.end(injected);
      });
    });
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`click-builder : serveur injoignable (${err.message})`);
    });
    req.pipe(upstream);
  });

  // WebSocket (rechargement à chaud, etc.) : on relaie les octets bruts.
  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(port, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(lines.join('\r\n') + '\r\n\r\n');
      up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  return server;
}

function killTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
    setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }, 2000).unref();
  } catch {}
}

function freePort(start) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && start) resolve(freePort(start + 1));
      else reject(err);
    });
    server.listen(start, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    if (open) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`le serveur n'a pas ouvert le port ${port} en ${timeout / 1000}s`);
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd.exe', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}
