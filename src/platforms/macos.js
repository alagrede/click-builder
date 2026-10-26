import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { HOME_DIR } from '../config.js';

// Les Quick Actions (Automator) de ~/Library/Services apparaissent dans le clic droit du Finder.
const SERVICES_DIR = path.join(os.homedir(), 'Library', 'Services');
const SCRIPTS_DIR = path.join(HOME_DIR, 'scripts');
const LOGS_DIR = path.join(HOME_DIR, 'logs');

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

export function install(action) {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const script = writeLauncher(action);

  // macOS n'a pas d'équivalent au clic droit sur le fond d'un dossier : "background" = "folder".
  const wantsFiles = action.targets.includes('file');
  const bundle = path.join(SERVICES_DIR, `${action.label.replace(/[/:]/g, "-")}.workflow`);
  const contents = path.join(bundle, 'Contents');
  fs.rmSync(bundle, { recursive: true, force: true });
  fs.mkdirSync(contents, { recursive: true });

  fs.writeFileSync(path.join(contents, 'Info.plist'), infoPlist(action.label, wantsFiles));
  fs.writeFileSync(path.join(contents, 'document.wflow'), documentWflow(action, script, wantsFiles));
  return [bundle, script];
}

export function uninstall(paths) {
  for (const p of paths) fs.rmSync(p, { recursive: true, force: true });
}

export function refresh() {
  try {
    execFileSync('/System/Library/CoreServices/pbs', ['-flush'], { stdio: 'ignore' });
  } catch {
    // pas bloquant : le Finder finit par relire les services
  }
}

// Script lanceur appelé avec le chemin cliqué en $1. Le PATH courant est figé à
// l'installation car Automator lance les scripts avec un PATH minimal (sans node/npx).
function writeLauncher(action) {
  const file = path.join(SCRIPTS_DIR, `${action.id}.sh`);
  const command = action.command.replaceAll('{path}', '"$1"');
  const body = `#!/bin/zsh
# Généré par click-builder — action "${action.id}"
export PATH=${shQuote(process.env.PATH ?? '/usr/bin:/bin')}
if [ -d "$1" ]; then cd "$1"; else cd "$(dirname "$1")"; fi
${command}
`;
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

function shellScript(action, script) {
  // Le Finder ne sait pas filtrer finement (dossier vs fichier, extension) : on trie ici.
  const allowFolders = action.targets.some((t) => t !== 'file');
  const allowFiles = action.targets.includes('file');
  const fileCheck = !allowFiles
    ? 'continue'
    : action.extensions.length
      ? `case "\${f:l}" in ${action.extensions.map((e) => `*${e}`).join('|')}) ;; *) continue ;; esac`
      : ':';
  const filter = `  if [ -d "$f" ]; then ${allowFolders ? ':' : 'continue'}; else ${fileCheck}; fi\n`;
  const run =
    action.mode === 'terminal'
      ? // quoted form évite tout problème d'échappement entre shell et AppleScript
        `  osascript -e 'on run argv' -e 'tell application "Terminal"' -e 'activate' -e 'do script (quoted form of item 1 of argv & " " & quoted form of item 2 of argv)' -e 'end tell' -e 'end run' ${shQuote(script)} "$f"`
      : `  nohup ${shQuote(script)} "$f" >${shQuote(path.join(LOGS_DIR, `${action.id}.log`))} 2>&1 &`;
  return `for f in "$@"; do\n${filter}${run}\ndone\n`;
}

function infoPlist(label, wantsFiles) {
  const types = wantsFiles ? ['public.item'] : ['public.folder'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>NSActionTemplate</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>${xml(label)}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
${types.map((t) => `				<string>${t}</string>`).join('\n')}
			</array>
		</dict>
	</array>
</dict>
</plist>
`;
}

function documentWflow(action, script, wantsFiles) {
  const inputType = wantsFiles
    ? 'com.apple.Automator.fileSystemObject'
    : 'com.apple.Automator.fileSystemObject.folder';
  const uuid = () => crypto.randomUUID().toUpperCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>523</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>${xml(shellScript(action, script))}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>${uuid()}</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
				</array>
				<key>OutputUUID</key>
				<string>${uuid()}</string>
				<key>UUID</key>
				<string>${uuid()}</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict>
					<key>0</key>
					<dict>
						<key>default value</key>
						<integer>0</integer>
						<key>name</key>
						<string>inputMethod</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>0</string>
					</dict>
					<key>1</key>
					<dict>
						<key>default value</key>
						<false/>
						<key>name</key>
						<string>CheckedForUserDefaultShell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>1</string>
					</dict>
					<key>2</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>source</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>2</string>
					</dict>
					<key>3</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>COMMAND_STRING</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>3</string>
					</dict>
					<key>4</key>
					<dict>
						<key>default value</key>
						<string>/bin/sh</string>
						<key>name</key>
						<string>shell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>4</string>
					</dict>
				</dict>
				<key>isViewVisible</key>
				<integer>1</integer>
				<key>location</key>
				<string>309.000000:305.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleID</key>
		<string>com.apple.finder</string>
		<key>applicationBundleIDsByPath</key>
		<dict>
			<key>/System/Library/CoreServices/Finder.app</key>
			<string>com.apple.finder</string>
		</dict>
		<key>applicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>applicationPaths</key>
		<array>
			<string>/System/Library/CoreServices/Finder.app</string>
		</array>
		<key>inputTypeIdentifier</key>
		<string>${inputType}</string>
		<key>outputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>presentationMode</key>
		<integer>15</integer>
		<key>processesInput</key>
		<false/>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceApplicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>serviceInputTypeIdentifier</key>
		<string>${inputType}</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<false/>
		<key>systemImageName</key>
		<string>NSActionTemplate</string>
		<key>useAutomaticInputType</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
`;
}
