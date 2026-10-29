const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
const runningBotProcesses = new Map();
const botLogsHistory = new Map(); // dir -> Array<{ projectDir, projectName, message, type, time }>

function appendBotLog(dir, name, message, type = 'stdout') {
    if (!botLogsHistory.has(dir)) {
        botLogsHistory.set(dir, []);
    }
    const list = botLogsHistory.get(dir);
    const entry = {
        projectDir: dir,
        projectName: name,
        message: String(message),
        type: type,
        time: Date.now()
    };
    list.push(entry);
    if (list.length > 1000) list.shift();

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bot-log', entry);
    }
}

const APP_DIR = __dirname;
// Dynamiczny katalog domowy użytkownika (np. /home/nazwa_uzytkownika/Dokumenty/Pitaya-Boty)
const os = require('os');
const USER_HOME = os.homedir();
// Folder z czasów Mango ("Mango-Boty") nadal działa, jeśli już istnieje — nic się nie gubi.
const BOTY_DIR = fs.existsSync(path.join(USER_HOME, 'Dokumenty', 'Moje', 'Boty'))
    ? path.join(USER_HOME, 'Dokumenty', 'Moje', 'Boty')
    : fs.existsSync(path.join(USER_HOME, 'Dokumenty', 'Mango-Boty'))
        ? path.join(USER_HOME, 'Dokumenty', 'Mango-Boty')
        : path.join(USER_HOME, 'Dokumenty', 'Pitaya-Boty');

// Pitaya Core: dane w ~/.config/Pitayas/Bot-Builder (projekty, lista ostatnich, logi).
// Nazwa w systemie (pasek zadań, menu) to "PBB". Przy pierwszym starcie kopiujemy dane
// z ~/.config/mango-bot-builder albo ~/.config/pitaya-bot-builder — stare foldery zostają.
const legacy = [];
for (const old of ['mango-bot-builder', 'pitaya-bot-builder']) {
    legacy.push(
        { from: `${old}/settings.json`, to: 'settings.json' },
        { from: `${old}/projects`, to: 'projects' },
        { from: `${old}/Local Storage`, to: 'cache/Local Storage' },
    );
}
const core = require('./core').create({
    id: 'bot-builder',
    folder: 'Bot-Builder',
    name: 'PBB',
    repo: 'MangoLabz/Pitayas-Bot-Builder',
    appDir: __dirname,
    legacy,
});
if (process.platform === 'linux' && typeof app.setDesktopName === 'function') {
    app.setDesktopName('pitaya-bot-builder.desktop');
}

const USER_DATA_DIR = core.paths.dir;
if (!fs.existsSync(USER_DATA_DIR)) {
    try { fs.mkdirSync(USER_DATA_DIR, { recursive: true }); } catch(e) {}
}

// Domyślny projekt: "Pitaya Bot" (albo dotychczasowy "Mango Bot", jeśli już istnieje)
const ROOT_DIR = fs.existsSync(path.join(BOTY_DIR, 'Mango Bot'))
    ? path.join(BOTY_DIR, 'Mango Bot')
    : path.join(BOTY_DIR, 'Pitaya Bot');
const BLOCKS_DIR = path.join(APP_DIR, 'blocks');
const PROJECTS_DIR = path.join(USER_DATA_DIR, 'projects');
const LOCAL_SETTINGS_PATH = path.join(USER_DATA_DIR, 'settings.json');

function loadSettings() {
    let settings = { recent: [] };
    if (fs.existsSync(LOCAL_SETTINGS_PATH)) {
        try {
            settings = JSON.parse(fs.readFileSync(LOCAL_SETTINGS_PATH, 'utf8'));
        } catch(e) {}
    }
    if (!Array.isArray(settings.recent)) {
        settings.recent = [];
    }
    // Zachowaj tylko foldery, które faktycznie istnieją
    settings.recent = settings.recent.filter(p => fs.existsSync(p));
    return settings;
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(LOCAL_SETTINGS_PATH, JSON.stringify(settings, null, 4), 'utf8');
    } catch(e) {}
}

try {
    if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });
    if (!fs.existsSync(BOTY_DIR)) fs.mkdirSync(BOTY_DIR, { recursive: true });
} catch(e) {
    console.error('Błąd tworzenia katalogów:', e);
}

let currentProject = null;

function getProjectPaths(projNameOrPath) {
    if (!projNameOrPath) return null;
    let baseDir = null;
    if (path.isAbsolute(projNameOrPath) && fs.existsSync(projNameOrPath)) {
        baseDir = projNameOrPath;
    } else {
        const settings = loadSettings();
        const match = settings.recent.find(r => path.basename(r) === projNameOrPath || r === projNameOrPath);
        if (match && fs.existsSync(match)) {
            baseDir = match;
        }
    }

    if (!baseDir) {
        const cand1 = path.join(BOTY_DIR, projNameOrPath);
        const cand2 = path.join(PROJECTS_DIR, projNameOrPath);
        if (fs.existsSync(cand1)) baseDir = cand1;
        else if (fs.existsSync(cand2)) baseDir = cand2;
    }

    if (!baseDir) return null;

    const wsData = path.join(baseDir, 'data', 'workspaces.json');
    const wsRoot = path.join(baseDir, 'workspaces.json');
    const workspaces = fs.existsSync(wsData) ? wsData : (fs.existsSync(wsRoot) ? wsRoot : wsData);

    const dataData = path.join(baseDir, 'data', 'data.json');
    const dataRoot = path.join(baseDir, 'data.json');
    const data = fs.existsSync(dataData) ? dataData : (fs.existsSync(dataRoot) ? dataRoot : dataData);

    const tokenTxt = path.join(baseDir, 'data', 'token.txt');
    const envFile = path.join(baseDir, '.env');
    let savedToken = '';
    if (fs.existsSync(tokenTxt)) {
        try { savedToken = fs.readFileSync(tokenTxt, 'utf8').trim(); } catch(e) {}
    } else if (fs.existsSync(envFile)) {
        try {
            const match = fs.readFileSync(envFile, 'utf8').match(/TOKEN=(.*)/);
            if (match) savedToken = match[1].trim();
        } catch(e) {}
    }

    const pBlocks = path.join(baseDir, 'blocks');
    const blocksDir = fs.existsSync(pBlocks) ? pBlocks : BLOCKS_DIR;

    return {
        name: path.basename(baseDir),
        dir: baseDir,
        workspaces,
        bot: path.join(baseDir, 'bot.js'),
        data,
        env: envFile,
        tokenTxt,
        savedToken,
        blocksDir
    };
}

if (!fs.existsSync(BLOCKS_DIR)) {
    fs.mkdirSync(BLOCKS_DIR, { recursive: true });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1700,
        height: 1050,
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: '#1e1f22',
        title: "PBB",
        frame: false,
        icon: path.join(__dirname, 'build', 'icons', 'icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    const sendMaxState = () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('win-maximized', mainWindow.isMaximized());
    };
    mainWindow.on('maximize', sendMaxState);
    mainWindow.on('unmaximize', sendMaxState);
    mainWindow.webContents.on('did-finish-load', sendMaxState);
}

