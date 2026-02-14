// EOS Cue Manager - Standalone Version
// No native dependencies required - can be packaged as standalone .exe

const express = require('express');
const path = require('path');
const fs = require('fs');
const nodeOsc = require('node-osc');  // UDP OSC library
const osc = require('osc');  // TCP OSC library with SLIP support
const multer = require('multer');

const app = express();
const PORT = 5000;

// Data storage files
const DATA_DIR = './data';
const SHOWS_DIR = path.join(DATA_DIR, 'shows');
const GLOBAL_SETTINGS_FILE = path.join(DATA_DIR, 'global_settings.json');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(SHOWS_DIR)) {
    fs.mkdirSync(SHOWS_DIR, { recursive: true });
}

// Current show tracking
let currentShowName = 'Default';
let mainPlaybackList = '1'; // The main playback fader's cue list
let globalSettings = {
    lastShowName: 'Default',
    oscSettings: {
        ip_address: '192.168.1.100',
        port: 3037,
        osc_version: '1.1',
        protocol: 'tcp'
    }
};

// Get paths for current show's data files
// Use URL-safe encoding to ensure unique folder names for each show
function encodeShowName(showName) {
    // URL-encode the show name to ensure unique and filesystem-safe folder names
    // This is bijective - every unique show name maps to a unique folder
    return encodeURIComponent(showName).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function decodeShowName(encodedName) {
    try {
        return decodeURIComponent(encodedName);
    } catch (e) {
        return encodedName; // Return as-is if decoding fails
    }
}

function getShowDir(showName) {
    if (!showName || !showName.trim()) {
        showName = 'Default';
    }
    const safeName = encodeShowName(showName);
    return path.join(SHOWS_DIR, safeName);
}

function getShowCuesFile(showName) {
    return path.join(getShowDir(showName), 'cues.json');
}

function getShowNotesFile(showName) {
    return path.join(getShowDir(showName), 'show_notes.json');
}

function getShowTimingsFile(showName) {
    return path.join(getShowDir(showName), 'show_timings.json');
}

// List all available shows
function listShows() {
    if (!fs.existsSync(SHOWS_DIR)) {
        return ['Default'];
    }
    const encodedNames = fs.readdirSync(SHOWS_DIR)
        .filter(f => fs.statSync(path.join(SHOWS_DIR, f)).isDirectory());
    // Decode the folder names back to original show names
    const shows = encodedNames.map(n => decodeShowName(n));
    return shows.length > 0 ? shows : ['Default'];
}

// Create a new show
function createShow(showName) {
    const showDir = getShowDir(showName);
    if (!fs.existsSync(showDir)) {
        fs.mkdirSync(showDir, { recursive: true });
        fs.writeFileSync(getShowCuesFile(showName), JSON.stringify([], null, 2));
        fs.writeFileSync(getShowNotesFile(showName), JSON.stringify({ notes: '' }, null, 2));
        fs.writeFileSync(getShowTimingsFile(showName), JSON.stringify({
            isRecording: false,
            showStartTime: null,
            lastCueTime: null,
            lastCueNumber: null,
            cueTimings: []
        }, null, 2));
        console.log(`📁 Created new show: ${showName}`);
        return true;
    }
    return false;
}

// Delete a show
function deleteShow(showName) {
    if (showName === 'Default') {
        console.log('⚠️ Cannot delete Default show');
        return false;
    }
    const showDir = getShowDir(showName);
    if (fs.existsSync(showDir)) {
        fs.rmSync(showDir, { recursive: true });
        console.log(`🗑️ Deleted show: ${showName}`);
        return true;
    }
    return false;
}

// Check if a show exists
function showExists(showName) {
    const showDir = getShowDir(showName);
    return fs.existsSync(showDir);
}

// Switch to a different show
function switchShow(showName) {
    const showDir = getShowDir(showName);
    if (!fs.existsSync(showDir)) {
        createShow(showName);
    }
    currentShowName = showName;
    globalSettings.lastShowName = showName;
    saveGlobalSettings();
    loadShowData();
    console.log(`🔄 Switched to show: ${showName}`);
    return true;
}

// Load show-specific data
function loadShowData() {
    const showDir = getShowDir(currentShowName);
    if (!fs.existsSync(showDir)) {
        createShow(currentShowName);
    }
    
    try {
        const cuesFile = getShowCuesFile(currentShowName);
        if (fs.existsSync(cuesFile)) {
            cues = JSON.parse(fs.readFileSync(cuesFile, 'utf8'));
        } else {
            cues = [];
        }
        
        const notesFile = getShowNotesFile(currentShowName);
        if (fs.existsSync(notesFile)) {
            showNotes = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
        } else {
            showNotes = { notes: '' };
        }
        
        const timingsFile = getShowTimingsFile(currentShowName);
        if (fs.existsSync(timingsFile)) {
            showTimings = JSON.parse(fs.readFileSync(timingsFile, 'utf8'));
        } else {
            showTimings = {
                isRecording: false,
                showStartTime: null,
                lastCueTime: null,
                lastCueNumber: null,
                cueTimings: []
            };
        }
        
        console.log(`📂 Loaded data for show: ${currentShowName} (${cues.length} cues)`);
    } catch (error) {
        console.error('Error loading show data:', error);
        cues = [];
        showNotes = { notes: '' };
    }
}

// Save global settings
function saveGlobalSettings() {
    fs.writeFileSync(GLOBAL_SETTINGS_FILE, JSON.stringify(globalSettings, null, 2));
}

// Migrate legacy folder names to new encoding scheme
function migrateLegacyFolders() {
    if (!fs.existsSync(SHOWS_DIR)) return;
    
    const folders = fs.readdirSync(SHOWS_DIR)
        .filter(f => fs.statSync(path.join(SHOWS_DIR, f)).isDirectory());
    
    for (const folder of folders) {
        // Check if folder is already properly encoded
        const decoded = decodeShowName(folder);
        const reEncoded = encodeShowName(decoded);
        
        if (folder !== reEncoded) {
            // This folder was created with old sanitization - rename it
            // Use the decoded name re-encoded to avoid double-encoding
            const oldPath = path.join(SHOWS_DIR, folder);
            const newPath = path.join(SHOWS_DIR, reEncoded);
            
            if (!fs.existsSync(newPath)) {
                console.log(`📦 Migrating legacy folder "${folder}" to "${reEncoded}" (show: "${decoded}")`);
                fs.renameSync(oldPath, newPath);
            }
        }
    }
}

// Load global settings and migrate old data if needed
function loadGlobalSettings() {
    try {
        if (fs.existsSync(GLOBAL_SETTINGS_FILE)) {
            globalSettings = JSON.parse(fs.readFileSync(GLOBAL_SETTINGS_FILE, 'utf8'));
            currentShowName = globalSettings.lastShowName || 'Default';
            mainPlaybackList = globalSettings.mainPlaybackList || '1';
        }
        
        // Migrate legacy folder naming scheme
        migrateLegacyFolders();
        
        // Migrate old data structure if it exists
        const oldCuesFile = path.join(DATA_DIR, 'cues.json');
        const oldSettingsFile = path.join(DATA_DIR, 'settings.json');
        const oldNotesFile = path.join(DATA_DIR, 'show_notes.json');
        const oldTimingsFile = path.join(DATA_DIR, 'show_timings.json');
        
        if (fs.existsSync(oldCuesFile) && !fs.existsSync(GLOBAL_SETTINGS_FILE)) {
            console.log('📦 Migrating existing data to Default show...');
            
            // Create Default show directory
            const defaultDir = getShowDir('Default');
            if (!fs.existsSync(defaultDir)) {
                fs.mkdirSync(defaultDir, { recursive: true });
            }
            
            // Move old files to Default show
            if (fs.existsSync(oldCuesFile)) {
                fs.copyFileSync(oldCuesFile, getShowCuesFile('Default'));
                fs.unlinkSync(oldCuesFile);
            }
            if (fs.existsSync(oldNotesFile)) {
                fs.copyFileSync(oldNotesFile, getShowNotesFile('Default'));
                fs.unlinkSync(oldNotesFile);
            }
            if (fs.existsSync(oldTimingsFile)) {
                fs.copyFileSync(oldTimingsFile, getShowTimingsFile('Default'));
                fs.unlinkSync(oldTimingsFile);
            }
            
            // Migrate old settings to global settings
            if (fs.existsSync(oldSettingsFile)) {
                const oldSettings = JSON.parse(fs.readFileSync(oldSettingsFile, 'utf8'));
                globalSettings.oscSettings = {
                    ip_address: oldSettings.ip_address || '192.168.1.100',
                    port: oldSettings.port || 8000,
                    osc_version: oldSettings.osc_version || '1.1'
                };
                fs.unlinkSync(oldSettingsFile);
            }
            
            globalSettings.lastShowName = 'Default';
            saveGlobalSettings();
            console.log('✅ Migration complete');
        }
    } catch (error) {
        console.error('Error loading global settings:', error);
    }
}

// OSC Configuration
let oscClient = null;  // UDP client for OSC communication
let isConnected = false;

// Settings are now stored in globalSettings.oscSettings
// Keep a reference for compatibility
let settings = null;  // Will be set from globalSettings

let cues = [];
let showNotes = { notes: '' };
let cuesChanged = false; // Flag to notify frontend of changes

// Show timing data
let showTimings = {
    isRecording: false,
    showStartTime: null,
    lastCueTime: null,
    lastCueNumber: null,
    cueTimings: []  // Array of { cueNumber, timestamp, timeFromPrevious }
};
let currentShowElapsed = 0;  // Current elapsed time in show
let lastCueFireTime = null;  // Wall-clock time when last cue fired

// Track connected EOS show name for auto-switching
let connectedEOSShowName = null;

let knownCueLists = [];
let activeCuePoller = null;
let activePollingQueue = [];
let activePollingInProgress = false;

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!fs.existsSync('uploads')) {
            fs.mkdirSync('uploads', { recursive: true });
        }
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// Load all data
function loadData() {
    loadGlobalSettings();
    settings = globalSettings.oscSettings;
    loadShowData();
}

// Save settings (now saves to global settings)
function saveSettings() {
    globalSettings.oscSettings = settings;
    globalSettings.mainPlaybackList = mainPlaybackList;
    saveGlobalSettings();
}

