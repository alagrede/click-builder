import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HOME_DIR } from '../config.js';

// HKCU : pas besoin de droits administrateur.
const ROOT = 'HKEY_CURRENT_USER\\Software\\Classes';

// Emplacements du registre par cible, et variable d'Explorer donnant le chemin cliqué.
const LOCATIONS = {
  folder: [{ key: 'Directory\\shell', arg: '%1' }],
  background: [{ key: 'Directory\\Background\\shell', arg: '%V' }],
};

function fileLocations(extensions) {
  if (!extensions.length) return [{ key: '*\\shell', arg: '%1' }];
  return extensions.map((ext) => ({ key: `SystemFileAssociations\\${ext}\\shell`, arg: '%1' }));
}

const regString = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function commandLine(action, arg) {
  const command = action.command.replaceAll('{path}', `"${arg}"`);
  // cmd /s retire uniquement la première et la dernière guillemet : les guillemets internes restent intacts.
  const inner = `cd /d "${arg}" 2>nul & ${command}`;
  return action.mode === 'terminal'
    ? `cmd.exe /s /k "${inner}"`
    : `cmd.exe /s /c "start "${action.label}" /min cmd.exe /s /c "${inner}""`;
}

export function install(action) {
  const keys = [];
  const lines = ['Windows Registry Editor Version 5.00', ''];
  const locations = [
    ...action.targets.flatMap((t) => (t === 'file' ? fileLocations(action.extensions) : LOCATIONS[t])),
  ];
  for (const { key, arg } of locations) {
    const full = `${ROOT}\\${key}\\ClickBuilder_${action.id}`;
    keys.push(full);
    lines.push(`[${full}]`, `@=${regString(action.label)}`, `"Icon"="cmd.exe"`, '');
    lines.push(`[${full}\\command]`, `@=${regString(commandLine(action, arg))}`, '');
  }
  importReg(`install-${action.id}`, lines);
  return keys;
}

export function uninstall(keys) {
  if (!keys.length) return;
  importReg('uninstall', ['Windows Registry Editor Version 5.00', '', ...keys.map((k) => `[-${k}]`), '']);
}

export function refresh() {
  // Explorer relit le registre à chaque clic droit, rien à faire.
}

function importReg(name, lines) {
  const file = path.join(HOME_DIR, `${name}.reg`);
  fs.mkdirSync(HOME_DIR, { recursive: true });
  // reg.exe attend de l'UTF-16 LE avec BOM pour gérer les accents dans les libellés.
  fs.writeFileSync(file, '﻿' + lines.join('\r\n'), 'utf16le');
  execFileSync('reg.exe', ['import', file], { stdio: 'inherit' });
}