// Własny pasek tytułu (okno bez systemowej ramki, jak w DBB)
ipcMain.on('win-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('win-maximize-toggle', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});
ipcMain.on('win-close', () => { if (mainWindow) mainWindow.close(); });

// Jedna instancja: ponowne uruchomienie pokazuje istniejące okno
if (core.singleInstance(() => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
})) {
    core.registerIpc();
    app.whenReady().then(createWindow);
}

app.on('window-all-closed', () => {
    runningBotProcesses.forEach(entry => {
        try { if (entry.process) entry.process.kill(); } catch(e) {}
    });
    runningBotProcesses.clear();
    if (process.platform !== 'darwin') app.quit();
});

function resolveBlockProp(prop, blockData) {
    try {
        if (Array.isArray(prop)) return prop;
        if (typeof prop === 'function') {
            const res = prop(blockData);
            return Array.isArray(res) ? res : [];
        }
    } catch (e) {
        // Fallback if function expects specific structure
    }
    return [];
}

function getNodeModulesPaths(projectDir) {
    const list = [];
    if (projectDir) {
        list.push(path.join(projectDir, 'node_modules'));
    }
    list.push(path.join(APP_DIR, 'node_modules'));
    list.push(path.join(__dirname, 'node_modules'));
    if (typeof ROOT_DIR === 'string' && ROOT_DIR) {
        list.push(path.join(ROOT_DIR, 'node_modules'));
    }

    if (BOTY_DIR && fs.existsSync(BOTY_DIR)) {
        try {
            const entries = fs.readdirSync(BOTY_DIR, { withFileTypes: true });
            for (const ent of entries) {
                if (ent.isDirectory()) {
                    const nm = path.join(BOTY_DIR, ent.name, 'node_modules');
                    if (fs.existsSync(path.join(nm, 'discord.js'))) {
                        list.push(nm);
                    }
                }
            }
        } catch(e) {}
    }

    const valid = [];
    for (const p of list) {
        try {
            if (fs.existsSync(p) && !valid.includes(p)) {
                valid.push(p);
            }
        } catch(e) {}
    }
    return valid;
}

// Projekty z oryginalnego DBB mają własny bot.js (runtime DBB) - nie wolno go nadpisywać
function isCustomBotFile(botPath) {
    try {
        if (!fs.existsSync(botPath) || fs.statSync(botPath).size === 0) return false;
        const head = fs.readFileSync(botPath, 'utf8').slice(0, 400);
        return !head.includes('Pitaya Bot Builder - Wygenerowany') && !head.includes('Mango Bot Builder - Wygenerowany');
    } catch (e) {
        return false;
    }
}

// Zapisuje bot.js tylko, gdy to plik wygenerowany przez PBB (lub go brak). Zwraca true, jeśli zapisano.
function writeBotFile(paths) {
    if (isCustomBotFile(paths.bot)) return false;
    fs.writeFileSync(paths.bot, getBotJSContent(paths), 'utf-8');
    return true;
}

// Zapisuje token w formacie DBB (data/token.txt) oraz w .env
function saveProjectToken(paths, token) {
    if (!token || !token.trim()) return;
    const clean = token.trim();
    try {
        const dDir = path.dirname(paths.tokenTxt);
        if (!fs.existsSync(dDir)) fs.mkdirSync(dDir, { recursive: true });
        fs.writeFileSync(paths.tokenTxt, clean, 'utf-8');
    } catch (e) {}
    try { fs.writeFileSync(paths.env, `TOKEN=${clean}\n`, 'utf-8'); } catch (e) {}
}

// Diagnostyka projektu przed startem bota: uprawnienia i moduły zainstalowane pod Windows (Proton)
function diagnoseProject(projectDir) {
    const warnings = [];
    const notWritable = [];
    for (const rel of ['.', 'data', 'data/token.txt', 'node_modules', 'package.json', 'package-lock.json']) {
        const full = path.join(projectDir, rel);
        if (!fs.existsSync(full)) continue;
        try { fs.accessSync(full, fs.constants.W_OK); } catch (e) { notWritable.push(rel); }
    }
    if (notWritable.length) {
        warnings.push(
            `⚠️ Brak uprawnień do zapisu w projekcie (${notWritable.join(', ')}). Bot nie zapisze danych ani nie doinstaluje paczek.\n` +
            `   Napraw w terminalu: sudo chown -R "$USER:$USER" "${projectDir}"`
        );
    }
    const intentsFile = path.join(projectDir, 'data', 'INTENTS.txt');
    if (fs.existsSync(path.join(projectDir, 'bot.js')) && !fs.existsSync(intentsFile)) {
        try {
            fs.writeFileSync(intentsFile, 'ALL_INTENTS', 'utf8');
            warnings.push('ℹ️ Brakowało pliku data/INTENTS.txt — utworzono go z ALL_INTENTS (potrzebne m.in. do eventów kanałów głosowych). Włącz intenty uprzywilejowane w Discord Developer Portal.');
        } catch (e) {
            warnings.push('⚠️ Brak pliku data/INTENTS.txt — bot nie dostanie m.in. eventów kanałów głosowych. Utwórz go z treścią: ALL_INTENTS');
        }
    }
    const nm = path.join(projectDir, 'node_modules');
    try {
        const esb = path.join(nm, '@esbuild');
        const napi = path.join(nm, '@napi-rs');
        const hasWin = (dir) => fs.existsSync(dir) && fs.readdirSync(dir).some(d => d.includes('win32'));
        const hasLinux = (dir) => fs.existsSync(dir) && fs.readdirSync(dir).some(d => d.includes('linux'));
        if ((hasWin(esb) && !hasLinux(esb)) || (hasWin(napi) && !hasLinux(napi)) ||
            (fs.existsSync(path.join(napi, 'canvas')) && !hasLinux(napi))) {
            warnings.push(
                '⚠️ node_modules zostały zainstalowane pod Windows (DBB przez Proton) — brakuje modułów natywnych dla Linuxa (np. @napi-rs/canvas, esbuild).\n' +
                `   Przeinstaluj w terminalu: cd "${projectDir}" && rm -rf node_modules package-lock.json && npm install`
            );
        }
    } catch (e) {}
    return warnings;
}

function getCurrentBlocksDir() {
    const p = currentProject ? getProjectPaths(currentProject) : null;
    return (p && p.blocksDir && fs.existsSync(p.blocksDir)) ? p.blocksDir : BLOCKS_DIR;
}