// Save cues (to current show's file) - debounced async version
let saveCuesTimer = null;
function saveCues() {
    if (saveCuesTimer) clearTimeout(saveCuesTimer);
    saveCuesTimer = setTimeout(() => {
        const cuesFile = getShowCuesFile(currentShowName);
        fs.writeFile(cuesFile, JSON.stringify(cues, null, 2), (err) => {
            if (err) console.error('❌ Error saving cues:', err);
        });
    }, 1000);
}

// Synchronous save for API endpoints that need immediate persistence
function saveCuesSync() {
    const cuesFile = getShowCuesFile(currentShowName);
    fs.writeFileSync(cuesFile, JSON.stringify(cues, null, 2));
}

// Notify frontend that cues have changed
function notifyFrontendCuesChanged() {
    cuesChanged = true;
    console.log('🔔 Frontend notified: cues changed');
}

function saveShowTimings() {
    const timingsFile = getShowTimingsFile(currentShowName);
    fs.writeFile(timingsFile, JSON.stringify(showTimings, null, 2), (err) => {
        if (err) console.error('❌ Error saving timings:', err);
    });
}

function saveShowNotes() {
    const notesFile = getShowNotesFile(currentShowName);
    fs.writeFileSync(notesFile, JSON.stringify(showNotes, null, 2));
}

// Request all cues from a specific cue list
let bulkRefreshInProgress = false;
let bulkRefreshCueList = null;
let bulkRefreshExpectedCount = 0;
let bulkRefreshReceivedIndices = new Set();
let bulkRefreshClearedCues = [];
let bulkRefreshTimeouts = []; // Track all active timeouts for this refresh
let bulkRefreshSessionCounter = 0; // Counter to generate unique session IDs
let bulkRefreshActiveSessionId = null; // Active session ID that should be processing responses
let bulkRefreshReceivedCues = new Set(); // Track cue numbers received in current refresh
let lastKnownCueCount = {}; // Track cue count per list for auto-detection
let bulkRefreshCountReceived = false; // Flag to track if we've received the count for current session
let bulkRefreshPendingRequest = null; // Queued refresh request waiting for current one to finish
let bulkRefreshRequestTimestamp = 0; // Timestamp when current session sent its count request

let bulkRefreshQueue = []; // Queue of cue lists waiting to be refreshed

function requestAllCues(cueList = 1, clearExisting = true) {
    if (!oscClient && !tcpPort) {
        console.error('⚠️ OSC client not initialized');
        return;
    }
    
    // If a refresh is already in progress, queue this request
    if (bulkRefreshInProgress) {
        // Avoid duplicate queue entries
        if (!bulkRefreshQueue.includes(cueList) && bulkRefreshCueList !== cueList) {
            bulkRefreshQueue.push(cueList);
            console.log(`📋 Queued cue list ${cueList} for refresh (${bulkRefreshQueue.length} in queue)`);
        }
        return;
    }
    
    console.log(`📋 Requesting cue count from cue list ${cueList}...`);
    
    // Reset bulk refresh state
    bulkRefreshInProgress = true;
    bulkRefreshCueList = cueList;
    bulkRefreshExpectedCount = 0;
    bulkRefreshReceivedIndices.clear();
    bulkRefreshReceivedCues.clear();
    bulkRefreshClearedCues = [];
    
    // CueView method: First get the count, then request each cue by INDEX
    // This is much more reliable than requesting by cue number
    sendOSC(`/eos/get/cue/${cueList}/count`);
    console.log(`📡 Sent: /eos/get/cue/${cueList}/count`);
    console.log(`💡 Waiting for EOS to respond with cue count...`);
    
    // Set a timeout in case EOS doesn't respond - try wildcard fallback
    setTimeout(() => {
        if (bulkRefreshInProgress && bulkRefreshExpectedCount === 0) {
            console.log(`⚠️ No count response - trying wildcard fallback...`);
            // Try the wildcard approach as fallback
            sendOSC(`/eos/get/cue/${cueList}/0/1000`);
            console.log(`📡 Sent: /eos/get/cue/${cueList}/0/1000 (range request)`);
            
            // Also try requesting cue 0 which often exists
            sendOSC(`/eos/get/cue/${cueList}/1`);
            console.log(`📡 Sent: /eos/get/cue/${cueList}/1`);
            
            // Try the cuelist/cue/*/list wildcard pattern from earlier versions
            sendOSC(`/eos/get/cuelist/${cueList}/cue/*/list`);
            console.log(`📡 Sent: /eos/get/cuelist/${cueList}/cue/*/list (wildcard)`);
            
            // Final timeout to end refresh if nothing works
            setTimeout(() => {
                if (bulkRefreshInProgress && bulkRefreshExpectedCount === 0) {
                    console.error(`⚠️ No response from EOS - cue refresh failed`);
                    bulkRefreshInProgress = false;
                    bulkRefreshCueList = null;
                }
            }, 5000);
        }
    }, 5000);
}

// Called when we receive the cue count response
function handleCueCountResponse(cueList, count) {
    if (!bulkRefreshInProgress || bulkRefreshCueList !== cueList) {
        console.log(`⚠️ Ignoring count response for list ${cueList} - not part of current refresh`);
        return;
    }
    
    console.log(`📊 Cue list ${cueList} has ${count} cues`);
    bulkRefreshExpectedCount = count;
    
    // Track cue count for auto-detection
    lastKnownCueCount[cueList] = count;
    
    if (count === 0) {
        console.log('✅ No cues in list - refresh complete');
        // Still need to clean up old cues from this list
        checkBulkRefreshComplete();
        return;
    }
    
    // CueView method: Request each cue by INDEX (position in the list)
    // This gets cue at position 0, 1, 2, etc. regardless of cue number
    console.log(`📡 Requesting ${count} cues by index (CueView method, batched)...`);
    let i = 0;
    const batchInterval = setInterval(() => {
        for (let k = 0; k < 10 && i < count; k++, i++) {
            sendOSC(`/eos/get/cue/${cueList}/index/${i}`);
        }
        if (i >= count) {
            clearInterval(batchInterval);
            console.log(`✅ All ${count} index requests sent (batched).`);
        }
    }, 50);
    
    console.log(`💡 Responses will appear as EOS sends them...`);
    
    // Set a completion timeout based on cue count
    // Give extra time for cue processing before cleanup
    const timeout = Math.max(5000, count * 100); // At least 5s, or 100ms per cue
    setTimeout(() => {
        checkBulkRefreshComplete();
    }, timeout);
}

// Check if all expected cues have been received
function checkBulkRefreshComplete() {
    if (!bulkRefreshInProgress) return;
    
    const received = bulkRefreshReceivedIndices.size;
    const expected = bulkRefreshExpectedCount;
    const listNum = bulkRefreshCueList;
    
    console.log(`📊 Received ${received}/${expected} cue responses`);
    
    // Remove cues from this list that weren't in the refresh
    // Keep user data (notes, colors, tags) but remove cues that no longer exist on EOS
    const cuesBeforeCleanup = cues.length;
    const cueListStr = String(listNum);
    
    cues = cues.filter(cue => {
        const cueList = String(cue.cue_list || '1');
        // Keep cues from other lists
        if (cueList !== cueListStr) return true;
        // Keep cues that were received in this refresh
        if (bulkRefreshReceivedCues.has(cue.cue_number)) return true;
        // Remove cues that weren't in the refresh
        console.log(`🗑️ Removing old cue ${cue.cue_number} from list ${cueList} (not in EOS)`);
        return false;
    });
    
    const removedCount = cuesBeforeCleanup - cues.length;
    if (removedCount > 0) {
        console.log(`🧹 Cleaned up ${removedCount} old cue(s) not found in EOS`);
        saveCues();
    }
    
    // Mark as complete
    bulkRefreshInProgress = false;
    bulkRefreshCueList = null;
    bulkRefreshExpectedCount = 0;
    bulkRefreshReceivedIndices.clear();
    bulkRefreshReceivedCues.clear();
    
    notifyFrontendCuesChanged();
    console.log(`✅ Cue refresh complete - ${received} cues loaded`);
    
    // Process next queued cue list if any
    if (bulkRefreshQueue.length > 0) {
        const nextList = bulkRefreshQueue.shift();
        console.log(`📋 Processing next queued cue list: ${nextList} (${bulkRefreshQueue.length} remaining)`);
        requestAllCues(nextList, false);
    }
}

// Called when we receive a cue index response
function handleCueIndexResponse(cueList, index) {
    if (!bulkRefreshInProgress || bulkRefreshCueList !== cueList) {
        console.log(`⚠️ Ignoring index response for list ${cueList} index ${index} - not part of current refresh`);
        return; // Not part of current bulk refresh
    }
    
    // Guard against stale responses from cancelled refreshes
    // Don't process index responses until we've received the count
    if (bulkRefreshExpectedCount === 0) {
        console.log(`⚠️ Ignoring stale index response ${index} - count not yet received`);
        return;
    }
    
    // Validate index is in expected range
    if (index < 0 || index >= bulkRefreshExpectedCount) {
        console.log(`⚠️ Ignoring out-of-range index response ${index} - expected 0-${bulkRefreshExpectedCount - 1}`);
        return;
    }
    
    bulkRefreshReceivedIndices.add(index);
    
    // Check if we've received all expected responses
    // Use setImmediate to ensure cue data is fully processed before cleanup
    if (bulkRefreshReceivedIndices.size >= bulkRefreshExpectedCount) {
        setImmediate(() => checkBulkRefreshComplete());
    }
}

// OSC Functions
let tcpPort = null;

function sendOSC(address, ...args) {
    if (!oscClient && !tcpPort) {
        console.error('⚠️ No OSC connection available');
        return;
    }
    
    if (settings.protocol === 'tcp' && tcpPort) {
        const message = { address: address };
        if (args.length > 0) {
            message.args = args.map(arg => {
                if (typeof arg === 'number') {
                    return { type: 'i', value: arg };
                }
                return { type: 's', value: String(arg) };
            });
        }
        tcpPort.send(message);
    } else if (oscClient) {
        sendOSC(address, ...args);
    }
}

