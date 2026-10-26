import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME_DIR = path.join(os.homedir(), '.click-builder');
export const DEFAULT_CONFIG = path.join(HOME_DIR, 'config.json');
const MANIFEST = path.join(HOME_DIR, 'installed.json');

export const TARGETS = ['folder', 'background', 'file'];
export const MODES = ['terminal', 'background'];

export const EXAMPLE_CONFIG = {
  actions: [
    {
      id: 'mdv',
      label: 'Ouvrir avec MD Browser',
      command: 'npx md-browser-editor serve {path} --port {port}',
      targets: ['folder', 'background'],
      mode: 'background',
      stopWhenClosed: true,
    },
  ],
};

export function loadConfig(file = DEFAULT_CONFIG) {
  if (!fs.existsSync(file)) {
    throw new Error(`Config introuvable : ${file}\nLancez "click-builder init" pour en créer une.`);
  }
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.actions = (config.actions ?? []).map(validateAction);
  return config;
}

export function saveConfig(config, file = DEFAULT_CONFIG) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
}

export function validateAction(action) {
  const { id, label, command } = action;
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`id invalide : "${id}" (lettres, chiffres, - et _)`);
  if (!label) throw new Error(`[${id}] "label" manquant`);
  if (!command) throw new Error(`[${id}] "command" manquant`);

  const targets = action.targets ?? ['folder'];
  for (const t of targets) {
    if (!TARGETS.includes(t)) throw new Error(`[${id}] cible inconnue "${t}" (${TARGETS.join(', ')})`);
  }
  const mode = action.mode ?? 'terminal';
  if (!MODES.includes(mode)) throw new Error(`[${id}] mode inconnu "${mode}" (${MODES.join(', ')})`);

  const extensions = (action.extensions ?? []).map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase());

  // Le runner doit choisir le port du serveur pour se placer devant lui en proxy.
  const stopWhenClosed = Boolean(action.stopWhenClosed);
  if (stopWhenClosed !== command.includes('{port}')) {
    throw new Error(`[${id}] "stopWhenClosed": true et {port} dans la commande vont ensemble`);
  }
  return { id, label, command, targets, mode, extensions, stopWhenClosed };
}

// Mémorise ce qui a été installé pour pouvoir le retirer même si la config a changé depuis.
export function readManifest() {
  if (!fs.existsSync(MANIFEST)) return [];
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

export function writeManifest(entries) {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(entries, null, 2) + '\n');
}