function getBotJSContent() {
    return `/**
 * Pitaya Bot Builder - Wygenerowany plik wykonywalny (bot.js)
 * Kompatybilny z blokami Discord Bot Builder (DBB)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const DiscordJS = require('discord.js');
const { Client, GatewayIntentBits, Partials, Events, Collection } = DiscordJS;

const WORKSPACES_PATH = fs.existsSync(path.join(__dirname, 'data', 'workspaces.json'))
    ? path.join(__dirname, 'data', 'workspaces.json')
    : path.join(__dirname, 'workspaces.json');
const DATA_PATH = fs.existsSync(path.join(__dirname, 'data', 'data.json'))
    ? path.join(__dirname, 'data', 'data.json')
    : path.join(__dirname, 'data.json');
const BLOCKS_DIR = fs.existsSync(path.join(__dirname, 'blocks')) 
    ? path.join(__dirname, 'blocks') 
    : path.join(__dirname, '..', '..', 'blocks');

// Domyślna struktura data.json
function loadDataFile() {
    const defaultData = {
        dbb: {
            prefixes: { main: "!", servers: {} },
            owners: []
        },
        discord: {
            servers: {},
            members: {},
            users: {}
        },
        blocks: {},
        custom: {}
    };
    if (!fs.existsSync(DATA_PATH)) {
        fs.writeFileSync(DATA_PATH, JSON.stringify(defaultData, null, 4), 'utf8');
        return defaultData;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
        return Object.assign(defaultData, parsed);
    } catch (e) {
        console.error('[BŁĄD ODCZYTU data.json]:', e.message);
        return defaultData;
    }
}

function saveDataFile(dataObj) {
    try {
        fs.writeFileSync(DATA_PATH, JSON.stringify(dataObj, null, 4), 'utf8');
    } catch (e) {
        console.error('[BŁĄD ZAPISU data.json]:', e.message);
    }
}

const persistedData = loadDataFile();

// Inicjalizacja klienta Discord.js ze wszystkimi potrzebnymi Intentami
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.AutoModerationExecution
    ],
    partials: [
        Partials.User,
        Partials.Channel,
        Partials.GuildMember,
        Partials.Message,
        Partials.Reaction,
        Partials.GuildScheduledEvent,
        Partials.ThreadMember
    ]
});

// Proxy zdarzeń dla bloków używających this.events.on(...)
const eventsEmitter = new EventEmitter();
eventsEmitter.setMaxListeners(200);
client.setMaxListeners(200);

const eventsProxy = {
    on(eventName, listener) {
        client.on(eventName, listener);
    },
    once(eventName, listener) {
        client.once(eventName, listener);
    },
    emit(eventName, ...args) {
        client.emit(eventName, ...args);
    }
};

// Wczytywanie bloków z /blocks
const blockModules = new Map();
if (fs.existsSync(BLOCKS_DIR)) {
    const files = fs.readdirSync(BLOCKS_DIR).filter(f => f.endsWith('.js'));
    for (const file of files) {
        const blockName = file.replace(/\\.js$/, '');
        try {
            const mod = require(path.join(BLOCKS_DIR, file));
            blockModules.set(blockName, mod);
        } catch (err) {
            console.warn(\`[OSTRZEŻENIE] Nie udało się załadować bloku \${file}: \${err.message}\`);
        }
    }
}

// Wczytywanie aktywnych workspace'ów z workspaces.json
function getActiveWorkspaces() {
    if (!fs.existsSync(WORKSPACES_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(WORKSPACES_PATH, 'utf8'));
    const allWorkspaces = [];

    for (const item of raw) {
        if (item.workspaces && Array.isArray(item.workspaces)) {
            for (const ws of item.workspaces) {
                allWorkspaces.push(ws);
            }
        } else if (item.blocks) {
            allWorkspaces.push(item);
        }
    }

    const active = allWorkspaces.filter(ws => ws.active !== false);
    // Jeśli żaden workspace nie ma flagi active: true, uruchom wszystkie niepuste
    return active.length > 0 ? active : allWorkspaces.filter(ws => Array.isArray(ws.blocks) && ws.blocks.length > 0);
}

const activeWorkspaces = getActiveWorkspaces();

// Zarządzanie danymi (Data Stuff)
const DataManager = {
    getData(name, target, type = 'custom') {
        target = target ? String(typeof target === 'object' ? (target.id || '') : target) : '';
        switch (type) {
            case 'server':
                return persistedData.discord.servers[target]?.[name];
            case 'member':
                return persistedData.discord.members[target]?.[name];
            case 'user':
                return persistedData.discord.users[target]?.[name];
            case 'block':
                return persistedData.blocks[target]?.[name];
            default:
                return persistedData.custom[name];
        }
    },
    setData(name, value, target, type = 'custom') {
        target = target ? String(typeof target === 'object' ? (target.id || '') : target) : '';
        switch (type) {
            case 'server':
                if (!persistedData.discord.servers[target]) persistedData.discord.servers[target] = {};
                persistedData.discord.servers[target][name] = value;
                break;
            case 'member':
                if (!persistedData.discord.members[target]) persistedData.discord.members[target] = {};
                persistedData.discord.members[target][name] = value;
                break;
            case 'user':
                if (!persistedData.discord.users[target]) persistedData.discord.users[target] = {};
                persistedData.discord.users[target][name] = value;
                break;
            case 'block':
                if (!persistedData.blocks[target]) persistedData.blocks[target] = {};
                persistedData.blocks[target][name] = value;
                break;
            default:
                persistedData.custom[name] = value;
                break;
        }
        saveDataFile(persistedData);
    },
    deleteData(name, target, type = 'custom') {
        target = target ? String(typeof target === 'object' ? (target.id || '') : target) : '';
        switch (type) {
            case 'server':
                if (persistedData.discord.servers[target]) delete persistedData.discord.servers[target][name];
                break;
            case 'member':
                if (persistedData.discord.members[target]) delete persistedData.discord.members[target][name];
                break;
            case 'user':
                if (persistedData.discord.users[target]) delete persistedData.discord.users[target][name];
                break;
            case 'block':
                if (persistedData.blocks[target]) delete persistedData.blocks[target][name];
                break;
            default:
                delete persistedData.custom[name];
                break;
        }
        saveDataFile(persistedData);
    },
    addData(name, value, target, type = 'custom') {
        const current = Number(this.getData(name, target, type)) || 0;
        this.setData(name, current + Number(value), target, type);
    },
    saveData() {
        saveDataFile(persistedData);
    }
};

// Zmienne tymczasowe i globalne
const globalVariables = new Map();
const workspaceVariables = new Map();

// Obiekt główny DBB
const DBB = {
    DiscordJS: {
        client,
        module: DiscordJS
    },
    File: {
        paths: {
            workspaces: WORKSPACES_PATH,
            data: DATA_PATH
        },
        writeFile(filePath, content) {
            fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 4), 'utf8');
        }
    },
    Data: {
        token: process.env.TOKEN || process.env.DISCORD_TOKEN || '',
        workspaces: activeWorkspaces,
        data: persistedData
    },
    Dependencies: {},
    Core: {
        Dependencies: {},
        console(type, msg) {
            const prefix = type ? \`[\${type}]\` : '[LOG]';
            console.log(\`\${prefix} \${msg}\`);
        },
        async require(pkgName) {
            const cleanName = String(pkgName).split('@')[0] || pkgName;
            try {
                return require(cleanName.startsWith('@') ? '@' + String(pkgName).split('@')[1] : cleanName);
            } catch (e) {
                return require(pkgName);
            }
        },
        typeof(val) {
            if (val === null) return 'null';
            if (Array.isArray(val)) return 'list';
            if (val instanceof Date) return 'date';
            return typeof val;
        },
        generateID(length = 10) {
            return Math.random().toString(36).substring(2, 2 + length);
        },
        setDependency(name, instance) {
            this.Dependencies[name] = instance;
            DBB.Dependencies[name] = instance;
        },
        restart() {
            console.log('[INFO] Restartowanie procesu bota...');
        },
        end() {
            process.exit(0);
        }
    },
    Blocks: {
        cache: blockModules,
        inputs: {},
        Data: DataManager,
        Core: null
    }
};

// Przygotowanie indeksów połączeń dla każdego workspace'u
const runtimeWorkspaces = activeWorkspaces.map((ws, wsIdx) => {
    const blocks = ws.blocks || [];
    const wireProducers = new Map(); // wireId -> { blockIdx, outKey, isSlot, slotIdx }
    const wireConsumers = new Map(); // wireId -> Array<{ blockIdx, inKey }>
    const baseWireValues = new Map();

    blocks.forEach((b, bIdx) => {
        if (b.active === false) return;
        if (b.outputs) {
            for (const [outKey, outVal] of Object.entries(b.outputs)) {
                if (!Array.isArray(outVal)) continue;
                if (outVal.length > 0 && Array.isArray(outVal[0])) {
                    // multiOutput: tablica tablic wireId
                    outVal.forEach((slotArr, slotIdx) => {
                        if (Array.isArray(slotArr)) {
                            slotArr.forEach(wId => {
                                if (typeof wId === 'string' && wId) {
                                    wireProducers.set(wId, { blockIdx: bIdx, outKey, isSlot: true, slotIdx });
                                }
                            });
                        }
                    });
                } else {
                    outVal.forEach(wId => {
                        if (typeof wId === 'string' && wId) {
                            wireProducers.set(wId, { blockIdx: bIdx, outKey, isSlot: false, slotIdx: 0 });
                        }
                    });
                }
            }
        }
        if (b.inputs) {
            for (const [inKey, inVal] of Object.entries(b.inputs)) {
                const ids = Array.isArray(inVal) ? inVal : [inVal];
                ids.forEach(wId => {
                    if (typeof wId === 'string' && wId) {
                        if (!wireConsumers.has(wId)) wireConsumers.set(wId, []);
                        wireConsumers.get(wId).push({ blockIdx: bIdx, inKey });
                    }
                });
            }
        }
    });

    return {
        ws,
        wsIdx,
        id: ws.id,
        title: ws.info?.title || \`Workspace \${wsIdx + 1}\`,
        blocks,
        wireProducers,
        wireConsumers,
        baseWireValues,
        inputBlockFlags: new Set()
    };
});

function createCache(rws, blockIdx, sharedState = null, executedFrom = []) {
    const block = rws.blocks[blockIdx];
    const state = sharedState || {
        wireValues: new Map(rws.baseWireValues),
        tempVars: new Map(),
        visitedProducers: new Set()
    };
    return {
        index: blockIdx,
        _index: blockIdx,
        name: block.name,
        inputs: block.inputs || {},
        options: block.options || {},
        outputs: block.outputs || {},
        executedFrom,
        _temp: { __VALUES: [] },
        _rws: rws,
        _state: state
    };
}

// Kontekst wykonywania bloków (this wewnątrz code(cache))
const blockContext = {
    client,
    events: eventsProxy,
    DBB,
    commands: new Collection(),
    jobs: {},
    _tempData: {},
    fs,

    end(error, stopExecution = true, log = true) {
        if (error && log !== false) {
            console.error('[DBB ERROR]:', error.message || error);
        }
        return error;
    },

    error(msg) {
        console.error('[DBB ERROR]:', msg);
    },

    log(...args) {
        console.log(...args);
    },

    replaceData(name, value, target, type) {
        return DataManager.setData(name, value, target, type);
    },

    setPrefix(prefix) {
        if (DBB) DBB.prefix = prefix;
    },

    requireRestart() {},

    getDBB() {
        return DBB;
    },

    console(type, msg) {
        DBB.Core.console(type, msg);
    },

    async require(pkgName) {
        return DBB.Core.require(pkgName);
    },

    ConvertRegex(str) {
        if (typeof str !== 'string') return new RegExp('');
        const match = str.match(/^\\/([\\s\\S]+)\\/([gimsuy]*)$/);
        if (match) {
            return new RegExp(match[1], match[2]);
        }
        return new RegExp(str);
    },

    getData(name, target, type) {
        return DataManager.getData(name, target, type);
    },
    setData(name, value, target, type) {
        return DataManager.setData(name, value, target, type);
    },
    deleteData(name, target, type) {
        return DataManager.deleteData(name, target, type);
    },
    addData(name, value, target, type) {
        return DataManager.addData(name, value, target, type);
    },
    saveData() {
        return DataManager.saveData();
    },

    getVariable(name, opts = {}, cache) {
        const type = opts.type || 'temp';
        const restriction = opts.restriction || 'current';
        if (type === 'global' || restriction === 'all') {
            return globalVariables.get(name);
        }
        const wsId = cache?._rws?.id || 'default';
        if (workspaceVariables.has(wsId) && workspaceVariables.get(wsId).has(name)) {
            return workspaceVariables.get(wsId).get(name);
        }
        return cache?._state?.tempVars?.get(name) ?? globalVariables.get(name);
    },

    setVariable(name, value, opts = {}, cache) {
        const type = opts.type || 'temp';
        const restriction = opts.restriction || 'current';
        if (type === 'global' || restriction === 'all') {
            globalVariables.set(name, value);
            return;
        }
        const wsId = cache?._rws?.id || 'default';
        if (!workspaceVariables.has(wsId)) workspaceVariables.set(wsId, new Map());
        workspaceVariables.get(wsId).set(name, value);
        if (cache?._state?.tempVars) {
            cache._state.tempVars.set(name, value);
        }
    },

    deleteVariable(name, opts = {}, cache) {
        globalVariables.delete(name);
        const wsId = cache?._rws?.id || 'default';
        workspaceVariables.get(wsId)?.delete(name);
        cache?._state?.tempVars?.delete(name);
    },

    isOutputConnected(outputId, cache) {
        const out = cache?.outputs?.[outputId];
        if (!out) return false;
        if (Array.isArray(out)) {
            return out.flat().some(w => typeof w === 'string' && w.length > 0);
        }
        return false;
    },

    resolveWireValue(wireId, cache, forceFetch = false) {
        if (!wireId || typeof wireId !== 'string') return undefined;
        const rws = cache._rws;
        const state = cache._state;
        const producer = rws.wireProducers.get(wireId);

        const shouldFetch = forceFetch ||
            (producer && rws.inputBlockFlags.has(producer.blockIdx)) ||
            (!state.wireValues.has(wireId) && !rws.baseWireValues.has(wireId));

        if (producer && shouldFetch) {
            const visitKey = \`\${producer.blockIdx}:\${wireId}\`;
            if (!state.visitedProducers.has(visitKey)) {
                state.visitedProducers.add(visitKey);
                const prodBlock = rws.blocks[producer.blockIdx];
                const prodMod = blockModules.get(prodBlock?.name);
                if (prodMod && typeof prodMod.code === 'function') {
                    const prodCache = createCache(rws, producer.blockIdx, state, []);
                    try {
                        prodMod.code.call(blockContext, prodCache, DBB);
                    } catch (err) {
                        console.error(\`[BŁĄD BLOKU WEJŚCIOWEGO \${prodBlock.name}]:\`, err.message);
                    }
                }
                state.visitedProducers.delete(visitKey);
            }
        }

        if (state.wireValues.has(wireId)) return state.wireValues.get(wireId);
        return rws.baseWireValues.get(wireId);
    },

    GetInputValue(inputId, cache, fetchOrBool = false, defaultValue = undefined) {
        if (!cache || !cache.inputs) return defaultValue;
        const forceFetch = (typeof fetchOrBool === 'object' && fetchOrBool?.fetch) || fetchOrBool === true;
        const rawInput = cache.inputs[inputId];

        const mod = blockModules.get(cache.name);
        let isMultiInput = Array.isArray(rawInput);
        if (!isMultiInput && mod) {
            try {
                const defs = Array.isArray(mod.inputs) ? mod.inputs : (typeof mod.inputs === 'function' ? mod.inputs(cache) : []);
                const def = (defs || []).find(d => d.id === inputId);
                if (def && def.multiInput) isMultiInput = true;
            } catch {}
        }

        if (isMultiInput) {
            const arr = Array.isArray(rawInput) ? rawInput : (rawInput ? [rawInput] : []);
            return arr.map(wId => this.resolveWireValue(wId, cache, forceFetch));
        }

        if (!rawInput || typeof rawInput !== 'string') return defaultValue;
        const val = this.resolveWireValue(rawInput, cache, forceFetch);
        return val !== undefined ? val : defaultValue;
    },

    GetOptionValue(optionId, cache, fetchOrBool = false, defaultValue = undefined) {
        if (!cache || !cache.options) return defaultValue;
        const val = cache.options[optionId];
        return (val !== undefined && val !== '') ? val : (val === '' ? '' : defaultValue);
    },

    StoreOutputValue(value, outputId, cache, mode = undefined) {
        if (!cache || !cache.outputs) return;
        const rws = cache._rws;
        const state = cache._state;
        if (mode === 'inputBlock') {
            rws.inputBlockFlags.add(cache.index);
        }

        const outEntry = cache.outputs[outputId];
        if (!Array.isArray(outEntry)) return;

        if (outEntry.length > 0 && Array.isArray(outEntry[0])) {
            // multiOutput: tablica slotów [[wireId1], [wireId2], ...]
            outEntry.forEach((slotWires, slotIdx) => {
                const slotVal = Array.isArray(value) ? value[slotIdx] : value;
                if (Array.isArray(slotWires)) {
                    slotWires.forEach(wId => {
                        if (typeof wId === 'string' && wId) {
                            state.wireValues.set(wId, slotVal);
                            rws.baseWireValues.set(wId, slotVal);
                        }
                    });
                }
            });
        } else {
            outEntry.forEach(wId => {
                if (typeof wId === 'string' && wId) {
                    state.wireValues.set(wId, value);
                    rws.baseWireValues.set(wId, value);
                }
            });
        }
    },

    async RunNextBlock(outputId, cache, callback = undefined) {
        if (!cache || !cache.outputs) return;
        const rws = cache._rws;
        const outEntry = cache.outputs[outputId];
        if (!Array.isArray(outEntry)) return;

        const wireIds = outEntry.flat().filter(w => typeof w === 'string' && w.length > 0);
        for (const wId of wireIds) {
            const targets = rws.wireConsumers.get(wId) || [];
            for (const target of targets) {
                const targetBlock = rws.blocks[target.blockIdx];
                if (!targetBlock || targetBlock.active === false) continue;
                const targetMod = blockModules.get(targetBlock.name);
                if (!targetMod || typeof targetMod.code !== 'function') continue;

                // Tworzymy płytką kopię stanu dla kolejnego wywołania w łańcuchu
                const nextState = {
                    wireValues: cache._state.wireValues,
                    tempVars: cache._state.tempVars,
                    visitedProducers: new Set()
                };
                const nextCache = createCache(rws, target.blockIdx, nextState, [target.inKey]);
                try {
                    await targetMod.code.call(blockContext, nextCache, DBB);
                } catch (err) {
                    console.error(\`[BŁĄD WYKONANIA BLOKU \${targetBlock.name} w "\${rws.title}"]:\`, err);
                }
            }
        }

        if (typeof callback === 'function') {
            callback();
        }
    },

    Emitter(id, opts = {}, cache) {
        const targetWorkspaces = runtimeWorkspaces.filter(rws => {
            if (opts.restriction_type === 'current') return rws === cache._rws;
            if (opts.restriction_type === 'specific') {
                if (opts.search_type === 'id') return rws.id === opts.search_value;
                if (opts.search_type === 'title') return rws.title === opts.search_value;
                if (opts.search_type === 'number') return (rws.wsIdx + 1) === Number(opts.search_value);
            }
            return true;
        });

        for (const rws of targetWorkspaces) {
            rws.blocks.forEach((b, bIdx) => {
                if (b.active === false || b.name !== 'receiver') return;
                const recCache = createCache(rws, bIdx, null, ['id']);
                const recId = this.GetInputValue('id', recCache) || this.GetOptionValue('id', recCache);
                if (String(recId) === String(id)) {
                    recCache._temp.__VALUES = opts.values || [];
                    const recMod = blockModules.get('receiver');
                    if (recMod && typeof recMod.code === 'function') {
                        try {
                            recMod.code.call(blockContext, recCache, DBB);
                        } catch (err) {
                            console.error('[BŁĄD RECEIVERA]:', err);
                        }
                    }
                }
            });
        }
    }
};

DBB.Blocks.Core = blockContext;

// Start wszystkich bloków po zalogowaniu bota
client.once(Events.ClientReady, async (readyClient) => {
    console.log(\`✅ Zalogowano pomyślnie jako \${readyClient.user.tag}! Aktywnych workspace'ów: \${runtimeWorkspaces.length}\`);

    // 1. Uruchomienie metod init(DBB, blockName) dla wszystkich zainstalowanych bloków używanych w projekcie
    const usedBlockNames = new Set();
    runtimeWorkspaces.forEach(rws => rws.blocks.forEach(b => {
        if (b.active !== false) usedBlockNames.add(b.name);
    }));
    if (blockModules.has('!auto_package_manager')) usedBlockNames.add('!auto_package_manager');

    for (const blockName of usedBlockNames) {
        const mod = blockModules.get(blockName);
        if (mod && typeof mod.init === 'function') {
            try {
                await mod.init.call(blockContext, DBB, blockName);
            } catch (err) {
                console.error(\`[BŁĄD INIT \${blockName}]:\`, err.message);
            }
        }
    }

    // 2. Najpierw obliczamy statyczne bloki wartości (auto_execute bez eventów, np. text, boolean, komponenty)
    for (const rws of runtimeWorkspaces) {
        for (let i = 0; i < rws.blocks.length; i++) {
            const b = rws.blocks[i];
            if (b.active === false) continue;
            const mod = blockModules.get(b.name);
            if (!mod || !mod.auto_execute || typeof mod.code !== 'function') continue;
            const isEvent = (mod.category || '').toLowerCase().includes('event') || b.name.endsWith('_event');
            if (!isEvent) {
                const cache = createCache(rws, i);
                try {
                    await mod.code.call(blockContext, cache, DBB);
                } catch (err) {
                    console.error(\`[BŁĄD AUTO-BLOKU \${b.name} w "\${rws.title}"]:\`, err.message);
                }
            }
        }
    }

    // 3. Teraz uruchamiamy bloki Eventów (auto_execute: true)
    for (const rws of runtimeWorkspaces) {
        for (let i = 0; i < rws.blocks.length; i++) {
            const b = rws.blocks[i];
            if (b.active === false) continue;
            const mod = blockModules.get(b.name);
            if (!mod || !mod.auto_execute || typeof mod.code !== 'function') continue;
            const isEvent = (mod.category || '').toLowerCase().includes('event') || b.name.endsWith('_event');
            if (isEvent) {
                const cache = createCache(rws, i);
                try {
                    await mod.code.call(blockContext, cache, DBB);
                } catch (err) {
                    console.error(\`[BŁĄD EVENTU \${b.name} w "\${rws.title}"]:\`, err.message);
                }
            }
        }
    }
});

// Logowanie bota
const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
if (!token) {
    console.error('❌ Brak tokenu bota! Podaj token w Pitaya Bot Builderze lub w pliku .env (TOKEN=...)');
    process.exit(1);
}

client.login(token).catch(err => {
    console.error('❌ Błąd logowania do Discorda:', err.message);
    process.exit(1);
});
`;
}