function initializeOSC() {
    try {
        const protocol = settings.protocol || 'tcp';
        const port = settings.port || 3037;
        
        console.log('========================================');
        console.log(`🔌 Initializing OSC (${protocol.toUpperCase()}) connection...`);
        console.log(`   Target: ${settings.ip_address}:${port}`);
        console.log('========================================');
        
        // Close existing connections
        if (oscClient) {
            try { oscClient.kill(); } catch (e) {}
            oscClient = null;
        }
        if (tcpPort) {
            try { tcpPort.close(); } catch (e) {}
            tcpPort = null;
        }
        
        if (protocol === 'tcp') {
            // Use TCP with SLIP encoding (like Cue-View)
            tcpPort = new osc.TCPSocketPort({
                address: settings.ip_address,
                port: port,
                useSLIP: true
            });
            
            tcpPort.on('message', function (oscMsg) {
                console.log('========================================');
                console.log('📨 OSC MESSAGE RECEIVED (TCP)');
                console.log('Address:', oscMsg.address);
                console.log('Args:', oscMsg.args);
                console.log('========================================');
                
                // Convert to array format for parseEOSCueMessage
                const args = oscMsg.args ? oscMsg.args.map(a => a.value !== undefined ? a.value : a) : [];
                parseEOSCueMessage([oscMsg.address, ...args]);
            });
            
            tcpPort.on('ready', function () {
                console.log('✅ TCP connection established');
                
                // CueView command order:
                console.log('📋 Step 1: Requesting cuelist count...');
                sendOSC('/eos/get/cuelist/count');
                console.log('✅ Sent: /eos/get/cuelist/count');
                
                console.log('📡 Step 2: Requesting EOS version...');
                sendOSC('/eos/get/version');
                console.log('✅ Sent: /eos/get/version');
                
                console.log('📡 Step 3: Subscribing to EOS show data...');
                sendOSC('/eos/subscribe', 1);
                console.log('✅ Sent: /eos/subscribe with argument 1');
                
                console.log('🎛️ Step 4: Querying main playback fader config...');
                sendOSC('/eos/get/fader/0/config');
                console.log('✅ Sent: /eos/get/fader/0/config');
                
                console.log('✅ OSC TCP client initialized successfully');
            });
            
            tcpPort.on('error', function (err) {
                console.error('❌ TCP OSC error:', err.message);
            });
            
            tcpPort.on('close', function () {
                console.log('🔌 TCP connection closed');
            });
            
            tcpPort.open();
        } else {
            // Use UDP (original method)
            oscClient = new nodeOsc.Client(settings.ip_address, port);
            const oscServer = new nodeOsc.Server(8001, '0.0.0.0');
            
            oscServer.on('message', function (msg) {
                console.log('========================================');
                console.log('📨 OSC MESSAGE RECEIVED (UDP)');
                console.log('Raw message:', msg);
                console.log('========================================');
                parseEOSCueMessage(msg);
            });
            
            console.log('📋 Step 1: Requesting cuelist count...');
            sendOSC('/eos/get/cuelist/count');
            console.log('✅ Sent: /eos/get/cuelist/count');
            
            console.log('📡 Step 2: Requesting EOS version...');
            sendOSC('/eos/get/version');
            console.log('✅ Sent: /eos/get/version');
            
            console.log('📡 Step 3: Subscribing to EOS show data...');
            sendOSC('/eos/subscribe', 1);
            console.log('✅ Sent: /eos/subscribe with argument 1');
            
            console.log('🎛️ Step 4: Querying main playback fader config...');
            sendOSC('/eos/get/fader/0/config');
            console.log('✅ Sent: /eos/get/fader/0/config');
            
            console.log('✅ OSC UDP client initialized successfully');
        }
        
        return true;
    } catch (error) {
        console.error('OSC initialization error:', error);
        return false;
    }
}

let currentPollRequest = null;

function startActiveCuePolling() {
    if (activeCuePoller) clearInterval(activeCuePoller);
    activeCuePoller = setInterval(() => {
        if (!isConnected || bulkRefreshInProgress || activePollingInProgress) return;
        processNextPollRequest();
    }, 500);
}

function processNextPollRequest() {
    if (activePollingInProgress || !isConnected || bulkRefreshInProgress) return;
    
    if (activePollingQueue.length === 0) {
        knownCueLists.forEach(listNum => {
            activePollingQueue.push({ list: String(listNum), type: 'active' });
            activePollingQueue.push({ list: String(listNum), type: 'pending' });
        });
        if (activePollingQueue.length === 0) return;
    }
    
    const request = activePollingQueue.shift();
    currentPollRequest = request;
    activePollingInProgress = true;
    
    const oscPath = `/eos/get/cue/${request.list}/${request.type}`;
    sendOSC(oscPath);
    
    setTimeout(() => {
        if (activePollingInProgress && currentPollRequest === request) {
            console.log(`⏳ Poll timeout: ${request.type} for list ${request.list} (no response)`);
            activePollingInProgress = false;
            currentPollRequest = null;
        }
    }, 600);
}

