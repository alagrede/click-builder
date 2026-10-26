#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { run } from './runner.js';
import {
  DEFAULT_CONFIG,
  EXAMPLE_CONFIG,
  loadConfig,
  saveConfig,
  validateAction,
  readManifest,
  writeManifest,
} from './config.js';

const HELP = `click-builder — entrées personnalisées dans le clic droit (Finder / Explorateur)

Usage :
  click-builder init                     Crée la config avec un exemple (mdv)
  click-builder list                     Affiche les actions configurées
  click-builder add --id <id> --label <texte> --command <cmd>
                    [--targets folder,background,file] [--ext .md,.txt]
                    [--mode terminal|background] [--stop-when-closed]
  click-builder remove <id>              Retire une action de la config
  click-builder install                  Applique la config au système (synchronise)
  click-builder uninstall                Retire toutes les entrées installées
  click-builder run <id> <chemin>        Lance une action (ce qu'appelle le clic droit)

Options :
  --config <fichier>   Config à utiliser (défaut : ${DEFAULT_CONFIG})

Dans --command, {path} est remplacé par le chemin cliqué (déjà entre guillemets).
Avec --stop-when-closed, la commande doit écouter sur {port} (sans --open) : click-builder
ouvre le navigateur lui-même et arrête le serveur quand le dernier onglet est fermé.
`;

async function platform() {
  if (process.platform === 'darwin') return import('./platforms/macos.js');
  if (process.platform === 'win32') return import('./platforms/windows.js');
  throw new Error(`Plateforme non supportée : ${process.platform}`);
}

// Avec stopWhenClosed, le clic droit appelle "click-builder run" qui pilote la commande.
function launchCommand(action, configPath) {
  if (!action.stopWhenClosed) return action.command;
  const cli = fileURLToPath(import.meta.url);
  // Hors Windows le PATH est figé dans le lanceur : "node" survit aux mises à jour (ex. Homebrew).
  const node = process.platform === 'win32' ? `"${process.execPath}"` : 'node';
  return `${node} "${cli}" run ${action.id} --config "${path.resolve(configPath)}" {path}`;
}

function findInPath(name) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      try {
        fs.accessSync(file, fs.constants.X_OK);
        if (fs.statSync(file).isFile()) return file;
      } catch {}
    }
  }
  return null;
}

// Le lanceur fige le PATH courant : si node ou npx n'y sont pas, le clic droit échouerait en silence.
function checkCommands(actions) {
  const needed = new Map();
  const need = (name, id) => needed.set(name, [...(needed.get(name) ?? []), id]);
  for (const action of actions) {
    // Sous Windows, node est appelé par son chemin complet (process.execPath).
    if (action.stopWhenClosed && process.platform !== 'win32') need('node', action.id);
    if (/^\s*npx\b/.test(action.command)) need('npx', action.id);
  }
  const missing = [...needed].filter(([name]) => !findInPath(name));
  if (!missing.length) return;
  throw new Error(
    missing.map(([name, ids]) => `"${name}" introuvable dans le PATH (requis par : ${ids.join(', ')})`).join('\n') +
      '\nLancez "click-builder install" depuis un terminal où node et npx fonctionnent. Rien n\'a été modifié.',
  );
}

async function uninstallAll() {
  const { uninstall, refresh } = await platform();
  const entries = readManifest();
  uninstall(entries.flatMap((e) => e.paths));
  writeManifest([]);
  refresh();
  return entries;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', default: DEFAULT_CONFIG },
      id: { type: 'string' },
      label: { type: 'string' },
      command: { type: 'string' },
      targets: { type: 'string' },
      ext: { type: 'string' },
      mode: { type: 'string' },
      'stop-when-closed': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, ...rest] = positionals;
  const list = (s) => s?.split(',').map((x) => x.trim()).filter(Boolean);

  switch (values.help ? 'help' : cmd) {
    case 'init': {
      if (fs.existsSync(values.config)) throw new Error(`Existe déjà : ${values.config}`);
      saveConfig(EXAMPLE_CONFIG, values.config);
      console.log(`Config créée : ${values.config}\nÉditez-la puis lancez "click-builder install".`);
      break;
    }
    case 'list': {
      for (const a of loadConfig(values.config).actions) {
        const ext = a.extensions.length ? ` [${a.extensions.join(' ')}]` : '';
        console.log(`${a.id.padEnd(12)} ${a.label}\n${' '.repeat(13)}${a.command}  (${a.targets.join(', ')}${ext}, ${a.mode}${a.stopWhenClosed ? ', arrêt à la fermeture' : ''})`);
      }
      break;
    }
    case 'add': {
      const config = fs.existsSync(values.config) ? loadConfig(values.config) : { actions: [] };
      const action = validateAction({
        id: values.id,
        label: values.label,
        command: values.command,
        targets: list(values.targets),
        extensions: list(values.ext),
        mode: values.mode,
        stopWhenClosed: values['stop-when-closed'],
      });
      config.actions = [...config.actions.filter((a) => a.id !== action.id), action];
      saveConfig(config, values.config);
      console.log(`Action "${action.id}" enregistrée. Lancez "click-builder install" pour l'appliquer.`);
      break;
    }
    case 'remove': {
      const config = loadConfig(values.config);
      const before = config.actions.length;
      config.actions = config.actions.filter((a) => !rest.includes(a.id));
      saveConfig(config, values.config);
      console.log(`${before - config.actions.length} action(s) retirée(s). Lancez "click-builder install" pour synchroniser.`);
      break;
    }
    case 'install': {
      const { actions } = loadConfig(values.config);
      checkCommands(actions);
      await uninstallAll();
      const { install, refresh } = await platform();
      const manifest = [];
      for (const action of actions) {
        // manifeste écrit au fil de l'eau pour pouvoir nettoyer même si une action échoue
        manifest.push({ id: action.id, paths: install({ ...action, command: launchCommand(action, values.config) }) });
        writeManifest(manifest);
        console.log(`✓ ${action.label}`);
      }
      refresh();
      console.log(
        process.platform === 'darwin'
          ? '\nClic droit sur un dossier > Actions rapides (ou Services) dans le Finder.'
          : '\nClic droit dans l\'Explorateur (Windows 11 : "Afficher plus d\'options").',
      );
      break;
    }
    case 'run': {
      const [id, target] = rest;
      const action = loadConfig(values.config).actions.find((a) => a.id === id);
      if (!action) throw new Error(`Action inconnue : ${id}`);
      if (!target) throw new Error('Chemin manquant');
      if (action.stopWhenClosed) await run(action, target);
      else console.log('Cette action n\'utilise pas "stopWhenClosed", rien à faire.');
      break;
    }
    case 'uninstall': {
      const removed = await uninstallAll();
      console.log(`${removed.length} action(s) désinstallée(s).`);
      break;
    }
    default:
      console.log(HELP);
  }
}

main().catch((err) => {
  console.error(`Erreur : ${err.message}`);
  process.exit(1);
});