// ═══════ PROJEKTY (Multi-Project Support 1:1 DBB) ═══════
ipcMain.handle('get-projects', () => {
    const settings = loadSettings();
    const colors = ['#8b572a', '#5a8b2a', '#8b2a4a', '#2a6e8b', '#6e2a8b', '#8b7a2a'];

    // Tylko prawdziwe, istniejące projekty z listy recent
    const recentList = settings.recent.map((recPath, i) => {
        const pName = path.basename(recPath);
        let initials = pName.split(/[\s-_]+/).filter(Boolean).map(w => w[0]).join('-').toUpperCase().slice(0, 5);
        if (!initials) initials = pName.slice(0, 2).toUpperCase();
        let wsCount = 0;
        try {
            const p = getProjectPaths(recPath);
            if (fs.existsSync(p.workspaces)) {
                const data = JSON.parse(fs.readFileSync(p.workspaces, 'utf8'));
                wsCount = Array.isArray(data) ? data.length : 0;
            }
        } catch(e) {}
        return {
            name: pName,
            path: recPath,
            initials,
            color: colors[i % colors.length],
            wsCount
        };
    });

    const currPaths = currentProject ? getProjectPaths(currentProject) : null;

    return {
        recent: recentList,
        list: recentList.map(r => r.path),
        current: currPaths ? currPaths.name : null,
        currentPath: currPaths ? currPaths.dir : null,
        savedToken: currPaths ? currPaths.savedToken : ''
    };
});