function parseEOSCueMessage(msg) {
    try {
        const address = msg[0];
        const args = msg.slice(1);
        
        console.log('Parsing EOS message:', address, args);
        
        // Handle show name - auto-switch to matching show
        if (address.includes('/eos/out/show/name')) {
            const eosShowName = args[0];
            console.log('✅ EOS Show name:', eosShowName);
            connectedEOSShowName = eosShowName;
            
            // Auto-switch to this show if it's different from current
            if (eosShowName && eosShowName !== currentShowName) {
                console.log(`🔄 Auto-switching to show: ${eosShowName}`);
                switchShow(eosShowName);
                notifyFrontendCuesChanged();
            }
        }
        
        // Handle EOS version response
        if (address === '/eos/out/get/version') {
            console.log('✅ EOS Version:', args[0]);
        }
        
        // Handle cuelist count response
        if (address === '/eos/out/get/cuelist/count') {
            const cuelistCount = args[0];
            console.log(`✅ EOS has ${cuelistCount} cuelist(s)`);
            
            // Request detailed info for each cuelist
            for (let i = 0; i < cuelistCount; i++) {
                sendOSC(`/eos/get/cuelist/index/${i}`);
                console.log(`📡 Sent: /eos/get/cuelist/index/${i}`);
            }
        }
        
        // Handle cuelist index response (cuelist metadata, NOT cue data)
        // Format: /eos/out/get/cuelist/<cuelist#>/list/<index>/<count>
        if (address.match(/^\/eos\/out\/get\/cuelist\/-?\d+\/list\/\d+\/\d+$/)) {
            const pathParts = address.split('/');
            const cuelistNumber = parseInt(pathParts[5]);
            
            if (cuelistNumber < 0) {
                console.log(`⏭️ Skipping system cuelist ${cuelistNumber}`);
                return;
            }
            
            if (!knownCueLists.includes(cuelistNumber)) {
                knownCueLists.push(cuelistNumber);
                console.log(`📋 Added cuelist ${cuelistNumber} to knownCueLists: [${knownCueLists}]`);
                startActiveCuePolling();
            }
            
            console.log(`✅ Discovered cuelist ${cuelistNumber}`);
            console.log(`📋 Requesting cues from cuelist ${cuelistNumber}...`);
            
            requestAllCues(cuelistNumber);
            
            return;
        }
        
        // Handle cue notifications from subscription
        // Format: /eos/out/notify/cue/<list>/list/<index>/<count>
        // Args: [sequence_number, cue_number_string, ...]
        if (address.includes('/eos/out/notify/cue/')) {
            console.log(`🔔 NOTIFY: ${address}`);
            console.log(`   Args (${args.length}):`, args);
            
            // Extract list number and count from path
            const pathParts = address.split('/');
            const listIdx = pathParts.indexOf('cue') + 1;
            const listNum = parseInt(pathParts[listIdx]);
            
            // Check if cue count changed (indicates cue added/deleted)
            // Path format: /eos/out/notify/cue/<list>/list/<index>/<count>
            const countMatch = address.match(/\/list\/\d+\/(\d+)$/);
            if (countMatch) {
                const newCount = parseInt(countMatch[1]);
                const oldCount = lastKnownCueCount[listNum] || 0;
                
                if (newCount !== oldCount && oldCount > 0) {
                    console.log(`🔄 Cue count changed: ${oldCount} → ${newCount} in list ${listNum}`);
                    console.log(`📋 Triggering auto-refresh...`);
                    lastKnownCueCount[listNum] = newCount;
                    
                    // Trigger full refresh if not already in progress
                    if (!bulkRefreshInProgress) {
                        requestAllCues(listNum);
                    }
                    return;
                }
            }
            
            const seqNum = args[0]; // Notification sequence number
            const cueNumber = args[1]; // Cue number as string
            console.log(`✅ Cue notification: Cue ${cueNumber} (seq ${seqNum})`);
            
            // Request full data for this cue using the correct format
            sendOSC(`/eos/get/cue/${listNum}/${cueNumber}`);
            console.log(`📡 Requested details for cue ${cueNumber} in list ${listNum}`);
            
            // Notify frontend that cues have changed
            notifyFrontendCuesChanged();
        }
        
        // Handle active cue text - contains full cue info
        // Matches: /eos/out/active/cue/text, /eos/out/active/cue/<list>/text
        if (address.match(/^\/eos\/out\/active\/cue\/([\d]+\/)?text$/)) {
            const cueText = args[0] || '';
            const addrListMatch = address.match(/\/cue\/(\d+)\/text$/);
            const addrList = addrListMatch ? addrListMatch[1] : null;
            const pollList = (currentPollRequest && currentPollRequest.type === 'active') ? currentPollRequest.list : null;
            const contextList = addrList || pollList;
            console.log(`✅ Active cue text: "${cueText}" (addrList=${addrList}, pollList=${pollList})`);
            parseCueText(cueText, 'active', contextList);
            if (activePollingInProgress && currentPollRequest && currentPollRequest.type === 'active') {
                activePollingInProgress = false;
                currentPollRequest = null;
            }
            notifyFrontendCuesChanged();
        }
        
        // Handle pending cue text - contains next cue info
        // Matches: /eos/out/pending/cue/text, /eos/out/pending/cue/<list>/text
        if (address.match(/^\/eos\/out\/pending\/cue\/([\d]+\/)?text$/)) {
            const cueText = args[0] || '';
            const addrListMatch = address.match(/\/cue\/(\d+)\/text$/);
            const addrList = addrListMatch ? addrListMatch[1] : null;
            const pollList = (currentPollRequest && currentPollRequest.type === 'pending') ? currentPollRequest.list : null;
            const contextList = addrList || pollList;
            console.log(`✅ Pending cue text: "${cueText}" (addrList=${addrList}, pollList=${pollList})`);
            parseCueText(cueText, 'pending', contextList);
            if (activePollingInProgress && currentPollRequest && currentPollRequest.type === 'pending') {
                activePollingInProgress = false;
                currentPollRequest = null;
            }
            notifyFrontendCuesChanged();
        }
        
        // Handle per-list active/pending cue notifications (without /text suffix)
        // EOS sends: /eos/out/active/cue/<list>/<cue> when subscribed
        // Match: must have /eos/out/active/cue/ followed by list/cue numbers, not /text
        {
            const activeListMatch = address.match(/^\/eos\/out\/active\/cue\/(\d+)\/(\d+(?:\.\d+)?)(\/\w+)?$/);
            if (activeListMatch && !address.endsWith('/text')) {
                const list = activeListMatch[1];
                const cueNum = activeListMatch[2];
                console.log(`✅ Per-list active cue: List ${list}, Cue ${cueNum} (addr: ${address})`);
                setActiveCueByListAndNumber(list, cueNum, 'active');
                notifyFrontendCuesChanged();
            }
        }
        
        {
            const pendingListMatch = address.match(/^\/eos\/out\/pending\/cue\/(\d+)\/(\d+(?:\.\d+)?)(\/\w+)?$/);
            if (pendingListMatch && !address.endsWith('/text')) {
                const list = pendingListMatch[1];
                const cueNum = pendingListMatch[2];
                console.log(`✅ Per-list pending cue: List ${list}, Cue ${cueNum} (addr: ${address})`);
                setActiveCueByListAndNumber(list, cueNum, 'pending');
                notifyFrontendCuesChanged();
            }
        }
        
        // Log any unrecognized active/pending messages for diagnostics
        if ((address.startsWith('/eos/out/active/') || address.startsWith('/eos/out/pending/')) && 
            !address.match(/\/cue\/([\d]+\/)?text$/) &&
            !address.match(/\/cue\/\d+\/\d+/)) {
            console.log(`📡 Unrecognized active/pending OSC: ${address}`, args);
        }
        
        // Handle fader config response - auto-detect main playback list
        // Format: /eos/out/get/fader/0/config = <index>, <type>, <id>, <label>
        // Type 1 = Cuelist, ID = cuelist number
        const faderConfigMatch = address.match(/^\/eos\/out\/get\/fader\/0\/config$/);
        if (faderConfigMatch || address.includes('/eos/out/fader/0/config')) {
            console.log(`🎛️ Fader 0 config response:`, args);
            if (args.length >= 3) {
                const faderType = args[1];
                const faderTargetId = args[2];
                const faderLabel = args[3] || '';
                if (Number(faderType) === 1) {
                    const newMainList = String(faderTargetId);
                    if (newMainList !== mainPlaybackList) {
                        console.log(`🎛️ Main Playback Fader has cuelist ${newMainList} ("${faderLabel}") - updating mainPlaybackList`);
                        mainPlaybackList = newMainList;
                        globalSettings.mainPlaybackList = mainPlaybackList;
                        saveGlobalSettings();
                        notifyFrontendCuesChanged();
                    } else {
                        console.log(`🎛️ Main Playback Fader confirmed: cuelist ${newMainList} ("${faderLabel}")`);
                    }
                }
            }
        }
        
        // Handle OSC Get responses
        // Format: /eos/out/get/cue/<list>/<cue>/<part>/list/<index>/<count>
        // OR: /eos/out/get/cuelist/<list>/cue/<cue>/<part>/list/<index>/<count> (from wildcard)
        if (address.includes('/eos/out/get/cue/') || address.includes('/eos/out/get/cuelist/')) {
            // IMPORTANT: Ignore sub-responses for fx, actions, links, etc.
            // We only want the main cue data response
            if (address.includes('/fx/') || address.includes('/actions/') || 
                address.includes('/links/') || address.includes('/curves/')) {
                console.log(`⏭️ Skipping sub-response: ${address}`);
                return;
            }
            
            console.log(`📥 GET RESPONSE: ${address}`);
            console.log(`   Args (${args.length}):`, args);
            
            const pathParts = address.split('/');
            
            // Determine if this is a wildcard response or legacy response
            const isWildcard = address.includes('/eos/out/get/cuelist/');
            let listNum, cueNumber, partNumber;
            
            if (isWildcard) {
                // Wildcard format: /eos/out/get/cuelist/<list>/cue/<cue>/<part>/list/<index>/<count>
                const cuelistIdx = pathParts.indexOf('cuelist');
                listNum = pathParts[cuelistIdx + 1];
                const cueIdx = pathParts.indexOf('cue', cuelistIdx);
                cueNumber = pathParts[cueIdx + 1];
                partNumber = pathParts[cueIdx + 2];
            } else {
                // Legacy format: /eos/out/get/cue/<list>/<cue>/<part>/list/<index>/<count>
                const cueIdx = pathParts.indexOf('cue');
                listNum = pathParts[cueIdx + 1];
                cueNumber = pathParts[cueIdx + 2];
                partNumber = pathParts[cueIdx + 3];
            }
            
            if (pathParts.includes('count')) {
                // Response to count request (from /eos/get/cue/<list>/count)
                const count = args[0];
                console.log(`✅ Cuelist ${listNum} has ${count} cues`);
                
                // Handle the count response for bulk refresh
                handleCueCountResponse(parseInt(listNum), count);
            } else {
                // Response to cue data request
                
                // Extract count and index from path if present (always in list responses)
                const listIdx = pathParts.indexOf('list');
                const pathIndex = listIdx > 0 ? parseInt(pathParts[listIdx + 1]) : null;
                const pathCount = listIdx > 0 ? parseInt(pathParts[listIdx + 2]) : null;
                
                // Arguments contain the actual data
                const listIndex = args[0];
                const uid = args[1];
                
                console.log(`✅ GET Response - List ${listNum}, Cue ${cueNumber}, Part ${partNumber}`);
                console.log(`   Index: ${listIndex}, UID: ${uid?.substring(0, 8)}...`);
                console.log(`   Path count: ${pathCount}, Path index: ${pathIndex}`);
                console.log(`   All args:`, args);
                
                // Extract count from path - wildcard responses contain count in every message
                // For wildcard requests, set the count directly without requesting indices
                // (EOS sends all cues automatically, we just track receipt)
                if (bulkRefreshInProgress && pathCount !== null && bulkRefreshExpectedCount === 0) {
                    console.log(`✅ Extracted count from ${isWildcard ? 'wildcard' : 'legacy'} response: ${pathCount} cues`);
                    bulkRefreshExpectedCount = pathCount;
                    bulkRefreshCountReceived = true;
                    console.log(`📊 Expecting ${pathCount} cue responses from ${isWildcard ? 'wildcard' : 'index'} request`);
                    
                    // Set a completion timeout
                    const timeout = Math.max(5000, pathCount * 50);
                    const completionTimeout = setTimeout(() => {
                        checkBulkRefreshComplete();
                    }, timeout);
                    bulkRefreshTimeouts.push(completionTimeout);
                }
                
                // Track this response for bulk refresh completion
                if (typeof listIndex === 'number') {
                    handleCueIndexResponse(parseInt(listNum), listIndex);
                }
                
                // EOS sends structured data in args (matching Cue-View's cue.js):
                // args[0] = index (number)
                // args[1] = uid (string)
                // args[2] = label (string)
                // args[3] = up time duration in centiseconds
                // args[4] = up time delay
                // args[5] = down time duration in centiseconds
                // args[6] = down time delay
                // args[7] = focus time duration
                // args[8] = focus time delay
                // args[9] = color time duration
                // args[10] = color time delay
                // args[11] = beam time duration
                // args[12] = beam time delay
                // args[16] = mark (string)
                // args[17] = block (string)
                // args[18] = assert (string)
                // args[20] = follow time in centiseconds (-1 if none)
                // args[21] = hang time in centiseconds (-1 if none)
                // args[26] = part count (number)
                // args[28] = scene (string)
                // args[29] = scene end (bool)
                
                const label = (typeof args[2] === 'string') ? args[2] : '';
                const upTimeMilliseconds = (typeof args[3] === 'number' && args[3] >= 0) ? args[3] : null;
                const downTimeMilliseconds = (typeof args[5] === 'number' && args[5] >= 0) ? args[5] : null;
                
                // Extract additional Cue-View fields
                const focusTime = (typeof args[7] === 'number' && args[7] >= 0) ? Math.round(args[7] / 10) / 100 : null;
                const colorTime = (typeof args[9] === 'number' && args[9] >= 0) ? Math.round(args[9] / 10) / 100 : null;
                const beamTime = (typeof args[11] === 'number' && args[11] >= 0) ? Math.round(args[11] / 10) / 100 : null;
                
                // Extract delay values
                const upDelay = (typeof args[4] === 'number' && args[4] > 0) ? Math.round(args[4] / 10) / 100 : null;
                const downDelay = (typeof args[6] === 'number' && args[6] > 0) ? Math.round(args[6] / 10) / 100 : null;
                const focusDelay = (typeof args[8] === 'number' && args[8] > 0) ? Math.round(args[8] / 10) / 100 : null;
                const colorDelay = (typeof args[10] === 'number' && args[10] > 0) ? Math.round(args[10] / 10) / 100 : null;
                const beamDelay = (typeof args[12] === 'number' && args[12] > 0) ? Math.round(args[12] / 10) / 100 : null;
                
                const mark = (typeof args[16] === 'string' && args[16]) ? args[16] : '';
                const block = (typeof args[17] === 'string' && args[17]) ? args[17] : '';
                const assert = (typeof args[18] === 'string' && args[18]) ? args[18] : '';
                const followMs = (typeof args[20] === 'number') ? args[20] : -1;
                const hangMs = (typeof args[21] === 'number') ? args[21] : -1;
                const partCount = (typeof args[26] === 'number') ? args[26] : 0;
                const scene = (typeof args[28] === 'string') ? args[28] : '';
                const sceneEnd = args[29] === true || args[29] === 1;
                
                // Convert times
                const upTime = upTimeMilliseconds !== null ? Math.round(upTimeMilliseconds / 10) / 100 : null;
                const downTime = downTimeMilliseconds !== null ? Math.round(downTimeMilliseconds / 10) / 100 : null;
                const followTime = followMs >= 0 ? Math.round(followMs / 10) / 100 : null;
                const hangTime = hangMs >= 0 ? Math.round(hangMs / 10) / 100 : null;
                
                // Calculate overall duration (max of all time types, like Cue-View)
                const duration = Math.max(
                    upTimeMilliseconds || 0, 
                    downTimeMilliseconds || 0, 
                    args[7] || 0, 
                    args[9] || 0, 
                    args[11] || 0
                );
                const durationSec = duration > 0 ? Math.round(duration / 10) / 100 : null;
                
                console.log(`   📊 Extracted: Label="${label}", Up=${upTime}s, Down=${downTime}s`);
                console.log(`   📊 Flags: M=${mark}, B=${block}, A=${assert}, F=${followTime}, H=${hangTime}`);
                console.log(`   📊 Scene: "${scene}", SceneEnd: ${sceneEnd}, Parts: ${partCount}`);
                
                // Format fade time like CueView: show both up/down if different, or just one if same
                let fadeTimeDisplay = '';
                if (upTime !== null && downTime !== null) {
                    if (upTime === downTime) {
                        fadeTimeDisplay = `${upTime}`;
                    } else {
                        fadeTimeDisplay = `↑${upTime} ↓${downTime}`;
                    }
                } else if (upTime !== null) {
                    fadeTimeDisplay = `${upTime}`;
                } else if (downTime !== null) {
                    fadeTimeDisplay = `${downTime}`;
                }
                
                // Format follow/hang display like CueView
                let followHangDisplay = '';
                if (followTime !== null) {
                    followHangDisplay += `F${followTime}`;
                }
                if (hangTime !== null) {
                    if (followHangDisplay) followHangDisplay += ' ';
                    followHangDisplay += `H${hangTime}`;
                }
                
                if (cueNumber && cueNumber !== '0' && parseInt(listNum) >= 0) {
                    console.log(`💾 Saving cue ${cueNumber}: "${label}" - Fade: ${fadeTimeDisplay || 'N/A'}`);
                    updateOrCreateCue(cueNumber, { 
                        label: label,
                        uid: uid,
                        cue_list: listNum,
                        fade_time: fadeTimeDisplay,
                        up_time: upTime,
                        down_time: downTime,
                        focus_time: focusTime,
                        color_time: colorTime,
                        beam_time: beamTime,
                        up_delay: upDelay,
                        down_delay: downDelay,
                        focus_delay: focusDelay,
                        color_delay: colorDelay,
                        beam_delay: beamDelay,
                        mark: mark,
                        block: block,
                        assert: assert,
                        follow_time: followTime,
                        hang_time: hangTime,
                        follow_hang: followHangDisplay,
                        part_count: partCount,
                        scene: scene,
                        scene_end: sceneEnd,
                        duration: durationSec,
                        part_number: parseInt(partNumber) || 0
                    });
                    
                    if (currentPollRequest && activePollingInProgress && String(listNum) === currentPollRequest.list) {
                        const pollType = currentPollRequest.type;
                        console.log(`🎯 Polled ${pollType} cue response: List ${listNum}, Cue ${cueNumber}`);
                        setActiveCueByListAndNumber(String(listNum), cueNumber, pollType);
                        notifyFrontendCuesChanged();
                        activePollingInProgress = false;
                        currentPollRequest = null;
                    }
                }
            }
        }
        
        // Handle custom OSC send string format: /cue/<list>/<number>/<label>
        if (address.startsWith('/cue/') && !address.includes('/eos/')) {
            const pathParts = address.split('/').filter(p => p);
            if (pathParts.length >= 3) {
                const listNum = pathParts[1];
                const cueNum = pathParts[2];
                const label = args[0] || pathParts[3] || '';
                console.log(`✅ Custom cue format - List ${listNum}, Cue ${cueNum}:`, label);
                updateOrCreateCue(cueNum, { label: label, cue_list: listNum });
            }
        }
        
    } catch (error) {
        console.error('Error parsing OSC message:', error);
    }
}

