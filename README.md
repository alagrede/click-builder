# click-builder

Ajoute des entrées personnalisées au clic droit du Finder (macOS) et de l'Explorateur (Windows). Aucune dépendance, Node ≥ 18.

```sh
npm link                 # rend la commande click-builder disponible
click-builder init       # crée ~/.click-builder/config.json avec l'exemple mdv
click-builder install    # applique la config
```

## Config

```json
{
  "actions": [
    {
      "id": "mdv",
      "label": "Ouvrir avec MD Browser",
      "command": "npx md-browser-editor serve {path} --port {port}",
      "targets": ["folder", "background"],
      "mode": "background",
      "stopWhenClosed": true
    }
  ]
}
```

- `{path}` : chemin cliqué, déjà entre guillemets.
- `targets` : `folder` (clic droit sur un dossier), `background` (fond d'un dossier ouvert, Windows uniquement), `file`.
- `extensions` : limite `file` à certaines extensions, ex. `[".md"]`.
- `mode` : `terminal` ouvre un terminal visible (Ctrl+C pour arrêter un serveur), `background` lance sans fenêtre (journal dans `~/.click-builder/logs/<id>.log`).
- `stopWhenClosed` : pour les serveurs web. La commande doit écouter sur `{port}` et ne pas ouvrir le navigateur elle-même.

### Arrêt automatique (`stopWhenClosed`)

`click-builder run` lance la commande sur un port interne, puis se place devant elle en proxy sur `http://127.0.0.1:4900` (ou le port libre suivant) et ouvre le navigateur par défaut. Il injecte dans chaque page HTML un script qui garde une connexion SSE ouverte avec le proxy : une connexion = un onglet. Dix secondes après la fermeture du dernier onglet, la commande et ses sous-processus sont arrêtés. Le délai laisse passer un rechargement de page. Si aucun onglet ne se connecte dans la minute, tout s'arrête aussi.

Limite : une mise en veille longue peut couper la connexion et arrêter le serveur.

Après chaque modification : `click-builder install` (resynchronise tout, retire les actions supprimées).

## Fonctionnement

- **macOS** : génère une Quick Action Automator dans `~/Library/Services/` qui appelle `~/.click-builder/scripts/<id>.sh`. Le `PATH` est figé à l'installation, relancez `install` si node change d'emplacement.
- **Windows** : écrit des clés sous `HKCU\Software\Classes` (pas besoin d'être admin). Sous Windows 11, l'entrée est dans « Afficher plus d'options » (Shift+F10).