ipcMain.handle('pick-directory', async (event, defaultPath) => {
    const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Wybierz folder dla nowego bota',
        defaultPath: defaultPath || BOTY_DIR,
        properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
});

ipcMain.handle('open-project-dialog', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Wybierz folder bota (Discord Bot Builder)',
        defaultPath: BOTY_DIR,
        properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const targetDir = res.filePaths[0];

    // Jeśli w projekcie brakuje folderu blocks, skopiuj z wzorca
    const bDest = path.join(targetDir, 'blocks');
    if (!fs.existsSync(bDest)) {
        try { fs.cpSync(BLOCKS_DIR, bDest, { recursive: true }); } catch(e) {}
    }

    // Jeśli brakuje workspaces.json, utwórz pusty []
    const wsPath = path.join(targetDir, 'data', 'workspaces.json');
    const rootWs = path.join(targetDir, 'workspaces.json');
    if (!fs.existsSync(wsPath) && !fs.existsSync(rootWs)) {
        const dDir = path.join(targetDir, 'data');
        if (!fs.existsSync(dDir)) fs.mkdirSync(dDir, { recursive: true });
        fs.writeFileSync(wsPath, JSON.stringify([], null, 4), 'utf8');
    }

    // Zapisz do recent
    const settings = loadSettings();
    settings.recent = [targetDir, ...(settings.recent || []).filter(r => r !== targetDir)];
    saveSettings(settings);

    currentProject = targetDir;
    const p = getProjectPaths(currentProject);
    if (!p) return { ok: false, error: 'Nie można otworzyć folderu: ' + targetDir };
    return { ok: true, current: p.name, path: targetDir, savedToken: p.savedToken };
});