// Parse EOS cue text format
// Set active/pending cue by list number and cue number (for per-list OSC notifications)
function setActiveCueByListAndNumber(list, cueNum, type) {
    try {
        console.log(`🔍 Setting ${type} cue: List ${list}, Cue ${cueNum}`);
        
        // Clear last_seen only from cues in the SAME list
        cues.forEach(c => {
            if (c.last_seen === type && String(c.cue_list || '1') === String(list)) {
                c.last_seen = null;
            }
        });
        
        // Find and update this cue
        const targetCue = cues.find(c => 
            String(c.cue_number) === String(cueNum) && 
            String(c.cue_list || '1') === String(list)
        );
        
        if (targetCue) {
            targetCue.last_seen = type;
            console.log(`📝 Set ${type} cue: List ${list}, Cue ${cueNum}, Label: "${targetCue.label || ''}"`);
        } else {
            console.log(`⚠️ Cue ${cueNum} in list ${list} not found in local data`);
            updateOrCreateCue(cueNum, {
                cue_list: list,
                last_seen: type
            });
        }
        
        // Record timing only for main playback list active cues
        if (type === 'active' && showTimings.isRecording && String(list) === mainPlaybackList) {
            const now = Date.now();
            if (!showTimings.showStartTime) {
                showTimings.showStartTime = now;
            }
            const timestamp = (now - showTimings.showStartTime) / 1000;
            let timeFromPrevious = 0;
            if (showTimings.lastCueTime !== null && showTimings.lastCueTime > 0) {
                timeFromPrevious = timestamp - showTimings.lastCueTime;
            }
            if (cueNum !== showTimings.lastCueNumber) {
                const existingIdx = showTimings.cueTimings.findIndex(t => String(t.cueNumber) === String(cueNum));
                if (existingIdx !== -1) {
                    showTimings.cueTimings[existingIdx].timestamp = timestamp;
                    showTimings.cueTimings[existingIdx].timeFromPrevious = timeFromPrevious;
                    console.log(`⏱️ Updated existing timing for cue ${cueNum}`);
                } else {
                    showTimings.cueTimings.push({
                        cueNumber: cueNum,
                        cueList: list,
                        label: targetCue?.label || '',
                        timestamp: timestamp,
                        timeFromPrevious: timeFromPrevious
                    });
                }
                showTimings.lastCueTime = timestamp;
                showTimings.lastCueNumber = cueNum;
                saveShowTimings();
            }
        }
        
        if (type === 'active' && String(list) === mainPlaybackList && !showTimings.isRecording && showTimings.cueTimings.length > 0) {
            const timingIndex = showTimings.cueTimings.findIndex(t => String(t.cueNumber) === String(cueNum));
            if (timingIndex !== -1) {
                currentShowElapsed = showTimings.cueTimings[timingIndex].timestamp;
                lastCueFireTime = Date.now();
            }
        }
        
        saveCues();
    } catch (error) {
        console.error('Error setting active cue by list/number:', error);
    }
}

// Active format: "1/2 cue 2 label 1.8 3%" = "list/cue <label_text> fade_time completion%"
// Pending format: "1/2 cue 2 label 1.9" = "list/cue <label_text> fade_time" (no percentage)
function parseCueText(cueText, type, contextList) {
    try {
        // Optional: Loggt jede eingehende Nachricht zur Kontrolle
        // console.log(`🔍 Parsing ${type} cue text: "${cueText}" (contextList=${contextList || 'unknown'})`);
        
        const text = cueText.trim();
        
        // Handle "empty" or "reset" cases sent by EOS
        if (!text || text === '0.0 100%' || text.startsWith('0.0 ') || text.startsWith('0/0') || text === '') {
            if (contextList) {
                // Wenn wir die Liste kennen (z.B. Liste 2), löschen wir den Status nur dort
                cues.forEach(cue => {
                    if (cue.last_seen === type && String(cue.cue_list || '1') === String(contextList)) {
                        cue.last_seen = null;
                    }
                });
            } else {
                // Fallback: Alles löschen, wenn wir nicht wissen, woher es kommt
                cues.forEach(cue => {
                    if (cue.last_seen === type) {
                        cue.last_seen = null;
                    }
                });
            }
            saveCues();
            return;
        }
        
        // --- FIX START: Robusteres Parsing mit Fallback für Nebenlisten ---
        let list, cue, remainder;

        // Versuch 1: Standard Format "Liste/Cue" (z.B. "2/5 Label")
        const listCueMatch = text.match(/^(\d+)\/(\d+(?:\.\d+)?)(?:\s+(.*))?$/);
        
        if (listCueMatch) {
            list = listCueMatch[1];
            cue = listCueMatch[2];
            remainder = listCueMatch[3] ? listCueMatch[3].trim() : '';
        } 
        // Versuch 2: Fallback - Nur "Cue" (z.B. "5"), aber wir kennen die Liste aus dem Kontext (contextList)
        // Das passiert oft bei aktiven Cues in Liste 2, 3, etc.
        else if (contextList) {
            console.log(`⚠️ Regex Fallback: Nutze contextList ${contextList} für "${text}"`);
            const cueOnlyMatch = text.match(/^(\d+(?:\.\d+)?)(?:\s+(.*))?$/);
            
            if (cueOnlyMatch) {
                list = contextList;
                cue = cueOnlyMatch[1];
                remainder = cueOnlyMatch[2] ? cueOnlyMatch[2].trim() : '';
            } else {
                return; // Wirklich kein gültiges Format
            }
        } else {
            // Wenn weder Format stimmt noch Kontext da ist -> Abbrechen
            console.warn(`⚠️ REGEX MISMATCH: Could not parse cue text '${text}'`);
            return;
        }
        // --- FIX ENDE ---
        
        // Step 2: Extrahiere Fade-Zeiten und Fertigstellung (%)
        let fadeTime = '';
        let completion = '';
        let label = '';
        
        const fadeTimePattern = '[\\d.:]+';
        
        // Pattern 1: Nur Zahlen "fade% completion%" (KEIN Label)
        const noLabelActiveMatch = remainder.match(new RegExp(`^(${fadeTimePattern})\\s+(\\d+)%\\s*$`));
        if (noLabelActiveMatch) {
            fadeTime = noLabelActiveMatch[1];
            completion = noLabelActiveMatch[2] + '%';
            label = '';
        } else {
            // Pattern 2: Label gefolgt von Fade und Prozent
            const labelActiveMatch = remainder.match(new RegExp(`^(.+?)\\s+(${fadeTimePattern})\\s+(\\d+)%\\s*$`));
            if (labelActiveMatch) {
                label = labelActiveMatch[1].trim();
                fadeTime = labelActiveMatch[2];
                completion = labelActiveMatch[3] + '%';
            } else {
                // Pattern 3: Nur eine Nummer "fade" (KEIN Label) - Pending Cue
                const noLabelPendingMatch = remainder.match(new RegExp(`^(${fadeTimePattern})\\s*$`));
                if (noLabelPendingMatch) {
                    fadeTime = noLabelPendingMatch[1];
                    label = '';
                } else {
                    // Pattern 4: Label gefolgt von Fade Zeit
                    const labelPendingMatch = remainder.match(new RegExp(`^(.+?)\\s+(${fadeTimePattern})\\s*$`));
                    if (labelPendingMatch) {
                        label = labelPendingMatch[1].trim();
                        fadeTime = labelPendingMatch[2];
                    } else {
                        // Kein Fade, der ganze Rest ist das Label
                        label = remainder;
                    }
                }
            }
        }
        
        // Debugging Ausgabe
        console.log(`📝 Parsed ${type} cue: List ${list}, Cue ${cue}, Label: "${label}"`);
        
        // --- ZEITAUFNAHME NUR FÜR HAUPTLISTE ---
        // Verhindert Ghost-Timings in Liste 2
        if (type === 'active' && showTimings.isRecording && String(list) === mainPlaybackList) {
            const now = Date.now();
            if (!showTimings.showStartTime) showTimings.showStartTime = now;
            
            const timestamp = (now - showTimings.showStartTime) / 1000;
            let timeFromPrevious = 0;
            if (showTimings.lastCueTime !== null && showTimings.lastCueTime > 0) {
                timeFromPrevious = timestamp - showTimings.lastCueTime;
            }
            
            if (cue !== showTimings.lastCueNumber) {
                const existingIdx = showTimings.cueTimings.findIndex(t => String(t.cueNumber) === String(cue));
                if (existingIdx !== -1) {
                    showTimings.cueTimings[existingIdx].timestamp = timestamp;
                    showTimings.cueTimings[existingIdx].timeFromPrevious = timeFromPrevious;
                } else {
                    showTimings.cueTimings.push({
                        cueNumber: cue,
                        cueList: list,
                        label: label,
                        timestamp: timestamp,
                        timeFromPrevious: timeFromPrevious
                    });
                }
                showTimings.lastCueTime = timestamp;
                showTimings.lastCueNumber = cue;
                saveShowTimings();
            }
        }
        
        // Update Elapsed Time (nur Hauptliste)
        if (type === 'active' && String(list) === mainPlaybackList && !showTimings.isRecording && showTimings.cueTimings.length > 0) {
            const timingIndex = showTimings.cueTimings.findIndex(t => t.cueNumber === cue);
            if (timingIndex !== -1) {
                currentShowElapsed = showTimings.cueTimings[timingIndex].timestamp;
                lastCueFireTime = Date.now();
            }
        }
        
        // Aufräumen: active/pending Status nur in der GLEICHEN Liste löschen
        cues.forEach(c => {
            if (c.last_seen === type && String(c.cue_list || '1') === String(list)) {
                c.last_seen = null;
            }
        });
        
        const updates = {
            cue_list: list,
            label: label,
            last_seen: type,
            completion: completion
        };
        
        if (fadeTime && (completion === '0%' || type === 'pending')) {
            updates.fade_time = fadeTime;
        }
        
        updateOrCreateCue(cue, updates);
    } catch (error) {
        console.error('Error parsing cue text:', error);
    }
}

function updateOrCreateCue(cueNumber, updates) {
    // Use list+cue+part as unique key to avoid collisions
    const cueList = updates.cue_list || '1';
    const partNumber = updates.part_number || 0;
    
    // For parts > 0, include part in the key; part 0 is the main cue
    const cueKey = partNumber > 0 
        ? `${cueList}/${cueNumber}/${partNumber}`
        : `${cueList}/${cueNumber}`;
    
    // Track this cue as received during bulk refresh (track base cue number)
    if (bulkRefreshInProgress && String(bulkRefreshCueList) === String(cueList)) {
        bulkRefreshReceivedCues.add(cueNumber);
    }
    
    let existingCue = cues.find(c => {
        const existingList = c.cue_list || '1';
        const existingPart = c.part_number || 0;
        const existingKey = existingPart > 0
            ? `${existingList}/${c.cue_number}/${existingPart}`
            : `${existingList}/${c.cue_number}`;
        return existingKey === cueKey;
    });
    
    if (existingCue) {
        // Only update if we have new data (don't overwrite with empty strings)
        // Exception: always update last_seen even if null (to clear it)
        // Exception: always update EOS fields (mark/block/assert/scene/parts) from console even if empty
        const alwaysUpdateFields = ['last_seen', 'mark', 'block', 'assert', 'scene', 'part_count', 'part_number', 'follow_hang', 'follow_time', 'hang_time', 'up_time', 'down_time', 'focus_time', 'color_time', 'beam_time', 'up_delay', 'down_delay', 'focus_delay', 'color_delay', 'beam_delay', 'duration'];
        Object.keys(updates).forEach(key => {
            if (alwaysUpdateFields.includes(key)) {
                existingCue[key] = updates[key];
            } else if (updates[key] !== '' && updates[key] !== undefined && updates[key] !== null) {
                existingCue[key] = updates[key];
            }
        });
        console.log(`✏️ Updated cue ${cueKey}:`, updates);
    } else {
        const newCue = {
            cue_number: cueNumber,
            cue_list: cueList,
            label: '',
            fade_time: '',
            notes: '',
            color: '#ffffff',
            image_path: null,
            tags: [],
            mark: '',
            block: '',
            assert: '',
            follow_time: null,
            hang_time: null,
            follow_hang: '',
            scene: '',
            part_count: 0,
            part_number: 0,
            focus_time: null,
            color_time: null,
            beam_time: null,
            duration: null,
            ...updates
        };
        cues.push(newCue);
        console.log(`➕ Created new cue ${cueKey}`);
        
        cues.sort((a, b) => {
            const listA = parseInt(a.cue_list || '1');
            const listB = parseInt(b.cue_list || '1');
            if (listA !== listB) return listA - listB;
            
            const numA = parseFloat(a.cue_number);
            const numB = parseFloat(b.cue_number);
            if (numA !== numB) return numA - numB;
            
            const partA = a.part_number || 0;
            const partB = b.part_number || 0;
            return partA - partB;
        });
    }
    saveCues();
}

function requestEOSCueData() {
    if (!oscClient) return;
    
    try {
        console.log('========================================');
        console.log('🎭 REQUESTING CUE DATA FROM EOS');
        console.log('========================================');
        
        // Request the currently active and pending cues
        sendOSC('/eos/get/cue/1/0');
        console.log('✅ Requested current cue (1/0)');
        
        // Request a range of cues by number (EOS may not respond to all)
        // Try both /eos/get/cue/<list>/<cue> format
        for (let i = 1; i <= 20; i++) {
            sendOSC(`/eos/get/cue/1/${i}`);
            // Also try with decimals for common point cues
            if (i <= 10) {
                sendOSC(`/eos/get/cue/1/${i}.5`);
            }
        }
        console.log('✅ Requested cues 1-20 from list 1');
        
        console.log('');
        console.log('⏳ Waiting for EOS to respond...');
        console.log('   EOS may only respond for cues that exist');
        console.log('   Fire cues to see active/pending updates immediately');
        console.log('========================================');
    } catch (error) {
        console.error('Error requesting cue data:', error);
    }
}

// API Routes

// Show management endpoints
app.get('/api/shows', (req, res) => {
    res.json({
        shows: listShows(),
        currentShow: currentShowName,
        connectedEOSShow: connectedEOSShowName,
        isConnected: isConnected
    });
});