ipcMain.handle('switch-project', (event, projNameOrPath) => {
    const paths = getProjectPaths(projNameOrPath);
    if (!paths) return { ok: false, error: 'Nie znaleziono projektu: ' + projNameOrPath };
    currentProject = paths.dir;

    const settings = loadSettings();
    settings.recent = [paths.dir, ...(settings.recent || []).filter(r => r !== paths.dir)];
    saveSettings(settings);

    return { ok: true, current: paths.name, path: paths.dir, savedToken: paths.savedToken };
});

ipcMain.handle('create-project', (event, payload) => {
    const name = typeof payload === 'object' ? payload.name : payload;
    const customDir = typeof payload === 'object' ? payload.targetDir : null;

    if (!name || !name.trim()) return { ok: false, error: 'Nazwa projektu nie może być pusta' };
    const cleanName = name.trim();
    const destDir = customDir ? customDir.trim() : path.join(BOTY_DIR, cleanName.replace(/[<>:"/\\|?*]/g, '_'));

    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    // 1. Kopiuj folder blocks/ ze wszystkimi blokami
    const destBlocks = path.join(destDir, 'blocks');
    if (!fs.existsSync(destBlocks)) {
        try { fs.cpSync(BLOCKS_DIR, destBlocks, { recursive: true }); } catch(e) {}
    }

    // 2. Folder data/
    const destData = path.join(destDir, 'data');
    if (!fs.existsSync(destData)) {
        fs.mkdirSync(destData, { recursive: true });
    }

    // 3. workspaces.json - domyślnie pusty [], użytkownik sam tworzy workspace
    const wsPath = path.join(destData, 'workspaces.json');
    if (!fs.existsSync(wsPath)) {
        fs.writeFileSync(wsPath, JSON.stringify([], null, 4), 'utf8');
    }

    // 4. data.json
    const dataPath = path.join(destData, 'data.json');
    if (!fs.existsSync(dataPath)) {
        const defaultData = {
            dbb: { prefixes: { main: "!", servers: {} }, owners: [] },
            discord: { servers: {}, members: {}, users: {} },
            blocks: {},
            custom: {}
        };
        fs.writeFileSync(dataPath, JSON.stringify(defaultData, null, 4), 'utf8');
    }

    // 5. INTENTS.txt (jak w szablonie DBB)
    const intentsPath = path.join(destData, 'INTENTS.txt');
    if (!fs.existsSync(intentsPath)) {
        fs.writeFileSync(intentsPath, 'ALL_INTENTS', 'utf8');
    }

    // 5b. token.txt
    const tokenPath = path.join(destData, 'token.txt');
    if (!fs.existsSync(tokenPath)) {
        fs.writeFileSync(tokenPath, '', 'utf8');
    }

    // 6. package.json
    const pkgPath = path.join(destDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        const pkgObj = {
            name: cleanName.toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
            version: "1.0.0",
            main: "bot.js",
            dependencies: {
                "discord.js": "^14.17.3",
                "dotenv": "^16.6.1"
            }
        };
        fs.writeFileSync(pkgPath, JSON.stringify(pkgObj, null, 4), 'utf8');
    }

    // 7. bot.js
    const paths = getProjectPaths(destDir);
    writeBotFile(paths);

    // 8. .env
    if (!fs.existsSync(paths.env)) {
        fs.writeFileSync(paths.env, 'TOKEN=\n', 'utf8');
    }

    // 9. Zapisz w recent w settings.json
    const settings = loadSettings();
    settings.recent = [destDir, ...(settings.recent || []).filter(r => r !== destDir)];
    saveSettings(settings);

    currentProject = destDir;
    return { ok: true, current: cleanName, path: destDir, savedToken: '' };
});

ipcMain.handle('clear-recent', () => {
    const settings = loadSettings();
    settings.recent = [];
    saveSettings(settings);
    return { ok: true };
});

ipcMain.handle('remove-recent', (event, recPath) => {
    const settings = loadSettings();
    settings.recent = (settings.recent || []).filter(r => r !== recPath && path.basename(r) !== recPath);
    saveSettings(settings);
    return { ok: true };
});

ipcMain.handle('delete-project', (event, projName) => {
    const paths = getProjectPaths(projName);
    if (!paths) return { ok: false, error: 'Nie znaleziono projektu' };
    if (paths.dir === ROOT_DIR) return { ok: false, error: 'Nie można usunąć głównego projektu' };
    if (fs.existsSync(paths.dir)) {
        fs.rmSync(paths.dir, { recursive: true, force: true });
    }
    const settings = loadSettings();
    settings.recent = (settings.recent || []).filter(r => r !== paths.dir);
    saveSettings(settings);
    if (currentProject === paths.dir) {
        currentProject = null;
    }
    return { ok: true, current: null };
});

ipcMain.handle('generate-bot', (event, token) => {
    try {
        if (!currentProject) return { ok: false, error: 'Brak otwartego projektu' };
        const paths = getProjectPaths(currentProject);
        if (!paths) return { ok: false, error: 'Nie znaleziono projektu' };
        const written = writeBotFile(paths);
        saveProjectToken(paths, token);
        return { ok: true, path: paths.bot, keptOriginal: !written };
    } catch (err) {
        console.error('[BŁĄD GENEROWANIA bot.js]:', err);
        return { ok: false, error: err.message };
    }
});

// ═══════ ZARZĄDZANIE WIELOMA PROCESAMI BOTÓW JEDNOCZEŚNIE ═══════
function getRunningBotsList() {
    const list = [];
    runningBotProcesses.forEach((entry, projDir) => {
        list.push({
            dir: projDir,
            name: entry.name,
            startTime: entry.startTime,
            pid: entry.process?.pid || null,
            status: entry.status || 'running'
        });
    });
    return list;
}

ipcMain.handle('get-running-bots', () => {
    return getRunningBotsList();
});

ipcMain.handle('get-bot-logs', (event, projNameOrPath) => {
    const targetProj = projNameOrPath || currentProject;
    if (!targetProj) return [];
    const paths = getProjectPaths(targetProj);
    if (!paths) return [];
    return botLogsHistory.get(paths.dir) || [];
});

ipcMain.handle('start-bot', (event, arg) => {
    let targetProj = currentProject;
    let explicitToken = '';

    if (typeof arg === 'string') {
        explicitToken = arg;
    } else if (arg && typeof arg === 'object') {
        targetProj = arg.projNameOrPath || currentProject;
        explicitToken = arg.token || '';
    }

    if (!targetProj) return { ok: false, error: 'Brak projektu do uruchomienia' };
    const paths = getProjectPaths(targetProj);
    if (!paths) return { ok: false, error: 'Nie znaleziono ścieżek projektu: ' + targetProj };

    if (runningBotProcesses.has(paths.dir)) {
        appendBotLog(paths.dir, paths.name, 'ℹ️ Bot jest już uruchomiony w tle.', 'info');
        return { ok: true, status: 'already_running', project: paths.name, dir: paths.dir, runningList: getRunningBotsList() };
    }

    // Wyczyszczenie poprzednich logów dla nowego uruchomienia
    botLogsHistory.set(paths.dir, []);
    appendBotLog(paths.dir, paths.name, '🚀 Uruchamianie bota "' + paths.name + '"...', 'info');

    // Generuj aktualny bot.js (oryginalny runtime DBB zostaje nietknięty)
    try {
        writeBotFile(paths);
    } catch (e) {
        console.error('[BŁĄD ZAPISU bot.js]:', e.message);
    }

    // Ustal właściwy token dla TEGO projektu
    let effectiveToken = (explicitToken && explicitToken.trim()) ? explicitToken.trim() : (paths.savedToken || '');

    if (explicitToken && explicitToken.trim()) {
        saveProjectToken(paths, explicitToken);
        effectiveToken = explicitToken.trim();
    }

    // Sprawdź czy token jest dostępny
    if (!effectiveToken) {
        const noTokMsg = '❌ Brak tokenu Discord dla bota "' + paths.name + '". Wpisz token w polu na górze lub w pliku .env';
        appendBotLog(paths.dir, paths.name, noTokMsg, 'error');
        return { ok: false, error: noTokMsg, needToken: true, project: paths.name, dir: paths.dir };
    }

    const nmPaths = getNodeModulesPaths(paths.dir);
    const projNm = path.join(paths.dir, 'node_modules');
    if (!fs.existsSync(projNm) && nmPaths.length > 0) {
        try {
            fs.symlinkSync(nmPaths[0], projNm, 'dir');
            if (!nmPaths.includes(projNm)) nmPaths.unshift(projNm);
        } catch(e) {
            console.warn('[SYM-LINK WARN]:', e.message);
        }
    }

    const existingNodePath = process.env.NODE_PATH || '';
    const nodePathStr = [...nmPaths, existingNodePath].filter(Boolean).join(':');

    const env = Object.assign({}, process.env, {
        TOKEN: effectiveToken,
        DISCORD_TOKEN: effectiveToken,
        NODE_PATH: nodePathStr
    });
    const cwd = paths.dir;

    const diag = diagnoseProject(paths.dir);
    if (diag.length) {
        diag.forEach(msg => appendBotLog(paths.dir, paths.name, msg, 'stderr'));
    }

    // --unhandled-rejections=warn: jeden błąd w bloku (np. pusta wiadomość) nie zabija całego bota
    const child = spawn('node', ['--unhandled-rejections=warn', paths.bot], { cwd, env });

    runningBotProcesses.set(paths.dir, {
        process: child,
        name: paths.name,
        dir: paths.dir,
        startTime: Date.now(),
        status: 'running'
    });

    child.stdout.on('data', (data) => {
        const text = data.toString();
        process.stdout.write(`[BOT:${paths.name}] ${text}`);
        appendBotLog(paths.dir, paths.name, text, 'stdout');
    });

    child.stderr.on('data', (data) => {
        const text = data.toString();
        process.stderr.write(`[BOT:${paths.name} ERROR] ${text}`);
        appendBotLog(paths.dir, paths.name, text, 'stderr');
    });

    child.on('close', (code) => {
        runningBotProcesses.delete(paths.dir);
        appendBotLog(paths.dir, paths.name, `[BOT] Proces bota zakończony (kod wyjścia: ${code})`, code === 0 ? 'info' : 'error');
        if (mainWindow) {
            mainWindow.webContents.send('bot-status-change', {
                projectDir: paths.dir,
                projectName: paths.name,
                running: false,
                code: code,
                runningList: getRunningBotsList()
            });
            mainWindow.webContents.send('bot-status', runningBotProcesses.size > 0);
        }
    });

    if (mainWindow) {
        mainWindow.webContents.send('bot-status-change', {
            projectDir: paths.dir,
            projectName: paths.name,
            running: true,
            runningList: getRunningBotsList()
        });
        mainWindow.webContents.send('bot-status', true);
    }

    return { ok: true, status: 'started', project: paths.name, dir: paths.dir, runningList: getRunningBotsList() };
});

ipcMain.handle('stop-bot', (event, projNameOrPath) => {
    const targetProj = projNameOrPath || currentProject;
    if (!targetProj) return { ok: false, error: 'Brak projektu' };
    const paths = getProjectPaths(targetProj);
    if (!paths) return { ok: false, error: 'Nie znaleziono ścieżek projektu' };

    const entry = runningBotProcesses.get(paths.dir);
    if (entry && entry.process) {
        entry.process.kill();
        runningBotProcesses.delete(paths.dir);
        appendBotLog(paths.dir, paths.name, '[PBB] Bot zatrzymany ręcznie.', 'info');
        if (mainWindow) {
            mainWindow.webContents.send('bot-status-change', {
                projectDir: paths.dir,
                projectName: paths.name,
                running: false,
                runningList: getRunningBotsList()
            });
            mainWindow.webContents.send('bot-status', runningBotProcesses.size > 0);
        }
        return { ok: true, status: 'stopped', project: paths.name, dir: paths.dir, runningList: getRunningBotsList() };
    }
    return { ok: false, status: 'not_running', project: paths.name, dir: paths.dir };
});

ipcMain.handle('stop-all-bots', () => {
    runningBotProcesses.forEach((entry) => {
        try { if (entry.process) entry.process.kill(); } catch (e) {}
    });
    runningBotProcesses.clear();
    if (mainWindow) {
        mainWindow.webContents.send('bot-status-change', {
            running: false,
            runningList: []
        });
    }
    return { ok: true, status: 'all_stopped', runningList: [] };
});

// Ładowanie bloków z folderu /blocks/
ipcMain.handle('get-installed-blocks', () => {
    const blocksDir = getCurrentBlocksDir();
    const files = fs.readdirSync(blocksDir).filter(f => f.endsWith(".js"));
    const loadedBlocks = [];

    for (const file of files) {
        try {
            const filePath = path.join(blocksDir, file);
            delete require.cache[require.resolve(filePath)];
            const blockModule = require(filePath);

            const dummyData = { inputs: {}, options: {}, outputs: { text: [[]] } };
            const inputs = resolveBlockProp(blockModule.inputs, dummyData);
            const options = resolveBlockProp(blockModule.options, dummyData);
            const outputs = resolveBlockProp(blockModule.outputs, dummyData);

            loadedBlocks.push({
                file: file,
                idName: file.replace('.js', ''),
                name: blockModule.name || file.replace('.js', ''),
                description: blockModule.description || '',
                category: blockModule.category || 'General',
                hasDynamicInputs: typeof blockModule.inputs === 'function',
                hasDynamicOptions: typeof blockModule.options === 'function',
                hasDynamicOutputs: typeof blockModule.outputs === 'function',
                inputs,
                options,
                outputs
            });
        } catch (err) {
            console.error(`[BŁĄD BLOKU ${file}]:`, err.message);
        }
    }

    return loadedBlocks;
});

// Dynamiczna ewaluacja schematu bloku na podstawie jego aktualnych opcji/wejść/wyjść
ipcMain.handle('evaluate-block-schema', (event, blockData) => {
    try {
        const filePath = path.join(getCurrentBlocksDir(), `${blockData.name}.js`);
        if (!fs.existsSync(filePath)) return null;
        const blockModule = require(filePath);
        return {
            inputs: resolveBlockProp(blockModule.inputs, blockData),
            options: resolveBlockProp(blockModule.options, blockData),
            outputs: resolveBlockProp(blockModule.outputs, blockData)
        };
    } catch (err) {
        return null;
    }
});

// Odczyt i Zapis workspaces.json dla aktualnego projektu
ipcMain.handle('load-workspaces', () => {
    if (!currentProject) return [];
    const paths = getProjectPaths(currentProject);
    if (paths && fs.existsSync(paths.workspaces)) {
        try {
            const data = JSON.parse(fs.readFileSync(paths.workspaces, 'utf-8'));
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('[BŁĄD ODCZYTU workspaces.json]:', err);
        }
    }
    return [];
});

ipcMain.handle('save-workspaces', (event, data) => {
    if (!currentProject) return false;
    const paths = getProjectPaths(currentProject);
    if (!paths) return false;
    try {
        const dir = path.dirname(paths.workspaces);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(paths.workspaces, JSON.stringify(data, null, 4), 'utf-8');
        return true;
    } catch (err) {
        console.error('[BŁĄD ZAPISU workspaces.json]:', err);
        return false;
    }
});

// ═══════ AKTUALIZATOR GITHUB (Pitaya Core) ═══════
// Okno oczekuje starego formatu odpowiedzi (latestCommit / latestRelease) — tłumaczymy wynik Core.
ipcMain.handle('check-app-update', async () => {
    const res = await core.updater.check();
    if (!res.ok) return res;
    const latestCommit = res.mode === 'git' && res.commits && res.commits.length
        ? { sha: res.commits[0].sha, message: res.commits[0].message, date: res.commits[0].date }
        : null;
    return {
        ok: true,
        currentVersion: res.currentVersion,
        localCommitSha: res.localSha || '',
        latestRelease: res.mode === 'release' && res.latestVersion
            ? { tag: `v${res.latestVersion}`, name: res.latestVersion, body: res.notes, url: res.url }
            : null,
        latestCommit,
        hasUpdate: res.hasUpdate,
        updateType: res.hasUpdate ? res.mode : 'none',
    };
});

ipcMain.handle('apply-git-update', async () => {
    const res = await core.updater.apply();
    if (res.ok && res.openedBrowser) return { ok: true, output: 'Otwarto stronę z nową wersją w przeglądarce.' };
    return res.ok ? { ok: true, output: 'Zaktualizowano.' } : { ok: false, error: res.error };
});

ipcMain.handle('set-token', (event, token) => {
    if (!currentProject) return { ok: false, error: 'Brak otwartego projektu' };
    const paths = getProjectPaths(currentProject);
    if (!paths) return { ok: false, error: 'Nie znaleziono projektu' };
    try {
        if (token && token.trim()) {
            saveProjectToken(paths, token);
        } else {
            fs.writeFileSync(paths.tokenTxt, '', 'utf-8');
            if (fs.existsSync(paths.env)) fs.writeFileSync(paths.env, 'TOKEN=\n', 'utf-8');
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

// Link zaproszenia jak w DBB (ID aplikacji = pierwsza część tokenu w base64)
ipcMain.handle('get-bot-invite', () => {
    const paths = currentProject ? getProjectPaths(currentProject) : null;
    const token = paths ? paths.savedToken : '';
    if (!token) return { ok: false, error: 'Ustaw najpierw token bota (Bot → Set Bot Token)' };
    try {
        const clientId = Buffer.from(token.split('.')[0], 'base64').toString('utf8');
        if (!/^\d{15,22}$/.test(clientId)) return { ok: false, error: 'Nieprawidłowy token bota' };
        return { ok: true, url: `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands` };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('open-path', async (event, targetPath) => {
    const { shell } = require('electron');
    if (!targetPath || !fs.existsSync(targetPath)) return { ok: false };
    const err = await shell.openPath(targetPath);
    return { ok: !err, error: err };
});

ipcMain.handle('get-default-boty-dir', () => {
    return BOTY_DIR;
});