app.post('/api/shows/switch', (req, res) => {
    try {
        const { showName } = req.body;
        if (!showName) {
            return res.status(400).json({ error: 'Show name is required' });
        }
        switchShow(showName);
        res.json({ 
            success: true, 
            currentShow: currentShowName,
            message: `Switched to show: ${showName}`,
            cueCount: cues.length
        });
    } catch (error) {
        console.error('Error switching show:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/shows/create', (req, res) => {
    try {
        const { showName } = req.body;
        if (!showName || !showName.trim()) {
            return res.status(400).json({ error: 'Show name is required' });
        }
        const trimmedName = showName.trim();
        if (createShow(trimmedName)) {
            res.json({ 
                success: true, 
                message: `Created show: ${trimmedName}`,
                shows: listShows()
            });
        } else {
            res.json({ 
                success: false, 
                message: `Show already exists: ${trimmedName}`,
                shows: listShows()
            });
        }
    } catch (error) {
        console.error('Error creating show:', error);
        res.status(500).json({ error: error.message });
    }
});

// Load show from currently connected EOS console
app.post('/api/shows/load-from-eos', (req, res) => {
    try {
        if (!isConnected || !connectedEOSShowName) {
            return res.status(400).json({ 
                success: false, 
                error: 'Not connected to EOS or no show detected' 
            });
        }
        
        // Create or switch to the show with EOS name
        const showName = connectedEOSShowName;
        if (!showExists(showName)) {
            createShow(showName);
        }
        switchShow(showName);
        
        res.json({ 
            success: true, 
            showName: showName,
            message: `Switched to show: ${showName}`
        });
    } catch (error) {
        console.error('Error loading show from EOS:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/shows/:showName', (req, res) => {
    try {
        const { showName } = req.params;
        if (showName === 'Default') {
            return res.status(400).json({ error: 'Cannot delete Default show' });
        }
        if (showName === currentShowName) {
            switchShow('Default');
        }
        if (deleteShow(showName)) {
            res.json({ 
                success: true, 
                message: `Deleted show: ${showName}`,
                shows: listShows(),
                currentShow: currentShowName
            });
        } else {
            res.status(404).json({ error: 'Show not found' });
        }
    } catch (error) {
        console.error('Error deleting show:', error);
        res.status(500).json({ error: error.message });
    }
});

// Settings endpoints
app.get('/api/settings', (req, res) => {
    res.json({
        ipAddress: settings.ip_address,
        port: settings.port,
        oscVersion: settings.osc_version,
        protocol: settings.protocol || 'tcp',
        mainPlaybackList: mainPlaybackList
    });
});

app.post('/api/settings', (req, res) => {
    try {
        // Map frontend camelCase to backend snake_case
        if (req.body.ipAddress !== undefined) {
            settings.ip_address = req.body.ipAddress;
        }
        if (req.body.port !== undefined) {
            settings.port = req.body.port;
        }
        if (req.body.oscVersion !== undefined) {
            settings.osc_version = req.body.oscVersion;
        }
        if (req.body.protocol !== undefined) {
            settings.protocol = req.body.protocol;
        }
        if (req.body.mainPlaybackList !== undefined) {
            mainPlaybackList = String(req.body.mainPlaybackList);
            console.log(`📋 Main playback list set to: ${mainPlaybackList}`);
        }
        
        console.log('💾 Saving settings:', settings);
        saveSettings();
        res.json({ success: true, message: 'Settings saved successfully' });
    } catch (error) {
        console.error('Error saving settings:', error);
        res.status(500).json({ error: error.message });
    }
});

// Connection endpoints
app.post('/api/connect', (req, res) => {
    try {
        if (initializeOSC()) {
            isConnected = true;
            // initializeOSC() already calls requestAllCues(1) for bulk retrieval
            // No need to call requestEOSCueData() here - that was the old one-by-one method
            res.json({ success: true, message: 'Connected to EOS console' });
        } else {
            res.status(500).json({ success: false, message: 'Failed to initialize OSC' });
        }
    } catch (error) {
        console.error('Connection error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/disconnect', (req, res) => {
    try {
        if (activeCuePoller) {
            clearInterval(activeCuePoller);
            activeCuePoller = null;
        }
        activePollingQueue = [];
        activePollingInProgress = false;
        currentPollRequest = null;
        knownCueLists = [];
        if (oscServer) {
            oscServer.close();
            oscServer = null;
        }
        if (tcpPort) {
            try { tcpPort.close(); } catch (e) {}
            tcpPort = null;
        }
        oscClient = null;
        isConnected = false;
        res.json({ success: true, message: 'Disconnected from EOS console' });
    } catch (error) {
        console.error('Disconnection error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/debug', (req, res) => {
    const activeCues = cues.filter(c => c.last_seen === 'active').map(c => ({
        cue_number: c.cue_number,
        cue_list: c.cue_list,
        label: c.label
    }));
    const pendingCues = cues.filter(c => c.last_seen === 'pending').map(c => ({
        cue_number: c.cue_number,
        cue_list: c.cue_list,
        label: c.label
    }));
    const sampleCueNumbers = cues.slice(0, 10).map(c => ({
        cue_number: c.cue_number,
        type: typeof c.cue_number,
        cue_list: c.cue_list,
        list_type: typeof c.cue_list
    }));
    const sampleTimingKeys = showTimings.cueTimings.slice(0, 10).map(t => ({
        cueNumber: t.cueNumber,
        type: typeof t.cueNumber,
        timeFromPrevious: t.timeFromPrevious
    }));
    const keyComparison = {
        cueDataKeys: cues.slice(0, 5).map(c => String(c.cue_number)),
        timingKeys: showTimings.cueTimings.slice(0, 5).map(t => String(t.cueNumber)),
        matchCount: cues.filter(c => showTimings.cueTimings.some(t => String(t.cueNumber) === String(c.cue_number))).length
    };
    res.json({
        mainPlaybackList,
        knownCueLists,
        totalCues: cues.length,
        activeCues,
        pendingCues,
        timingsCount: showTimings.cueTimings?.length || 0,
        isRecording: showTimings.isRecording,
        isConnected,
        connectedEOSShowName,
        currentShowName,
        sampleCueNumbers,
        sampleTimingKeys,
        keyComparison
    });
});

// Cue endpoints
app.get('/api/cues', (req, res) => {
    res.json({ cues: cues, mainPlaybackList: mainPlaybackList });
});

// Check if cues have changed (for polling)
app.get('/api/cues/changed', (req, res) => {
    res.json({ changed: cuesChanged });
    cuesChanged = false; // Reset flag after check
});

// Manual refresh - pull all cues from EOS (discovers all cue lists)
app.post('/api/cues/refresh', (req, res) => {
    try {
        if (!oscClient && !tcpPort) {
            return res.status(400).json({ success: false, message: 'Not connected to EOS' });
        }
        // Request cuelist count first to discover all lists
        console.log('📋 Refresh: Requesting cuelist count to discover all lists...');
        sendOSC('/eos/get/cuelist/count');
        
        // Fallback: if cuelist count doesn't respond within 3 seconds, refresh list 1
        setTimeout(() => {
            if (bulkRefreshQueue.length === 0 && !isBulkRefreshing) {
                console.log('📋 Refresh: Cuelist count timed out, falling back to list 1');
                requestAllCues(1);
            }
        }, 3000);
        
        res.json({ success: true, message: 'Discovering and refreshing all cue lists...' });
    } catch (error) {
        console.error('Error refreshing cues:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/cues/:cueNumber/notes', (req, res) => {
    try {
        const { cueNumber } = req.params;
        const { notes } = req.body;
        
        updateOrCreateCue(cueNumber, { notes: notes });
        res.json({ success: true, message: 'Notes saved successfully' });
    } catch (error) {
        console.error('Error saving notes:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/cues/:cueNumber/color', (req, res) => {
    try {
        const { cueNumber } = req.params;
        const { color } = req.body;
        
        updateOrCreateCue(cueNumber, { color: color });
        res.json({ success: true, message: 'Color saved successfully' });
    } catch (error) {
        console.error('Error saving color:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/cues/:cueNumber/page', (req, res) => {
    try {
        const { cueNumber } = req.params;
        const { page, part_number } = req.body;
        
        // Handle multi-part cues
        const storageKey = (part_number && part_number > 0) ? `${cueNumber}/${part_number}` : cueNumber;
        updateOrCreateCue(storageKey, { page: page });
        res.json({ success: true, message: 'Page saved successfully' });
    } catch (error) {
        console.error('Error saving page:', error);
        res.status(500).json({ error: error.message });
    }
});

// Tag endpoints
app.post('/api/cues/:cueNumber/tags', (req, res) => {
    try {
        const { cueNumber } = req.params;
        const { tags } = req.body;
        
        // Ensure tags is an array
        const tagArray = Array.isArray(tags) ? tags : [];
        updateOrCreateCue(cueNumber, { tags: tagArray });
        res.json({ success: true, message: 'Tags saved successfully' });
    } catch (error) {
        console.error('Error saving tags:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all unique tags across all cues
app.get('/api/tags', (req, res) => {
    try {
        const allTags = new Set();
        cues.forEach(cue => {
            if (cue.tags && Array.isArray(cue.tags)) {
                cue.tags.forEach(tag => allTags.add(tag));
            }
        });
        res.json({ tags: Array.from(allTags).sort() });
    } catch (error) {
        console.error('Error getting tags:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/cues/:cueNumber/image', upload.single('image'), (req, res) => {
    try {
        const { cueNumber } = req.params;
        
        if (req.file) {
            updateOrCreateCue(cueNumber, { image_path: req.file.filename });
            res.json({ success: true, message: 'Image uploaded successfully', filename: req.file.filename });
        } else {
            res.status(400).json({ error: 'No image file provided' });
        }
    } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).json({ error: error.message });
    }
});

// Show notes endpoints
app.get('/api/show-notes', (req, res) => {
    res.json(showNotes);
});

app.post('/api/show-notes', (req, res) => {
    try {
        showNotes.notes = req.body.notes || '';
        saveShowNotes();
        res.json({ success: true, message: 'Show notes saved successfully' });
    } catch (error) {
        console.error('Error saving show notes:', error);
        res.status(500).json({ error: error.message });
    }
});

// PDF Export (opens in browser for print-to-PDF)
app.get('/api/export-html', (req, res) => {
    try {
        const htmlContent = generatePDFReport();
        res.setHeader('Content-Type', 'text/html');
        res.send(htmlContent);
    } catch (error) {
        console.error('PDF export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Format notes with simple markdown-like syntax
function formatNotesForExport(notes) {
    if (!notes) return '';
    let formatted = escapeHtml(notes);
    // Bold: *text*
    formatted = formatted.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
    // Italic: _text_
    formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');
    // Strikethrough: ~text~
    formatted = formatted.replace(/~([^~]+)~/g, '<s>$1</s>');
    // Line breaks
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function generatePDFReport() {
    // Get current show name
    const showName = currentShowName || 'EOS Cue List';
    
    const cueRows = cues.map(cue => {
        const color = cue.color || '#ffffff';
        const hasColor = color !== '#ffffff';
        const bgStyle = hasColor ? `background-color: ${color}20; border-left: 4px solid ${color};` : '';
        const notes = formatNotesForExport(cue.notes);
        const page = escapeHtml(cue.page || '');
        const tags = (cue.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ');
        
        return `
        <tr style="${bgStyle}">
            <td class="cue-num">${escapeHtml(cue.cue_number)}</td>
            <td class="label">${escapeHtml(cue.label || '')}</td>
            <td class="tags">${tags}</td>
            <td class="notes">${notes}</td>
            <td class="page">${page}</td>
        </tr>`;
    }).join('');
    
    return `<!DOCTYPE html>
    <html>
    <head>
        <title>${escapeHtml(showName)} - Cue List</title>
        <style>
            * { box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; 
                margin: 0;
                padding: 20px;
                font-size: 11px;
                line-height: 1.4;
                color: #333;
            }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                padding-bottom: 15px;
                border-bottom: 2px solid #333;
            }
            h1 { 
                margin: 0;
                font-size: 24px;
                font-weight: 600;
            }
            .date {
                color: #666;
                font-size: 12px;
            }
            table { 
                width: 100%; 
                border-collapse: collapse; 
                margin-bottom: 20px;
            }
            th { 
                background-color: #2a2a2a; 
                color: white;
                font-weight: 600; 
                padding: 10px 8px;
                text-align: left;
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            td { 
                border-bottom: 1px solid #ddd; 
                padding: 8px;
                vertical-align: top;
            }
            tr:hover { background-color: #f8f8f8; }
            .cue-num { 
                font-weight: 600; 
                white-space: nowrap;
                width: 60px;
            }
            .label { 
                max-width: 150px;
                word-wrap: break-word;
            }
            .tags {
                max-width: 120px;
            }
            .tag {
                display: inline-block;
                background: #e0e0e0;
                color: #333;
                padding: 2px 6px;
                border-radius: 10px;
                font-size: 9px;
                margin: 1px;
            }
            .notes { 
                min-width: 200px;
                max-width: 400px;
            }
            .notes strong { font-weight: 700; }
            .notes em { font-style: italic; }
            .notes s { text-decoration: line-through; color: #888; }
            .page {
                width: 50px;
                text-align: center;
            }
            .show-notes {
                margin-top: 30px;
                padding: 20px;
                background: #f5f5f5;
                border-radius: 8px;
            }
            .show-notes h2 {
                margin-top: 0;
                font-size: 16px;
                color: #333;
            }
            .show-notes-content {
                white-space: pre-wrap;
                line-height: 1.6;
            }
            .footer {
                margin-top: 40px;
                text-align: center;
                color: #888;
                font-size: 10px;
                border-top: 1px solid #ddd;
                padding-top: 15px;
            }
            .no-print {
                background: #4a90e2;
                color: white;
                padding: 15px 20px;
                margin-bottom: 20px;
                border-radius: 8px;
                display: flex;
                gap: 10px;
                align-items: center;
            }
            .no-print button {
                background: white;
                color: #4a90e2;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                font-weight: 600;
                font-size: 14px;
            }
            .no-print button:hover {
                background: #f0f0f0;
            }
            .no-print span {
                flex: 1;
            }
            @media print {
                body { padding: 0; }
                .no-print { display: none !important; }
                tr { page-break-inside: avoid; }
                .show-notes { page-break-before: auto; }
            }
        </style>
    </head>
    <body>
        <div class="no-print">
            <span>Use your browser's Print function (Ctrl+P / Cmd+P) to save as PDF</span>
            <button onclick="window.print()">Print / Save as PDF</button>
            <button onclick="window.close()">Close</button>
        </div>
        <div class="header">
            <h1>${escapeHtml(showName)}</h1>
            <div class="date">Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</div>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Cue #</th>
                    <th>Label</th>
                    <th>Tags</th>
                    <th>Notes</th>
                    <th>Page</th>
                </tr>
            </thead>
            <tbody>
                ${cueRows}
            </tbody>
        </table>
        ${showNotes.notes ? `
        <div class="show-notes">
            <h2>Show Notes</h2>
            <div class="show-notes-content">${formatNotesForExport(showNotes.notes)}</div>
        </div>` : ''}
        <div class="footer">
            Generated by Qnote for EOS &bull; ${cues.length} cues
        </div>
    </body>
    </html>`;
}

// Initialize and start server
loadData();

// Show Timer API Endpoints
app.get('/api/show-timings', (req, res) => {
    res.json(showTimings);
});

app.post('/api/show-timings/start', (req, res) => {
    showTimings.isRecording = true;
    showTimings.showStartTime = Date.now();
    showTimings.lastCueTime = null;
    showTimings.lastCueNumber = null;
    showTimings.cueTimings = [];
    currentShowElapsed = 0;
    lastCueFireTime = null;
    saveShowTimings();
    console.log('⏱️ Show timing recording started at', new Date(showTimings.showStartTime).toISOString());
    console.log('⏱️ isRecording:', showTimings.isRecording, 'showStartTime:', showTimings.showStartTime);
    res.json({ 
        success: true, 
        message: 'Show timing recording started',
        oscConnected: isConnected
    });
});

app.post('/api/show-timings/stop', (req, res) => {
    showTimings.isRecording = false;
    saveShowTimings();
    console.log('⏱️ Show timing recording stopped');
    res.json({ success: true, message: 'Show timing recording stopped', timings: showTimings });
});

app.post('/api/show-timings/clear', (req, res) => {
    showTimings = {
        isRecording: false,
        showStartTime: null,
        lastCueTime: null,
        lastCueNumber: null,
        cueTimings: []
    };
    currentShowElapsed = 0;
    lastCueFireTime = null;
    saveShowTimings();
    console.log('⏱️ Show timings cleared');
    res.json({ success: true, message: 'Show timings cleared' });
});

// Update timings manually
app.post('/api/show-timings/update', (req, res) => {
    try {
        const { cueTimings } = req.body;
        if (!cueTimings || !Array.isArray(cueTimings)) {
            return res.status(400).json({ error: 'Invalid cueTimings data' });
        }
        
        // Update the timings
        showTimings.cueTimings = cueTimings;
        saveShowTimings();
        
        console.log(`⏱️ Manually updated ${cueTimings.length} cue timings`);
        res.json({ success: true, message: 'Timings updated successfully' });
    } catch (error) {
        console.error('Error updating timings:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/show-timings/countdown', (req, res) => {
    if (showTimings.cueTimings.length === 0) {
        return res.json({ hasTimings: false });
    }
    
    // Build duration map for all cues
    const cueDurations = {};
    showTimings.cueTimings.forEach((timing, index) => {
        cueDurations[timing.cueNumber] = {
            duration: timing.timeFromPrevious || 0,
            countdown: null,
            isActive: false
        };
    });
    
    // Find current active cue on main playback list only
    const activeCue = cues.find(c => c.last_seen === 'active' && String(c.cue_list || '1') === mainPlaybackList);
    if (!activeCue) {
        const totalShowTime = showTimings.cueTimings[showTimings.cueTimings.length - 1].timestamp;
        return res.json({ 
            hasTimings: true, 
            isPlaying: false,
            cueDurations,
            totalShowTime
        });
    }
    
    // Find this cue in the timings
    const currentCueIndex = showTimings.cueTimings.findIndex(
        t => t.cueNumber === activeCue.cue_number
    );
    
    if (currentCueIndex === -1) {
        const totalShowTime = showTimings.cueTimings[showTimings.cueTimings.length - 1].timestamp;
        return res.json({ 
            hasTimings: true, 
            isPlaying: false,
            cueDurations,
            totalShowTime
        });
    }
    
    // Calculate actual elapsed time including real-time since last cue
    let showElapsed = currentShowElapsed;
    if (lastCueFireTime) {
        const secondsSinceLastFire = (Date.now() - lastCueFireTime) / 1000;
        showElapsed = currentShowElapsed + secondsSinceLastFire;
    }
    
    const currentTiming = showTimings.cueTimings[currentCueIndex];
    const timeSinceCueFired = showElapsed - currentTiming.timestamp;
    
    // Update countdown for active cue
    if (currentCueIndex < showTimings.cueTimings.length - 1) {
        const nextTiming = showTimings.cueTimings[currentCueIndex + 1];
        const timeRemaining = nextTiming.timeFromPrevious - timeSinceCueFired;
        cueDurations[activeCue.cue_number].countdown = timeRemaining > 0 ? timeRemaining : 0;
        cueDurations[activeCue.cue_number].isActive = true;
    } else {
        // Last cue - no next cue
        cueDurations[activeCue.cue_number].countdown = 0;
        cueDurations[activeCue.cue_number].isActive = true;
    }
    
    // Calculate time to next cue
    let timeToNext = null;
    if (currentCueIndex < showTimings.cueTimings.length - 1) {
        const nextTiming = showTimings.cueTimings[currentCueIndex + 1];
        timeToNext = nextTiming.timeFromPrevious - timeSinceCueFired;
    }
    
    // Calculate estimated show end
    const totalShowTime = showTimings.cueTimings[showTimings.cueTimings.length - 1].timestamp;
    const estimatedTimeRemaining = totalShowTime - showElapsed;
    
    res.json({
        hasTimings: true,
        isPlaying: true,
        showElapsed,
        timeToNext: timeToNext > 0 ? timeToNext : null,
        estimatedTimeRemaining: estimatedTimeRemaining > 0 ? estimatedTimeRemaining : null,
        totalShowTime,
        cueDurations
    });
});

// Tag-color mappings API
function getTagColorsPath() {
    return path.join(getShowDir(currentShowName), 'tag-colors.json');
}

function loadTagColors() {
    const tagColorsPath = getTagColorsPath();
    if (fs.existsSync(tagColorsPath)) {
        try {
            return JSON.parse(fs.readFileSync(tagColorsPath, 'utf8'));
        } catch (error) {
            console.error('Error loading tag colors:', error);
        }
    }
    return {};
}

function saveTagColors(mappings) {
    const tagColorsPath = getTagColorsPath();
    fs.writeFileSync(tagColorsPath, JSON.stringify(mappings, null, 2));
}

app.get('/api/tag-colors', (req, res) => {
    res.json(loadTagColors());
});

app.post('/api/tag-colors', (req, res) => {
    try {
        const mappings = req.body;
        saveTagColors(mappings);
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving tag colors:', error);
        res.status(500).json({ error: error.message });
    }
});

// Scene data API
function loadSceneData() {
    const filePath = path.join(getShowDir(currentShowName), 'scene-data.json');
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading scene data:', error);
    }
    return {};
}

function saveSceneData(data) {
    const filePath = path.join(getShowDir(currentShowName), 'scene-data.json');
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

app.get('/api/scene-data', (req, res) => {
    res.json(loadSceneData());
});

app.post('/api/scene-data', (req, res) => {
    try {
        saveSceneData(req.body);
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving scene data:', error);
        res.status(500).json({ error: error.message });
    }
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ EOS Cue Manager Standalone running on http://localhost:${PORT}`);
    console.log(`✅ Server listening on all interfaces (0.0.0.0:${PORT})`);
    console.log('✅ Ready for packaging as standalone executable');
    console.log('✅ Data stored in local JSON files - no database required');
    console.log('');
    console.log('🌐 Open your browser to: http://localhost:5000');
    console.log('🌐 Or try: http://127.0.0.1:5000');
    console.log('');
    console.log('Press Ctrl+C to stop the server');
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`❌ Error: Port ${PORT} is already in use`);
        console.log('   Try closing other applications or restart your computer');
        console.log('   Or modify the PORT variable in this file to use a different port');
    } else {
        console.log('❌ Server error:', err.message);
    }
    process.exit(1);
});