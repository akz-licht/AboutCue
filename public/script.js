// Global state
let cueData = [];
let allTags = [];
let activeFilters = new Set();
let currentCueId = null;
let currentCueTags = [];
let connectedToEOS = false;
let showTimerState = null;
let countdownInterval = null;
let currentDurations = {};
let currentShowName = 'Default';
let sceneData = {};
let collapsedScenes = new Set();
let lastActiveCueNumber = null;
let lastPendingCueNumber = null;
let mainPlaybackList = '1';

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadShows();
    await loadSettings();
    await loadCues();
    loadShowNotes();
    await loadShowTimings();
    loadTagColorMappings();
    loadSceneData();
});

// Show management functions
async function loadShows() {
    try {
        const response = await fetch('/api/shows');
        const data = await response.json();
        
        const selector = document.getElementById('showSelector');
        selector.innerHTML = '';
        
        // Add "Load from EOS" option at the top
        const loadEosOption = document.createElement('option');
        loadEosOption.value = '__LOAD_FROM_EOS__';
        loadEosOption.textContent = '🔄 Load from EOS...';
        loadEosOption.style.color = '#4a90e2';
        selector.appendChild(loadEosOption);
        
        // Add separator
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '──────────';
        selector.appendChild(separator);
        
        data.shows.forEach(show => {
            const option = document.createElement('option');
            option.value = show;
            option.textContent = show;
            if (show === data.currentShow) {
                option.selected = true;
            }
            selector.appendChild(option);
        });
        
        currentShowName = data.currentShow;
        
        // Update UI to show EOS-connected show indicator
        if (data.connectedEOSShow && data.isConnected) {
            document.getElementById('connectionStatus').textContent = 
                `Connected to EOS: ${data.connectedEOSShow}`;
        }
    } catch (error) {
        console.error('Error loading shows:', error.message || error);
    }
}

async function switchShow(showName) {
    // Handle "Load from EOS" option
    if (showName === '__LOAD_FROM_EOS__') {
        await loadShowFromEOS();
        // Reset selector to current show
        document.getElementById('showSelector').value = currentShowName;
        return;
    }
    
    try {
        const response = await fetch('/api/shows/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showName })
        });
        
        const data = await response.json();
        if (data.success) {
            currentShowName = data.currentShow;
            // Reload all data for the new show
            loadCues();
            loadShowNotes();
            loadShowTimings();
            loadTagColorMappings();
            loadSceneData();
            collapsedScenes.clear();
        }
    } catch (error) {
        console.error('Error switching show:', error.message || error);
    }
}

async function createNewShow() {
    const showName = prompt('Enter name for new show:');
    if (!showName || !showName.trim()) return;
    
    try {
        const response = await fetch('/api/shows/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showName: showName.trim() })
        });
        
        const data = await response.json();
        if (data.success) {
            await loadShows();
            // Switch to the new show
            switchShow(showName.trim());
        } else {
            alert(data.message || 'Failed to create show');
        }
    } catch (error) {
        console.error('Error creating show:', error.message || error);
        alert('Error creating show');
    }
}

async function deleteCurrentShow() {
    const selector = document.getElementById('showSelector');
    const showName = selector.value;
    
    if (showName === 'Default') {
        alert('Cannot delete the Default show');
        return;
    }
    
    if (!confirm(`Are you sure you want to delete "${showName}"?\n\nThis will permanently delete all cues, notes, and timing data for this show.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/shows/${encodeURIComponent(showName)}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        if (data.success) {
            await loadShows();
            // Reload data for the new current show
            loadCues();
            loadShowNotes();
            loadShowTimings();
        } else {
            alert(data.error || 'Failed to delete show');
        }
    } catch (error) {
        console.error('Error deleting show:', error.message || error);
        alert('Error deleting show');
    }
}

async function loadShowFromEOS() {
    try {
        const response = await fetch('/api/shows/load-from-eos', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            showToast(`Loaded show: ${data.showName}`);
            await loadShows();
            loadCues();
            loadShowNotes();
            loadShowTimings();
            loadTagColorMappings();
            loadSceneData();
            collapsedScenes.clear();
        } else {
            alert(data.error || 'Could not load show from EOS. Make sure you are connected.');
        }
    } catch (error) {
        console.error('Error loading show from EOS:', error.message || error);
        alert('Failed to load show from EOS. Check connection.');
    }
}

// Multi-cue editor for batch color and tag operations
let multiCueSelection = new Set();

function showMultiCueEditor() {
    const modal = document.getElementById('multiCueModal');
    if (!modal) {
        createMultiCueModal();
    }
    document.getElementById('multiCueModal').style.display = 'flex';
    populateMultiCueList();
    populateMultiCueTagDropdown();
}

function closeMultiCueEditor() {
    document.getElementById('multiCueModal').style.display = 'none';
    multiCueSelection.clear();
}

function createMultiCueModal() {
    const modal = document.createElement('div');
    modal.id = 'multiCueModal';
    modal.style.cssText = 'display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 1000; justify-content: center; align-items: center;';
    modal.innerHTML = `
        <div style="background: #1e1e1e; border-radius: 12px; padding: 25px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;">
            <h3 style="margin: 0 0 15px 0; color: #4a90e2;">Edit Multiple Cues</h3>
            <p style="color: #888; font-size: 13px; margin-bottom: 15px;">Select cues to apply color or tags to all at once.</p>
            
            <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                <button class="button" onclick="selectAllCues()">Select All</button>
                <button class="button" onclick="selectNoneCues()">Select None</button>
                <button class="button" onclick="selectSceneCues()">Select by Scene...</button>
            </div>
            
            <div id="multiCueList" style="max-height: 250px; overflow-y: auto; border: 1px solid #333; border-radius: 8px; margin-bottom: 15px;"></div>
            
            <div style="display: flex; gap: 15px; margin-bottom: 15px;">
                <div style="flex: 1;">
                    <label style="color: #aaa; font-size: 12px;">Set Color:</label>
                    <select id="multiCueColor" class="input" style="width: 100%;">
                        <option value="">-- No change --</option>
                        <option value="#ffffff">White (None)</option>
                        <option value="#ff6b6b">Red</option>
                        <option value="#ffa726">Orange</option>
                        <option value="#ffee58">Yellow</option>
                        <option value="#66bb6a">Green</option>
                        <option value="#42a5f5">Blue</option>
                        <option value="#ab47bc">Purple</option>
                        <option value="#ec407a">Pink</option>
                    </select>
                </div>
                <div style="flex: 1;">
                    <label style="color: #aaa; font-size: 12px;">Add Tag:</label>
                    <select id="multiCueTag" class="input" style="width: 100%;">
                        <option value="">-- No change --</option>
                    </select>
                </div>
            </div>
            
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button class="button" onclick="closeMultiCueEditor()">Cancel</button>
                <button class="button primary" onclick="applyMultiCueChanges()">Apply to Selected</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function populateMultiCueTagDropdown() {
    const select = document.getElementById('multiCueTag');
    if (!select) return;
    
    // Get all unique tags from cueData
    const allTags = new Set();
    cueData.forEach(cue => {
        if (cue.tags && Array.isArray(cue.tags)) {
            cue.tags.forEach(tag => allTags.add(tag));
        }
    });
    
    // Add predefined tags
    const predefinedTags = ['Followspot', 'Practical', 'Effect', 'Blackout', 'Preset', 'Safety', 'Video', 'Sound', 'Fly'];
    predefinedTags.forEach(tag => allTags.add(tag));
    
    // Sort and build options
    const sortedTags = [...allTags].sort();
    let html = '<option value="">-- No change --</option>';
    sortedTags.forEach(tag => {
        html += `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`;
    });
    select.innerHTML = html;
}

function populateMultiCueList() {
    const list = document.getElementById('multiCueList');
    if (!list) return;
    
    let html = '';
    cueData.forEach(cue => {
        const checked = multiCueSelection.has(cue.cue_number) ? 'checked' : '';
        const color = cue.color || '#ffffff';
        const colorDot = color !== '#ffffff' ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:5px;"></span>` : '';
        html += `<div style="padding: 8px 12px; border-bottom: 1px solid #333; display: flex; align-items: center;">
            <input type="checkbox" ${checked} onchange="toggleMultiCue('${cue.cue_number}')" style="margin-right: 10px;">
            ${colorDot}<strong style="color: #4a90e2; margin-right: 10px;">${cue.cue_number}</strong>
            <span style="color: #ccc;">${escapeHtml(cue.label || '')}</span>
        </div>`;
    });
    list.innerHTML = html;
}

function toggleMultiCue(cueNum) {
    if (multiCueSelection.has(cueNum)) {
        multiCueSelection.delete(cueNum);
    } else {
        multiCueSelection.add(cueNum);
    }
}

function selectAllCues() {
    cueData.forEach(cue => multiCueSelection.add(cue.cue_number));
    populateMultiCueList();
}

function selectNoneCues() {
    multiCueSelection.clear();
    populateMultiCueList();
}

function selectSceneCues() {
    const scenes = [...new Set(cueData.filter(c => c.scene).map(c => c.scene))];
    if (scenes.length === 0) {
        alert('No scenes found');
        return;
    }
    const scene = prompt('Enter scene name to select:\n' + scenes.join(', '));
    if (scene) {
        cueData.filter(c => c.scene === scene).forEach(c => multiCueSelection.add(c.cue_number));
        populateMultiCueList();
    }
}

async function applyMultiCueChanges() {
    const color = document.getElementById('multiCueColor').value;
    const tag = document.getElementById('multiCueTag').value.trim();
    
    if (multiCueSelection.size === 0) {
        alert('No cues selected');
        return;
    }
    
    if (!color && !tag) {
        alert('Select a color or enter a tag to apply');
        return;
    }
    
    let updated = 0;
    for (const cueNum of multiCueSelection) {
        const cue = cueData.find(c => c.cue_number === cueNum);
        if (!cue) continue;
        
        if (color) {
            await fetch(`/api/cues/${encodeURIComponent(cueNum)}/color`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ color })
            });
        }
        
        if (tag) {
            const currentTags = cue.tags || [];
            if (!currentTags.includes(tag)) {
                const newTags = [...currentTags, tag];
                await fetch(`/api/cues/${encodeURIComponent(cueNum)}/tags`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tags: newTags })
                });
            }
        }
        updated++;
    }
    
    showToast(`Updated ${updated} cues`);
    closeMultiCueEditor();
    loadCues();
}

// Tab navigation
function showTab(tabName) {
    // Hide all tabs
    document.getElementById('cues-tab').style.display = 'none';
    document.getElementById('notes-tab').style.display = 'none';
    document.getElementById('settings-tab').style.display = 'none';
    
    // Show selected tab
    document.getElementById(tabName + '-tab').style.display = 'block';
    
    // Update active button
    document.querySelectorAll('.nav-button').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Load data for the tab
    if (tabName === 'cues') {
        loadCues();
    } else if (tabName === 'notes') {
        loadShowNotes();
    }
}

// Settings functions
async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        
        document.getElementById('ipAddress').value = settings.ipAddress || '192.168.1.100';
        document.getElementById('protocol').value = settings.protocol || 'tcp';
        document.getElementById('port').value = settings.port || 3037;
        document.getElementById('oscVersion').value = settings.oscVersion || '1.1';
        mainPlaybackList = String(settings.mainPlaybackList || '1');
        const mainListInput = document.getElementById('mainPlaybackList');
        if (mainListInput) mainListInput.value = mainPlaybackList;
    } catch (error) {
        console.error('Error loading settings:', error.message || error);
    }
}

function updateDefaultPort() {
    const protocol = document.getElementById('protocol').value;
    const portInput = document.getElementById('port');
    if (protocol === 'tcp') {
        portInput.value = 3032;
    } else {
        portInput.value = 8000;
    }
}

async function saveSettings() {
    try {
        const mainListVal = document.getElementById('mainPlaybackList')?.value || '1';
        mainPlaybackList = String(mainListVal);
        const settings = {
            ipAddress: document.getElementById('ipAddress').value,
            protocol: document.getElementById('protocol').value,
            port: parseInt(document.getElementById('port').value),
            oscVersion: document.getElementById('oscVersion').value,
            mainPlaybackList: mainPlaybackList
        };
        
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(settings)
        });
        
        if (response.ok) {
            alert('Settings saved successfully!');
        } else {
            alert('Error saving settings');
        }
    } catch (error) {
        console.error('Error saving settings:', error.message || error);
        alert('Error saving settings');
    }
}

async function connectToEOS() {
    try {
        const response = await fetch('/api/connect', {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            connectedToEOS = true;
            document.getElementById('connectionStatus').textContent = 'Connected to EOS console';
            document.getElementById('connectionStatus').classList.add('connected');
            updateShowTimerVisibility(); // Show timer controls
            showToast('Connected to EOS! Click "Refresh Cues" to load cue data.');
        } else {
            showToast('Failed to connect to EOS console');
        }
    } catch (error) {
        console.error('Connection error:', error.message || error);
        showToast('Error connecting to EOS console');
    }
}

async function disconnectFromEOS() {
    try {
        const response = await fetch('/api/disconnect', {
            method: 'POST'
        });
        
        if (response.ok) {
            connectedToEOS = false;
            document.getElementById('connectionStatus').textContent = 'Not connected to EOS console';
            document.getElementById('connectionStatus').classList.remove('connected');
            alert('Disconnected from EOS console');
        }
    } catch (error) {
        console.error('Disconnection error:', error.message || error);
    }
}

// Cue data functions
async function loadCues() {
    try {
        // Don't refresh if user is editing a page field
        if (document.activeElement && document.activeElement.classList.contains('page-input')) {
            return;
        }
        
        const response = await fetch('/api/cues');
        const cueResponse = await response.json();
        if (Array.isArray(cueResponse)) {
            cueData = cueResponse;
        } else {
            cueData = cueResponse.cues || [];
            if (cueResponse.mainPlaybackList && cueResponse.mainPlaybackList !== mainPlaybackList) {
                mainPlaybackList = String(cueResponse.mainPlaybackList);
                const mainListInput = document.getElementById('mainPlaybackList');
                if (mainListInput) mainListInput.value = mainPlaybackList;
                console.log(`🎛️ Main playback list updated to: ${mainPlaybackList}`);
            }
        }
        
        // Load all tags
        const tagsResponse = await fetch('/api/tags');
        const tagsData = await tagsResponse.json();
        allTags = tagsData.tags || [];
        
        // Detect if main playback active cue changed (for auto-scroll)
        const newActiveCue = cueData.find(c => c.last_seen === 'active' && String(c.cue_list || '1') === mainPlaybackList);
        const newPendingCue = cueData.find(c => c.last_seen === 'pending' && String(c.cue_list || '1') === mainPlaybackList);
        const newActiveCueKey = newActiveCue ? `${newActiveCue.cue_list || '1'}/${newActiveCue.cue_number}` : null;
        const newPendingCueKey = newPendingCue ? `${newPendingCue.cue_list || '1'}/${newPendingCue.cue_number}` : null;
        const activeCueChanged = newActiveCueKey !== lastActiveCueNumber;
        const pendingCueChanged = newPendingCueKey !== lastPendingCueNumber;
        lastActiveCueNumber = newActiveCueKey;
        lastPendingCueNumber = newPendingCueKey;
        
        populateCueListSelector();
        displayCueList();
        updateTagFilters();
        updateActiveCueNotesPanel();
        
        // Auto-scroll to active cue when it changes
        if (activeCueChanged && newActiveCueKey) {
            setTimeout(() => {
                const activeRow = document.querySelector('tr.active-cue');
                if (activeRow) {
                    activeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 50);
        }
    } catch (error) {
        console.error('Error loading cues:', error.message || error);
    }
}

async function refreshCues() {
    try {
        const response = await fetch('/api/cues/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ cueList: 1 })
        });
        
        if (response.ok) {
            // Wait a bit for cues to be retrieved
            setTimeout(loadCues, 2000);
        }
    } catch (error) {
        console.error('Error refreshing cues:', error.message || error);
    }
}

// Event-driven refresh: check for changes every 500ms when connected
setInterval(async () => {
    if (connectedToEOS) {
        try {
            const response = await fetch('/api/cues/changed');
            const result = await response.json();
            if (result.changed) {
                console.log('🔄 Cues changed - refreshing list');
                loadCues();
            }
            
            if (!countdownInterval) {
                const timingsResp = await fetch('/api/show-timings');
                const timingsData = await timingsResp.json();
                if ((timingsData.cueTimings && timingsData.cueTimings.length > 0) || timingsData.isRecording) {
                    showTimerState = timingsData;
                    updateShowTimerUI();
                    startCountdownUpdates();
                    if (timingsData.cueTimings && timingsData.cueTimings.length > 0) {
                        const durations = {};
                        timingsData.cueTimings.forEach(timing => {
                            durations[String(timing.cueNumber)] = {
                                duration: timing.timeFromPrevious || 0,
                                countdown: null,
                                isActive: false
                            };
                        });
                        currentDurations = durations;
                        displayCueList();
                    }
                }
            }
            
            const showsResponse = await fetch('/api/shows');
            const showsData = await showsResponse.json();
            if (showsData.currentShow !== currentShowName) {
                console.log('🔄 Show changed to:', showsData.currentShow);
                currentShowName = showsData.currentShow;
                selectedCueList = 'all';
                loadShows();
                loadCues();
                loadShowNotes();
                loadShowTimings();
                loadTagColorMappings();
                loadSceneData();
                collapsedScenes.clear();
            }
        } catch (error) {
            console.error('Error checking for changes:', error.message || error);
        }
    }
}, 500);

function clearCueData() {
    cueData = [];
    displayCueList();
}

// Predefined tags for quick selection
const PREDEFINED_TAGS = ['Preset', 'Blackout', 'Special', 'Follow', 'Important', 'Check', 'Slow', 'Fast'];

// Preset theme colors for cue highlighting - expanded palette
const PRESET_COLORS = [
    { name: 'None', value: '#ffffff' },
    { name: 'Blue', value: '#4a90e2' },
    { name: 'Navy', value: '#1e3a5f' },
    { name: 'Green', value: '#4caf50' },
    { name: 'Teal', value: '#00897b' },
    { name: 'Red', value: '#ff6b6b' },
    { name: 'Orange', value: '#ffa726' },
    { name: 'Purple', value: '#667eea' },
    { name: 'Magenta', value: '#e91e8c' },
    { name: 'Gold', value: '#f8b739' },
    { name: 'Cyan', value: '#26c6da' },
    { name: 'Pink', value: '#f48fb1' },
    { name: 'Lime', value: '#c6ff00' }
];

// Tag-to-color mappings (user configurable)
let tagColorMappings = {};

let selectedCueList = 'all';
let expandedCueNumber = null;

function jumpToActiveCue() {
    const activeRow = document.querySelector('tr.active-cue');
    if (activeRow) {
        activeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        activeRow.style.outline = '2px solid #4CAF50';
        setTimeout(() => { activeRow.style.outline = ''; }, 1500);
    } else {
        const pendingRow = document.querySelector('tr.pending-cue');
        if (pendingRow) {
            pendingRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            pendingRow.style.outline = '2px solid #FF9800';
            setTimeout(() => { pendingRow.style.outline = ''; }, 1500);
        }
    }
}

function jumpToScene(sceneName) {
    if (!sceneName) return;
    const sceneRow = document.querySelector(`tr.scene-separator[data-scene="${CSS.escape(sceneName)}"]`);
    if (sceneRow) {
        sceneRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        sceneRow.style.outline = '2px solid #667eea';
        setTimeout(() => { sceneRow.style.outline = ''; }, 1500);
    }
    document.getElementById('sceneJumpSelect').value = '';
}

function jumpToPage(pageValue) {
    if (!pageValue) return;
    const cue = cueData.find(c => c.page === pageValue);
    if (cue) {
        const cueKey = (cue.part_number || 0) > 0 ? `${cue.cue_number}/${cue.part_number}` : cue.cue_number;
        const row = document.querySelector(`tr[onclick*="toggleCueEdit('${cue.cue_number}'"]`);
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.style.outline = '2px solid #667eea';
            setTimeout(() => { row.style.outline = ''; }, 1500);
        }
    }
    document.getElementById('pageJumpSelect').value = '';
}

function updateSceneDropdown() {
    const select = document.getElementById('sceneJumpSelect');
    const mainListCues = cueData.filter(c => c.scene && String(c.cue_list || '1') === mainPlaybackList);
    const scenes = [...new Set(mainListCues.map(c => c.scene))];
    select.innerHTML = '<option value="">📑 Scenes</option>';
    scenes.forEach(scene => {
        const opt = document.createElement('option');
        opt.value = scene;
        opt.textContent = scene;
        select.appendChild(opt);
    });
}

function updatePageDropdown() {
    const select = document.getElementById('pageJumpSelect');
    const mainListCues = cueData.filter(c => c.page && String(c.cue_list || '1') === mainPlaybackList);
    const pages = [...new Set(mainListCues.map(c => c.page))];
    pages.sort((a, b) => {
        const numA = parseFloat(a) || 0;
        const numB = parseFloat(b) || 0;
        if (numA !== numB) return numA - numB;
        return a.localeCompare(b);
    });
    select.innerHTML = '<option value="">📄 Pages</option>';
    pages.forEach(page => {
        const opt = document.createElement('option');
        opt.value = page;
        opt.textContent = page;
        select.appendChild(opt);
    });
}

function updateActiveCueNotesPanel() {
    const panel = document.getElementById('activeCueNotesPanel');
    // Floating header always shows main playback fader's active/pending cue
    const activeCue = cueData.find(c => c.last_seen === 'active' && String(c.cue_list || '1') === mainPlaybackList);
    const pendingCue = cueData.find(c => c.last_seen === 'pending' && String(c.cue_list || '1') === mainPlaybackList);
    
    if (!activeCue && !pendingCue) {
        panel.style.display = 'none';
        return;
    }
    
    panel.style.display = 'block';
    
    // Update active cue section
    const activeSection = document.getElementById('activeNoteSection');
    const activeNoteCue = document.getElementById('activeNoteCue');
    const activeCueLabel = document.getElementById('activeCueLabel');
    const activeNoteText = document.getElementById('activeNoteText');
    const activeNoteTags = document.getElementById('activeNoteTags');
    
    if (activeCue) {
        activeSection.style.display = 'grid';
        const activeList = activeCue.cue_list || '1';
        activeNoteCue.textContent = activeList !== '1' ? `${activeList}/${activeCue.cue_number}` : activeCue.cue_number;
        activeCueLabel.textContent = activeCue.label || '--';
        activeNoteText.textContent = activeCue.notes || 'No notes';
        activeNoteTags.textContent = (activeCue.tags || []).join(', ') || '--';
    } else {
        activeSection.style.display = 'none';
    }
    
    // Update pending cue section (always from main playback fader)
    const pendingSection = document.getElementById('pendingNoteSection');
    const pendingNoteCue = document.getElementById('pendingNoteCue');
    const pendingCueLabel = document.getElementById('pendingCueLabel');
    const pendingNoteText = document.getElementById('pendingNoteText');
    const pendingNoteTags = document.getElementById('pendingNoteTags');
    
    if (pendingCue) {
        pendingSection.style.display = 'grid';
        const pendingList = pendingCue.cue_list || '1';
        pendingNoteCue.textContent = pendingList !== '1' ? `${pendingList}/${pendingCue.cue_number}` : pendingCue.cue_number;
        pendingCueLabel.textContent = pendingCue.label || '--';
        pendingNoteText.textContent = pendingCue.notes || 'No notes';
        pendingNoteTags.textContent = (pendingCue.tags || []).join(', ') || '--';
    } else {
        pendingSection.style.display = 'none';
    }
    
    // Update recording button state
    updatePanelRecordingState();
}

function updatePanelRecordingState() {
    const btn = document.getElementById('panelRecBtn');
    const status = document.getElementById('panelRecStatus');
    
    if (!btn || !status) return;
    
    if (showTimerState && showTimerState.isRecording) {
        btn.classList.add('recording');
        status.classList.add('recording');
        status.textContent = 'Recording...';
    } else {
        btn.classList.remove('recording');
        status.classList.remove('recording');
        const timingCount = showTimerState?.cueTimings?.length || 0;
        status.textContent = timingCount > 0 ? `${timingCount} timings recorded` : 'Not recording';
    }
}

function displayCueList() {
    const cueListElement = document.getElementById('cueList');
    const cueCountElement = document.getElementById('cueCount');
    
    // Guard against DOM not ready
    if (!cueListElement || !cueCountElement) return;
    
    // Update cue count and total duration
    const filteredCues = getFilteredCues();
    let totalDurationText = '';
    if (showTimerState && showTimerState.cueTimings && showTimerState.cueTimings.length > 1) {
        // Use min/max to ensure correct duration even if data isn't sorted
        const timestamps = showTimerState.cueTimings.map(t => t.timestamp);
        const minTimestamp = Math.min(...timestamps);
        const maxTimestamp = Math.max(...timestamps);
        const totalDuration = maxTimestamp - minTimestamp;
        totalDurationText = ` · ${formatDurationTime(totalDuration)}`;
    }
    cueCountElement.textContent = `${filteredCues.length} cue${filteredCues.length !== 1 ? 's' : ''}${totalDurationText}`;
    
    if (filteredCues.length === 0) {
        cueListElement.innerHTML = `
            <div class="empty-state">
                <p style="font-size: 18px; margin-bottom: 10px;">No cues to display</p>
                <p>${cueData.length === 0 ? 'Configure OSC settings and connect to your EOS console' : 'No cues match the current filters'}</p>
            </div>
        `;
        return;
    }
    
    let html = '<table class="cue-table-full">';
    html += '<colgroup>';
    html += '<col class="col-cue">';
    html += '<col class="col-label">';
    html += '<col class="col-time">';
    html += '<col class="col-time">';
    html += '<col class="col-time">';
    html += '<col class="col-time">';
    html += '<col class="col-time">';
    html += '<col class="col-flags">';
    html += '<col class="col-fh">';
    html += '<col class="col-duration">';
    html += '<col class="col-tags">';
    html += '<col class="col-notes">';
    html += '<col class="col-page">';
    html += '</colgroup>';
    html += '<thead><tr>';
    html += '<th>Cue #</th>';
    html += '<th>Label</th>';
    html += '<th title="Intensity Up Time">Int ↑</th>';
    html += '<th title="Intensity Down Time">Int ↓</th>';
    html += '<th title="Focus Time">Focus</th>';
    html += '<th title="Color Time">Color</th>';
    html += '<th title="Beam Time">Beam</th>';
    html += '<th title="Mark / Block / Assert">M/B/A</th>';
    html += '<th title="Follow / Hang">F/H</th>';
    html += '<th>Duration</th>';
    html += '<th>Tags</th>';
    html += '<th>Notes</th>';
    html += '<th title="Script Page Reference">Page</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    let lastScene = '';
    let currentScene = '';
    let currentSceneColor = '#4a90e2'; // Track the current scene's color for the line indicator
    let sceneEndCueNumber = null; // Track the cue number that ended a scene (to also hide its parts)
    let sceneEndSceneName = null; // Track which scene the scene-end cue belongs to (for hiding parts when collapsed)
    const totalCols = 13;
    
    // Pre-compute scene bounds from full cue data (not filtered) for accurate ranges
    const sceneBounds = getSceneBounds();
    
    // Pre-compute total duration for each scene (optimized - single pass)
    const sceneDurations = {};
    for (const [sceneName, bounds] of Object.entries(sceneBounds)) {
        let totalDuration = 0;
        for (let i = bounds.start; i <= bounds.end && i < cueData.length; i++) {
            const cue = cueData[i];
            const timing = currentDurations[String(cue.cue_number)];
            if (timing && timing.duration) {
                totalDuration += timing.duration;
            }
        }
        sceneDurations[sceneName] = totalDuration;
    }
    
    let currentListNumber = null;
    
    filteredCues.forEach((cue, index) => {
      try {
        const color = cue.color || '#ffffff';
        const notes = cue.notes || '';
        const tags = cue.tags || [];
        const partNum = cue.part_number || 0;
        const cueKey = partNum > 0 ? `${cue.cue_number}/${partNum}` : cue.cue_number;
        const isExpanded = expandedCueNumber === cueKey;
        const isActive = cue.last_seen === 'active';
        const cueListNum = String(cue.cue_list || '1');
        // Pending cue only shown for main playback list
        const isPending = cue.last_seen === 'pending' && cueListNum === mainPlaybackList;
        
        // Insert cue list separator when viewing all lists
        if (selectedCueList === 'all' && cueListNum !== currentListNumber) {
            currentListNumber = cueListNum;
            const isMainList = cueListNum === mainPlaybackList;
            const listLabel = isMainList ? `Cue List ${escapeHtml(cueListNum)} (Main Playback)` : `Cue List ${escapeHtml(cueListNum)}`;
            html += `<tr class="cuelist-separator"><td colspan="${totalCols}" style="background: rgba(74,144,226,0.15); padding: 8px 12px; font-weight: bold; color: #4a90e2; border-top: 2px solid rgba(74,144,226,0.4); border-bottom: 1px solid rgba(74,144,226,0.2);">📋 ${listLabel}</td></tr>`;
        }
        
        // Check if the PREVIOUS cue has follow or hang (this cue was auto-triggered)
        const prevCue = index > 0 ? filteredCues[index - 1] : null;
        const sameList = prevCue && String(prevCue.cue_list || '1') === String(cue.cue_list || '1');
        const wasAutoTriggered = sameList && (prevCue.follow_time !== null || prevCue.hang_time !== null);
        
        // Track current scene - EOS only tags the first cue of a scene
        // scene_end marks the last cue of a scene
        const scene = cue.scene || '';
        const isSceneEnd = cue.scene_end === true;
        
        if (scene) {
            currentScene = scene;
            // Update current scene color
            const sceneInfo = getSceneInfo(scene);
            currentSceneColor = sceneInfo ? (sceneInfo.color || '#4a90e2') : '#4a90e2';
        }
        
        // Scene separator - show when scene changes
        if (scene && scene !== lastScene) {
            const sceneInfo = getSceneInfo(scene);
            const sceneColor = sceneInfo.color || '#ffffff';
            const sceneNotes = sceneInfo.notes || '';
            const isCollapsed = collapsedScenes.has(scene);
            const collapseIcon = isCollapsed ? '▶' : '▼';
            const bounds = sceneBounds[scene];
            const sceneCueCount = bounds ? (bounds.end - bounds.start + 1) : 0;
            const startCue = bounds && cueData[bounds.start] ? cueData[bounds.start].cue_number : cue.cue_number;
            const endCue = bounds && cueData[bounds.end] ? cueData[bounds.end].cue_number : cue.cue_number;
            
            // Get total duration for this scene
            const totalSceneDuration = sceneDurations[scene] || 0;
            const sceneDurationDisplay = totalSceneDuration > 0 ? formatDurationTime(totalSceneDuration) : '--';
            
            html += `<tr class="scene-separator" data-scene="${escapeHtml(scene)}" style="--scene-color: ${sceneColor};">
                <td colspan="${totalCols}">
                    <div class="scene-header">
                        <span class="scene-collapse-btn" onclick="event.stopPropagation(); toggleSceneCollapse('${escapeHtml(scene)}')">${collapseIcon}</span>
                        <span class="scene-label" style="background: linear-gradient(135deg, ${sceneColor}22, ${sceneColor}11); color: ${sceneColor === '#ffffff' ? '#ddd' : sceneColor};">${escapeHtml(scene)}</span>
                        <span class="scene-cue-range">Cues ${startCue} - ${endCue} (${sceneCueCount})</span>
                        <span class="scene-duration" title="Total scene duration">⏱ ${sceneDurationDisplay}</span>
                        <input type="text" class="scene-notes-input" placeholder="Scene notes..." value="${escapeHtml(sceneNotes)}" onclick="event.stopPropagation()" onblur="updateSceneNotes('${escapeHtml(scene)}', this.value)" onkeypress="if(event.key==='Enter'){this.blur();}">
                        <select class="scene-color-select" onclick="event.stopPropagation()" onchange="updateSceneColor('${escapeHtml(scene)}', this.value)">
                            ${PRESET_COLORS.map(c => `<option value="${c.value}" ${sceneColor === c.value ? 'selected' : ''}>${c.name}</option>`).join('')}
                        </select>
                    </div>
                </td>
            </tr>`;
            lastScene = scene;
        }
        
        const partNumber = cue.part_number || 0;
        
        // Clear the scene end cue tracker when we move to a different cue number
        if (sceneEndCueNumber && cue.cue_number !== sceneEndCueNumber) {
            sceneEndCueNumber = null;
            sceneEndSceneName = null;
        }
        
        // Track scene_end on main cues only (part 0), BEFORE checking hide conditions
        if (isSceneEnd && partNumber === 0) {
            sceneEndCueNumber = cue.cue_number;
            sceneEndSceneName = currentScene; // Remember which scene this belongs to
        }
        
        // Check if current scene is collapsed
        const isSceneCollapsed = currentScene && collapsedScenes.has(currentScene);
        
        // Parts of scene-ending cues should hide when their scene is collapsed
        const isPartOfSceneEndCue = partNumber > 0 && cue.cue_number === sceneEndCueNumber;
        const isSceneEndPartCollapsed = isPartOfSceneEndCue && sceneEndSceneName && collapsedScenes.has(sceneEndSceneName);
        
        const shouldHide = isSceneCollapsed || isSceneEndPartCollapsed;
        
        if (shouldHide) {
            // Clear currentScene on scene_end so subsequent cues aren't collapsed
            if (isSceneEnd && partNumber === 0) {
                currentScene = '';
            }
            return;
        }
        
        // Get duration for this cue (only for main playback list cues, not parts)
        let durationDisplay = '';
        if (partNumber === 0 && cueListNum === mainPlaybackList) {
            const durationData = currentDurations[String(cue.cue_number)];
            durationDisplay = '--';
            if (durationData) {
                if (durationData.isActive && durationData.countdown !== null) {
                    durationDisplay = `<strong style="color: #4a90e2;">${formatDurationTime(durationData.countdown)}</strong>`;
                } else {
                    durationDisplay = formatDurationTime(durationData.duration);
                }
            }
        } else if (partNumber === 0 && cueListNum !== mainPlaybackList) {
            durationDisplay = '';
        }
        
        // Individual timing columns with delays
        const upTime = cue.up_time !== null && cue.up_time !== undefined ? cue.up_time : '';
        const downTime = cue.down_time !== null && cue.down_time !== undefined ? cue.down_time : '';
        const focusTime = cue.focus_time !== null && cue.focus_time !== undefined ? cue.focus_time : '';
        const colorTime = cue.color_time !== null && cue.color_time !== undefined ? cue.color_time : '';
        const beamTime = cue.beam_time !== null && cue.beam_time !== undefined ? cue.beam_time : '';
        
        // Get delays
        const upDelay = cue.up_delay || null;
        const downDelay = cue.down_delay || null;
        const focusDelay = cue.focus_delay || null;
        const colorDelay = cue.color_delay || null;
        const beamDelay = cue.beam_delay || null;
        
        // Format flags (Mark/Block/Assert)
        const mark = cue.mark || '';
        const block = cue.block || '';
        const assert = cue.assert || '';
        let flagsDisplay = '';
        if (mark) flagsDisplay += `<span class="flag flag-mark" title="Mark">M</span>`;
        if (block) flagsDisplay += `<span class="flag flag-block" title="Block">B</span>`;
        if (assert) flagsDisplay += `<span class="flag flag-assert" title="Assert">A</span>`;
        
        // Follow/Hang display (only show for main cues, not parts)
        const followHang = partNumber === 0 ? (cue.follow_hang || '') : '';
        
        // Part indicator - show for main cue (part 0) with parts
        // For actual parts (part > 0), we show the part number in cue column
        const partCount = cue.part_count || 0;
        const partIndicator = (partNumber === 0 && partCount > 0) ? `<span class="part-indicator" title="${partCount} parts">P${partCount}</span>` : '';
        
        // Display cue number differently for parts: just P1, P2, etc.
        const cueDisplayNumber = partNumber > 0 
            ? `<span class="part-cue-number">P${partNumber}</span>`
            : `${cue.cue_number}`;
        
        // Check if this cue is part of a scene (either in current scene or part of scene-end cue)
        const isPartOfSceneEnd = sceneEndSceneName && cue.cue_number === sceneEndCueNumber;
        const isInScene = currentScene || isPartOfSceneEnd;
        
        // Get the scene color for this row
        const rowSceneColor = currentScene ? currentSceneColor : (isPartOfSceneEnd ? getSceneInfo(sceneEndSceneName)?.color || '#4a90e2' : null);
        
        // Set row color as CSS variable for full-row highlighting and scene line
        let styleVars = [];
        if (color !== '#ffffff') styleVars.push(`--row-color: ${color}`);
        if (isInScene && rowSceneColor) styleVars.push(`--scene-color: ${rowSceneColor}`);
        const colorStyle = styleVars.length > 0 ? `style="${styleVars.join('; ')};"` : '';
        const colorAttr = color !== '#ffffff' ? `data-color="${color}"` : '';
        
        // Add active/pending classes
        let rowClasses = [];
        if (isExpanded) rowClasses.push('expanded-row');
        if (isActive) rowClasses.push('active-cue');
        if (isPending) rowClasses.push('pending-cue');
        if (partNumber > 0) rowClasses.push('cue-part');
        if (isInScene) rowClasses.push('in-scene');
        const classAttr = rowClasses.length > 0 ? `class="${rowClasses.join(' ')}"` : '';
        
        // Page field (user-editable)
        const page = cue.page || '';
        
        // Indent indicator: auto-follow shows arrow, parts get invisible spacer
        // Scene cues don't get indented - scene headers stick out to the left instead
        let indentIndicator = '';
        if (wasAutoTriggered) {
            indentIndicator = '<span class="indent-arrow">⤷</span>';
        } else if (partNumber > 0) {
            indentIndicator = '<span class="indent-spacer"></span>';
        }
        
        html += `<tr ${colorAttr} ${colorStyle} ${classAttr} onclick="toggleCueEdit('${cue.cue_number}', ${partNumber})">`;
        html += `<td><span class="cue-number-cell">${indentIndicator}${partNumber > 0 ? cueDisplayNumber : renderCueNumberWithColor(cue.cue_number, color)}${partIndicator}</span></td>`;
        html += `<td><span class="cue-label">${escapeHtml(cue.label || '')}</span></td>`;
        html += `<td class="time-cell">${formatTimeWithDelay(upTime, upDelay)}</td>`;
        html += `<td class="time-cell">${formatTimeWithDelay(downTime, downDelay)}</td>`;
        html += `<td class="time-cell">${formatTimeWithDelay(focusTime, focusDelay)}</td>`;
        html += `<td class="time-cell">${formatTimeWithDelay(colorTime, colorDelay)}</td>`;
        html += `<td class="time-cell">${formatTimeWithDelay(beamTime, beamDelay)}</td>`;
        html += `<td class="flags-cell">${flagsDisplay || '<span class="dim">-</span>'}</td>`;
        html += `<td class="follow-hang-cell"><span class="follow-hang">${escapeHtml(followHang) || '<span class="dim">-</span>'}</span></td>`;
        html += `<td><span class="cue-duration" data-cue="${cue.cue_number}" data-list="${cueListNum}">${durationDisplay}</span></td>`;
        html += `<td>${renderTags(tags)}</td>`;
        html += `<td class="notes-preview" ${notes ? `data-notes="${escapeHtml(notes)}"` : ''}>${formatNotes(notes) || '<span style="color: #666;">Click to edit</span>'}</td>`;
        html += `<td class="page-cell" onclick="event.stopPropagation(); makePageEditable(this, '${cue.cue_number}', ${partNumber})">${page ? escapeHtml(page) : '<span class="dim">-</span>'}</td>`;
        html += '</tr>';
        
        // Expanded inline editor
        if (isExpanded) {
            html += `<tr class="inline-editor"><td colspan="${totalCols}" onclick="event.stopPropagation();">`;
            html += renderInlineEditor(cue);
            html += `</td></tr>`;
        }
        
        // Clear currentScene after a scene_end cue so subsequent cues aren't collapsed with this scene
        if (isSceneEnd) {
            currentScene = '';
        }
      } catch (err) {
        console.error('Error rendering cue', cue.cue_number, 'at index', index, ':', err);
      }
    });
    
    html += '</tbody></table>';
    cueListElement.innerHTML = html;
    
    // Update the active/pending cue notes panel
    updateActiveCueNotesPanel();
    // Update scene and page dropdowns
    updateSceneDropdown();
    updatePageDropdown();
}

// Helper function to format time with optional delay
function formatTimeWithDelay(time, delay) {
    if (time === '' || time === null || time === undefined) {
        return '<span class="dim">-</span>';
    }
    if (delay !== null && delay > 0) {
        return `<span class="time-with-delay"><span class="delay-indicator" title="${delay}s delay">D${delay}</span><span class="time-value">${time}</span></span>`;
    }
    return `<span class="time-value">${time}</span>`;
}

// Helper function to format duration time as minutes:seconds.X
function formatDurationTime(seconds) {
    if (seconds === null || seconds === undefined || seconds < 0) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${secs.padStart(4, '0')}`;
}

function makePageEditable(cell, cueNumber, partNumber) {
    const cueKey = partNumber > 0 ? `${cueNumber}/${partNumber}` : cueNumber;
    const cue = cueData.find(c => {
        const key = (c.part_number || 0) > 0 ? `${c.cue_number}/${c.part_number}` : c.cue_number;
        return key === cueKey;
    });
    const currentPage = cue?.page || '';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentPage;
    input.className = 'page-input';
    input.placeholder = 'Page';
    input.onclick = (e) => e.stopPropagation();
    
    const savePage = async (moveToNext = null) => {
        const newPage = input.value.trim();
        try {
            await fetch(`/api/cues/${encodeURIComponent(cueNumber)}/page`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: newPage, part_number: partNumber })
            });
            if (cue) cue.page = newPage;
            cell.innerHTML = newPage ? escapeHtml(newPage) : '<span class="dim">-</span>';
            updatePageDropdown();
            
            if (moveToNext !== null) {
                moveToAdjacentPageCell(cell, moveToNext);
            }
        } catch (err) {
            console.error('Failed to save page:', err);
            cell.innerHTML = currentPage ? escapeHtml(currentPage) : '<span class="dim">-</span>';
        }
    };
    
    let navigating = false;
    input.onblur = () => { if (!navigating) savePage(); };
    input.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowDown') {
            e.preventDefault();
            navigating = true;
            savePage(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            navigating = true;
            savePage(-1);
        } else if (e.key === 'Escape') {
            cell.innerHTML = currentPage ? escapeHtml(currentPage) : '<span class="dim">-</span>';
        }
    };
    
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();
}

function moveToAdjacentPageCell(currentCell, direction) {
    const allPageCells = Array.from(document.querySelectorAll('.page-cell'));
    const currentIndex = allPageCells.indexOf(currentCell);
    const nextIndex = currentIndex + direction;
    
    if (nextIndex >= 0 && nextIndex < allPageCells.length) {
        const nextCell = allPageCells[nextIndex];
        nextCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => nextCell.click(), 100);
    }
}

function renderCueNumberWithColor(cueNumber, color) {
    return `<span class="cue-number">${cueNumber}</span>`;
}

// Format notes with simple markdown-like syntax
// *text* = bold, _text_ = italic, ~text~ = strikethrough
function formatNotes(notes) {
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

function renderInlineEditor(cue) {
    const color = cue.color || '#ffffff';
    const notes = cue.notes || '';
    const tags = cue.tags || [];
    const partNum = cue.part_number || 0;
    const cueKey = partNum > 0 ? `${cue.cue_number}/${partNum}` : cue.cue_number;
    
    let html = '<div class="inline-edit-container">';
    
    // Close button
    html += `<button class="editor-close-btn" onclick="event.stopPropagation(); closeEditor()" title="Close">×</button>`;
    
    // Color selector
    html += '<div class="edit-section">';
    html += '<label class="edit-label">Color:</label>';
    html += '<div class="color-picker-grid">';
    PRESET_COLORS.forEach(preset => {
        const isSelected = preset.value === color;
        html += `<div class="color-option ${isSelected ? 'selected' : ''}" 
                     style="background: ${preset.value};"
                     title="${preset.name}"
                     onclick="setCueColor('${cue.cue_number}', '${preset.value}')">
                    ${isSelected ? '✓' : ''}
                 </div>`;
    });
    html += '</div></div>';
    
    // Tags selector
    html += '<div class="edit-section">';
    html += '<label class="edit-label">Tags:</label>';
    html += '<div class="tag-selector">';
    
    // Show predefined tags
    const allAvailableTags = [...new Set([...PREDEFINED_TAGS, ...allTags])];
    allAvailableTags.forEach(tag => {
        const isSelected = tags.includes(tag);
        // Use data attributes to avoid escaping issues in onclick handlers
        // Don't escape cue_number - it's a number, not user input
        html += `<span class="tag-option ${isSelected ? 'selected' : ''}" 
                     data-cue="${cue.cue_number}"
                     data-tag="${escapeHtml(tag)}"
                     onclick="toggleCueTagFromElement(this)">
                    ${escapeHtml(tag)}
                 </span>`;
    });
    
    html += '</div>';
    html += '<div class="new-tag-input">';
    html += `<input type="text" id="newTag_${cue.cue_number}" placeholder="New tag..." onkeypress="if(event.key==='Enter') addNewCueTag('${cue.cue_number}')">`;
    html += `<button class="button" style="padding: 8px 16px;" onclick="addNewCueTag('${cue.cue_number}')">+ Add</button>`;
    html += '</div>';
    html += '</div>';
    
    // Notes editor with auto-save
    // Properly escape notes for textarea HTML context
    // Escape & first, then < and >, to preserve HTML entities correctly
    const safeNotes = notes
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    html += '<div class="edit-section">';
    html += '<label class="edit-label">Notes:</label>';
    html += `<textarea id="notes_${cue.cue_number}" class="inline-notes-area" placeholder="Add notes here..." onblur="saveCueNotes('${cue.cue_number}', ${partNum})">${safeNotes}</textarea>`;
    html += '<span class="auto-save-hint">Auto-saves on click away &bull; Formatting: *bold* &nbsp; _italic_ &nbsp; ~strikethrough~</span>';
    html += '</div>';
    
    html += '</div>';
    return html;
}

function renderTags(tags) {
    if (!tags || tags.length === 0) {
        return '<span style="color: #666; font-size: 12px;">No tags</span>';
    }
    
    return tags.map(tag => `<span class="tag-badge">${escapeHtml(tag)}</span>`).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function decodeHtmlEntities(text) {
    const div = document.createElement('div');
    div.innerHTML = text;
    return div.textContent || div.innerText || '';
}

function getFilteredCues() {
    let filtered = cueData.filter(cue => parseInt(cue.cue_list || '1') >= 0);
    
    if (selectedCueList !== 'all') {
        filtered = filtered.filter(cue => String(cue.cue_list || '1') === String(selectedCueList));
    }
    
    // Filter by active tag filters
    if (activeFilters.size > 0) {
        filtered = filtered.filter(cue => {
            if (!cue.tags || cue.tags.length === 0) return false;
            return Array.from(activeFilters).some(filter => cue.tags.includes(filter));
        });
    }
    
    return filtered;
}

function selectCueList(listValue) {
    selectedCueList = listValue;
    displayCueList();
}

function populateCueListSelector() {
    const select = document.getElementById('cueListSelect');
    if (!select) return;
    
    const lists = new Set();
    cueData.forEach(cue => {
        const listNum = String(cue.cue_list || '1');
        if (parseInt(listNum) >= 0) {
            lists.add(listNum);
        }
    });
    
    const sortedLists = Array.from(lists).sort((a, b) => parseInt(a) - parseInt(b));
    
    // Only show selector if there are multiple lists
    if (sortedLists.length <= 1) {
        select.style.display = 'none';
        selectedCueList = 'all';
        return;
    }
    
    select.style.display = '';
    
    // Validate selectedCueList is still valid
    if (selectedCueList !== 'all' && !sortedLists.includes(selectedCueList)) {
        selectedCueList = 'all';
    }
    
    select.innerHTML = '<option value="all">📋 All Lists</option>';
    sortedLists.forEach(list => {
        const option = document.createElement('option');
        option.value = list;
        option.textContent = `📋 List ${list}`;
        if (selectedCueList === list) option.selected = true;
        select.appendChild(option);
    });
    
    // Ensure selected value matches
    select.value = selectedCueList;
}

// Tag filtering
function updateTagFilters() {
    const filterSection = document.getElementById('filterSection');
    const tagFiltersContainer = document.getElementById('tagFilters');
    
    if (allTags.length === 0) {
        filterSection.style.display = 'none';
        return;
    }
    
    filterSection.style.display = 'block';
    
    tagFiltersContainer.innerHTML = allTags.map(tag => {
        const isActive = activeFilters.has(tag);
        // Use data attributes to avoid escaping issues
        return `<span class="tag-filter ${isActive ? 'active' : ''}" data-tag="${escapeHtml(tag)}" onclick="toggleFilterFromElement(this)">${escapeHtml(tag)}</span>`;
    }).join('');
}

// Helper function to toggle filter from data attributes (safe for special characters)
function toggleFilterFromElement(element) {
    // Decode the tag from HTML entities
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = element.getAttribute('data-tag');
    const tag = tempDiv.textContent;
    toggleFilter(tag);
}

function toggleFilter(tag) {
    if (activeFilters.has(tag)) {
        activeFilters.delete(tag);
    } else {
        activeFilters.add(tag);
    }
    
    updateTagFilters();
    displayCueList();
}

function clearFilters() {
    activeFilters.clear();
    updateTagFilters();
    displayCueList();
}

// Inline cue editing functions
function toggleCueEdit(cueNumber, partNumber = 0) {
    // Create unique key for cue+part to support expanding parts separately
    const cueKey = partNumber > 0 ? `${cueNumber}/${partNumber}` : cueNumber;
    if (expandedCueNumber === cueKey) {
        expandedCueNumber = null;
    } else {
        expandedCueNumber = cueKey;
    }
    displayCueList();
}

async function setCueColor(cueNumber, color) {
    try {
        await fetch(`/api/cues/${cueNumber}/color`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ color })
        });
        
        // Update local data
        const cue = cueData.find(c => c.cue_number === cueNumber);
        if (cue) {
            cue.color = color;
        }
        
        displayCueList();
    } catch (error) {
        console.error('Error setting color:', error.message || error);
        alert('Error setting color');
    }
}

// Helper function to toggle tag from data attributes (safe for special characters)
function toggleCueTagFromElement(element) {
    const cueNumber = element.getAttribute('data-cue');
    // Decode the tag from HTML entities
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = element.getAttribute('data-tag');
    const tag = tempDiv.textContent;
    toggleCueTag(cueNumber, tag);
}

async function toggleCueTag(cueNumber, tag) {
    const cue = cueData.find(c => c.cue_number === cueNumber);
    if (!cue) return;
    
    const tags = cue.tags || [];
    const index = tags.indexOf(tag);
    
    let newTags;
    if (index > -1) {
        // Remove tag
        newTags = tags.filter(t => t !== tag);
    } else {
        // Add tag
        newTags = [...tags, tag];
    }
    
    try {
        // Remember expanded state
        const wasExpanded = expandedCueNumber;
        
        await fetch(`/api/cues/${cueNumber}/tags`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ tags: newTags })
        });
        
        // Update local data
        cue.tags = newTags;
        
        // Reload to update filters but preserve expanded state
        expandedCueNumber = wasExpanded;
        loadCues();
    } catch (error) {
        console.error('Error toggling tag:', error.message || error);
        alert('Error updating tag');
    }
}

async function addNewCueTag(cueNumber) {
    const input = document.getElementById(`newTag_${cueNumber}`);
    const tag = input.value.trim();
    
    if (!tag) return;
    
    const cue = cueData.find(c => c.cue_number === cueNumber);
    if (!cue) return;
    
    const tags = cue.tags || [];
    if (tags.includes(tag)) {
        alert('Tag already exists');
        return;
    }
    
    const newTags = [...tags, tag];
    
    try {
        // Remember expanded state
        const wasExpanded = expandedCueNumber;
        
        await fetch(`/api/cues/${cueNumber}/tags`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ tags: newTags })
        });
        
        // Update local data
        cue.tags = newTags;
        input.value = '';
        
        // Reload to update filters but preserve expanded state
        expandedCueNumber = wasExpanded;
        loadCues();
    } catch (error) {
        console.error('Error adding tag:', error.message || error);
        alert('Error adding tag');
    }
}

function closeEditor() {
    expandedCueNumber = null;
    displayCueList();
}

async function saveCueNotes(cueNumber, partNumber = 0) {
    const textarea = document.getElementById(`notes_${cueNumber}`);
    if (!textarea) return;
    const notes = textarea.value;
    
    try {
        // Remember expanded state
        const wasExpanded = expandedCueNumber;
        
        await fetch(`/api/cues/${cueNumber}/notes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ notes })
        });
        
        // Update local data
        const cue = cueData.find(c => c.cue_number === cueNumber);
        if (cue) {
            cue.notes = notes;
        }
        
        // Silently saved - no alert
        // Preserve expanded state after save
        expandedCueNumber = wasExpanded;
    } catch (error) {
        console.error('Error saving notes:', error.message || error);
        alert('Error saving notes');
    }
}

// Show notes functions
async function loadShowNotes() {
    try {
        const response = await fetch('/api/show-notes');
        const result = await response.json();
        document.getElementById('showNotesText').value = result.notes || '';
    } catch (error) {
        console.error('Error loading show notes:', error.message || error);
    }
}

async function saveShowNotes() {
    try {
        const notes = document.getElementById('showNotesText').value;
        
        const response = await fetch('/api/show-notes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ notes })
        });
        
        if (response.ok) {
            alert('Show notes saved successfully!');
        } else {
            alert('Error saving show notes');
        }
    } catch (error) {
        console.error('Error saving show notes:', error.message || error);
        alert('Error saving show notes');
    }
}

function exportPDF() {
    window.open('/api/export-html', '_blank');
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('cueEditModal');
    if (event.target == modal) {
        closeCueModal();
    }
}

// Show Timer Functions
async function loadShowTimings() {
    try {
        const response = await fetch('/api/show-timings');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        showTimerState = await response.json();
        
        if (!showTimerState || typeof showTimerState !== 'object') {
            showTimerState = { isRecording: false, cueTimings: [] };
        }
        
        // Ensure cueTimings is an array
        if (!showTimerState.cueTimings) {
            showTimerState.cueTimings = [];
        }
        
        updateShowTimerUI();
        
        // Show timer display if connected or if we have recorded timings
        const timerEl = document.getElementById('showTimerDisplay');
        if (timerEl && (connectedToEOS || (showTimerState.cueTimings && showTimerState.cueTimings.length > 0) || showTimerState.isRecording)) {
            timerEl.style.display = 'block';
        }
        
        if (showTimerState.cueTimings && showTimerState.cueTimings.length > 0) {
            const durations = {};
            showTimerState.cueTimings.forEach(timing => {
                const key = String(timing.cueNumber);
                durations[key] = {
                    duration: timing.timeFromPrevious || 0,
                    countdown: null,
                    isActive: false
                };
            });
            currentDurations = durations;
            const durationKeys = Object.keys(durations);
            const cueKeys = cueData.map(c => String(c.cue_number));
            const matchCount = cueKeys.filter(k => durations[k] !== undefined).length;
            console.log(`⏱️ Loaded ${durationKeys.length} durations, ${matchCount}/${cueKeys.length} cues match`);
            
            displayCueList();
            startCountdownUpdates();
        } else if (showTimerState.isRecording) {
            console.log('⏱️ Recording active but no timings yet - starting countdown poll');
            startCountdownUpdates();
        } else {
            console.log('⏱️ No cue timings found in showTimerState');
        }
    } catch (error) {
        console.error('Error loading show timings:', error.message || error);
        showTimerState = { isRecording: false, cueTimings: [] };
    }
}

function updateShowTimerUI() {
    const btn = document.getElementById('timerControlBtn');
    
    if (!showTimerState) return;
    if (!btn) return; // Guard against element not existing
    
    if (showTimerState.isRecording) {
        btn.innerHTML = '⏹️ Stop Recording';
        btn.classList.remove('primary');
        btn.classList.add('danger');
    } else {
        btn.innerHTML = '▶️ Start Recording';
        btn.classList.remove('danger');
        btn.classList.add('primary');
    }
    
    // Also update floating panel recording state
    updatePanelRecordingState();
}

async function toggleShowTimerRecording() {
    try {
        const endpoint = showTimerState.isRecording ? '/api/show-timings/stop' : '/api/show-timings/start';
        
        const response = await fetch(endpoint, { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            showTimerState.isRecording = !showTimerState.isRecording;
            updateShowTimerUI();
            updatePanelRecordingState();
            
            if (!showTimerState.isRecording) {
                // Stopped recording - start countdown updates
                await loadShowTimings();
                const count = result.timings && result.timings.cueTimings ? result.timings.cueTimings.length : 0;
                if (count === 0) {
                    showToast('Recording stopped. No cues were recorded - make sure you are connected to EOS and fire cues while recording.');
                } else {
                    showToast(`Recording stopped. Recorded ${count} cue${count !== 1 ? 's' : ''}.`);
                }
            } else {
                // Started recording - stop countdown updates
                stopCountdownUpdates();
                const timerEl = document.getElementById('timerCountdowns');
                if (timerEl) timerEl.innerHTML = '⏺️ Recording...';
                if (!result.oscConnected) {
                    showToast('Recording started - Note: Not connected to EOS! Connect first to record cue timings.');
                } else {
                    showToast('Recording started - fire cues on the console to record timings');
                }
            }
        }
    } catch (error) {
        console.error('Error toggling timer:', error.message || error);
        showToast('Error toggling show timer');
    }
}

async function clearShowTimings() {
    if (!confirm('Clear all recorded show timings? This cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch('/api/show-timings/clear', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            loadShowTimings();
            stopCountdownUpdates();
            const timerEl = document.getElementById('timerCountdowns');
            if (timerEl) timerEl.innerHTML = '';
            alert('Show timings cleared');
        }
    } catch (error) {
        console.error('Error clearing timings:', error.message || error);
        alert('Error clearing show timings');
    }
}

function startCountdownUpdates() {
    stopCountdownUpdates(); // Clear any existing interval
    
    countdownInterval = setInterval(async () => {
        try {
            const response = await fetch('/api/show-timings/countdown');
            const data = await response.json();
            
            if (!data.hasTimings) {
                const timerEl = document.getElementById('timerCountdowns');
                if (timerEl) timerEl.innerHTML = '';
                updateCueDurations({}, true);
                return;
            }
            
            // Format time as MM:SS or HH:MM:SS
            const formatTime = (seconds) => {
                if (seconds === null || seconds < 0) return '--';
                const hrs = Math.floor(seconds / 3600);
                const mins = Math.floor((seconds % 3600) / 60);
                const secs = Math.floor(seconds % 60);
                
                if (hrs > 0) {
                    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                } else {
                    return `${mins}:${secs.toString().padStart(2, '0')}`;
                }
            };
            
            // Always update cue duration displays when we have timings
            updateCueDurations(data.cueDurations || {});
            
            // Update header countdowns
            let html = '';
            
            if (data.isPlaying) {
                // Show live countdowns when playing
                if (data.timeToNext !== null) {
                    html += `<div>⏭️ Next cue in: <strong>${formatTime(data.timeToNext)}</strong></div>`;
                }
                
                if (data.estimatedTimeRemaining !== null) {
                    html += `<div>🎭 Show ends in: <strong>${formatTime(data.estimatedTimeRemaining)}</strong></div>`;
                }
            } else {
                // Show status when not playing but have timings
                html += `<div style="color: #888; font-size: 13px;">Waiting for active cue...</div>`;
            }
            
            // Always show total duration when timings exist
            if (data.totalShowTime) {
                html += `<div style="margin-top: 8px; font-size: 12px; color: #888;">Total: ${formatTime(data.totalShowTime)}</div>`;
            }
            
            const timerEl = document.getElementById('timerCountdowns');
            if (timerEl) timerEl.innerHTML = html;
            
        } catch (error) {
            console.error('Error updating countdown:', error.message || error);
        }
    }, 1000); // Update every second
}

function updateCueDurations(cueDurations, forceReplace) {
    if (!cueDurations) return;
    const newKeyCount = Object.keys(cueDurations).length;
    if (forceReplace) {
        currentDurations = cueDurations;
    } else if (newKeyCount > 0) {
        currentDurations = cueDurations;
    }
    
    const cells = document.querySelectorAll('.cue-duration');
    cells.forEach(cell => {
        const cueNumber = String(cell.getAttribute('data-cue'));
        const listNumber = String(cell.getAttribute('data-list')); // Liste abrufen
        
        // WICHTIG: Nur aktualisieren, wenn es die Hauptliste ist!
        // Ghost-Timing Fix: Verhindert, dass Zeiten in Liste 2 angezeigt werden
        if (listNumber !== mainPlaybackList) return;

        const data = currentDurations[cueNumber];
        
        if (data) {
            if (data.isActive && data.countdown !== null) {
                cell.innerHTML = `<strong style="color: #4a90e2;">${formatDurationTime(data.countdown)}</strong>`;
            } else {
                cell.textContent = formatDurationTime(data.duration);
            }
        } else if (forceReplace) {
            cell.textContent = '--';
        }
    });
}

function stopCountdownUpdates() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}

// Show timer controls when connection status changes
function updateShowTimerVisibility() {
    if (connectedToEOS) {
        document.getElementById('showTimerDisplay').style.display = 'block';
        loadShowTimings();
    } else {
        document.getElementById('showTimerDisplay').style.display = 'none';
        stopCountdownUpdates();
    }
}

// Timings Editor Functions
let editableTimings = [];

async function showTimingsEditor() {
    try {
        const response = await fetch('/api/show-timings');
        const timings = await response.json();
        
        const contentDiv = document.getElementById('timingsEditorContent');
        
        if (!timings.cueTimings || timings.cueTimings.length === 0) {
            contentDiv.innerHTML = `
                <p style="color: #888;">No timings recorded yet.</p>
                <p style="color: #666; font-size: 12px;">To record timings: Connect to EOS, click "Start Recording", run through the show firing cues, then click "Stop Recording".</p>
            `;
            editableTimings = [];
        } else {
            editableTimings = timings.cueTimings.map(t => ({ ...t }));
            
            let html = '<table style="width: 100%; border-collapse: collapse;">';
            html += '<thead><tr style="border-bottom: 1px solid #444;">';
            html += '<th style="text-align: left; padding: 8px; color: #888;">Cue</th>';
            html += '<th style="text-align: left; padding: 8px; color: #888;">Label</th>';
            html += '<th style="text-align: right; padding: 8px; color: #888;">Time from Previous (sec)</th>';
            html += '</tr></thead>';
            html += '<tbody>';
            
            editableTimings.forEach((timing, index) => {
                html += `<tr style="border-bottom: 1px solid #333;">`;
                html += `<td style="padding: 8px; color: #fff;">${escapeHtml(timing.cueNumber)}</td>`;
                html += `<td style="padding: 8px; color: #aaa;">${escapeHtml(timing.label || '')}</td>`;
                html += `<td style="padding: 8px; text-align: right;">
                    <input type="number" step="0.1" min="0" value="${timing.timeFromPrevious.toFixed(1)}" 
                           onchange="updateEditableTiming(${index}, this.value)"
                           style="width: 80px; padding: 6px; background: #2a2a2a; border: 1px solid #444; border-radius: 4px; color: #fff; text-align: right;">
                </td>`;
                html += '</tr>';
            });
            
            html += '</tbody></table>';
            contentDiv.innerHTML = html;
        }
        
        document.getElementById('timingsEditorModal').style.display = 'block';
    } catch (error) {
        console.error('Error loading timings for editor:', error.message || error);
        alert('Error loading timings');
    }
}

function updateEditableTiming(index, value) {
    const newValue = parseFloat(value) || 0;
    editableTimings[index].timeFromPrevious = newValue;
    
    // Recalculate timestamps based on cumulative times
    let cumulative = 0;
    editableTimings.forEach((timing, i) => {
        cumulative += timing.timeFromPrevious;
        timing.timestamp = cumulative;
    });
}

async function saveTimingsEdits() {
    if (editableTimings.length === 0) {
        closeTimingsEditor();
        return;
    }
    
    try {
        const response = await fetch('/api/show-timings/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cueTimings: editableTimings })
        });
        
        const result = await response.json();
        if (result.success) {
            closeTimingsEditor();
            loadShowTimings();
            alert('Timings updated successfully');
        } else {
            alert('Error saving timings: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving timings:', error.message || error);
        alert('Error saving timings');
    }
}

function closeTimingsEditor() {
    document.getElementById('timingsEditorModal').style.display = 'none';
    editableTimings = [];
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

// Scene data management
async function loadSceneData() {
    try {
        const response = await fetch('/api/scene-data');
        if (response.ok) {
            sceneData = await response.json();
        }
    } catch (error) {
        console.error('Error loading scene data:', error.message || error);
        sceneData = {};
    }
}

async function saveSceneData() {
    try {
        await fetch('/api/scene-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sceneData)
        });
    } catch (error) {
        console.error('Error saving scene data:', error.message || error);
    }
}

function getSceneInfo(sceneName) {
    return sceneData[sceneName] || { notes: '', color: '#ffffff' };
}

function toggleSceneCollapse(sceneName) {
    const decodedScene = decodeHtmlEntities(sceneName);
    if (collapsedScenes.has(decodedScene)) {
        collapsedScenes.delete(decodedScene);
    } else {
        collapsedScenes.add(decodedScene);
    }
    displayCueList();
}

function expandAllScenes() {
    collapsedScenes.clear();
    displayCueList();
}

function collapseAllScenes() {
    const scenes = [...new Set(cueData.filter(c => c.scene).map(c => c.scene))];
    scenes.forEach(s => collapsedScenes.add(s));
    displayCueList();
}

function updateSceneNotes(sceneName, notes) {
    if (!sceneData[sceneName]) {
        sceneData[sceneName] = { notes: '', color: '#4CAF50' };
    }
    sceneData[sceneName].notes = notes;
    saveSceneData();
}

function updateSceneColor(sceneName, color) {
    if (!sceneData[sceneName]) {
        sceneData[sceneName] = { notes: '', color: '#4CAF50' };
    }
    sceneData[sceneName].color = color;
    saveSceneData();
    displayCueList();
}

function getSceneBounds() {
    const bounds = {};
    let currentScene = null;
    let sceneStart = null;
    
    cueData.forEach((cue, index) => {
        const scene = cue.scene || '';
        const isSceneEnd = cue.scene_end === true;
        
        // A cue with a scene label starts a new scene
        if (scene && scene !== currentScene) {
            // Close previous scene if exists
            if (currentScene && sceneStart !== null) {
                bounds[currentScene] = { start: sceneStart, end: index - 1 };
            }
            currentScene = scene;
            sceneStart = index;
        }
        
        // A cue with scene_end=true ends the current scene at this cue
        if (isSceneEnd && currentScene && sceneStart !== null) {
            bounds[currentScene] = { start: sceneStart, end: index };
            currentScene = null;
            sceneStart = null;
        }
    });
    
    // Close any remaining open scene at the end
    if (currentScene && sceneStart !== null) {
        bounds[currentScene] = { start: sceneStart, end: cueData.length - 1 };
    }
    
    return bounds;
}

// Tag-to-color linking
async function loadTagColorMappings() {
    try {
        const response = await fetch('/api/tag-colors');
        if (response.ok) {
            tagColorMappings = await response.json();
        }
    } catch (error) {
        console.error('Error loading tag colors:', error.message || error);
    }
}

async function saveTagColorMapping(tag, color) {
    tagColorMappings[tag] = color;
    try {
        await fetch('/api/tag-colors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tagColorMappings)
        });
    } catch (error) {
        console.error('Error saving tag color:', error.message || error);
    }
}

function getColorForTags(tags) {
    if (!tags || tags.length === 0) return null;
    for (const tag of tags) {
        if (tagColorMappings[tag]) {
            return tagColorMappings[tag];
        }
    }
    return null;
}

// Duration calculator (cue-to-cue only - scene durations shown in scene headers)
function showDurationCalculator() {
    const modal = document.getElementById('durationCalcModal');
    modal.style.display = 'flex';
    
    // Populate cue dropdowns
    const startSelect = document.getElementById('calcStartCue');
    const endSelect = document.getElementById('calcEndCue');
    
    startSelect.innerHTML = '<option value="">Select start cue...</option>';
    endSelect.innerHTML = '<option value="">Select end cue...</option>';
    
    const mainListCues = cueData.filter(c => String(c.cue_list || '1') === mainPlaybackList && !(c.part_number > 0));
    mainListCues.forEach(cue => {
        const opt1 = document.createElement('option');
        opt1.value = cue.cue_number;
        opt1.textContent = `Cue ${cue.cue_number} - ${cue.label || 'No label'}`;
        startSelect.appendChild(opt1);
        
        const opt2 = document.createElement('option');
        opt2.value = cue.cue_number;
        opt2.textContent = `Cue ${cue.cue_number} - ${cue.label || 'No label'}`;
        endSelect.appendChild(opt2);
    });
    
    // Hide scene dropdown (scene durations now shown in list)
    const sceneSelect = document.getElementById('calcScene');
    if (sceneSelect) {
        sceneSelect.parentElement.style.display = 'none';
    }
    
    document.getElementById('calcResult').innerHTML = '';
}

function closeDurationCalculator() {
    document.getElementById('durationCalcModal').style.display = 'none';
}

function calculateDuration() {
    const startCue = document.getElementById('calcStartCue').value;
    const endCue = document.getElementById('calcEndCue').value;
    const resultDiv = document.getElementById('calcResult');
    
    if (startCue && endCue) {
        const result = calculateCueDuration(startCue, endCue);
        let html = `<p><strong>Cue ${startCue} to ${endCue}</strong><br>Duration: <span style="color: #4caf50; font-size: 18px;">${result.duration}</span></p>`;
        if (result.missingCount > 0) {
            html += `<p style="color: #ffa726; font-size: 13px;">Note: ${result.missingCount} cue${result.missingCount > 1 ? 's' : ''} in range had no recorded time (counted as 0)</p>`;
        }
        resultDiv.innerHTML = html;
    } else {
        resultDiv.innerHTML = '<p style="color: #ffa726;">Select start and end cues</p>';
    }
}

function calculateCueDuration(startCueNum, endCueNum) {
    // Check if we have any recorded timings
    if (!showTimerState || !showTimerState.cueTimings || showTimerState.cueTimings.length === 0) {
        return { duration: 'No timing data available', missingCount: 0 };
    }
    
    // Find cues in range (main playback list only, no parts)
    const mainCues = cueData.filter(c => String(c.cue_list || '1') === mainPlaybackList && !(c.part_number > 0));
    const startIdx = mainCues.findIndex(c => c.cue_number === startCueNum);
    const endIdx = mainCues.findIndex(c => c.cue_number === endCueNum);
    
    if (startIdx === -1 || endIdx === -1) {
        return { duration: 'Invalid cue range', missingCount: 0 };
    }
    
    const fromIdx = Math.min(startIdx, endIdx);
    const toIdx = Math.max(startIdx, endIdx);
    const cuesInRange = mainCues.slice(fromIdx, toIdx + 1);
    
    // Count cues without timing data
    let missingCount = 0;
    let firstTimestamp = null;
    let lastTimestamp = null;
    
    for (const cue of cuesInRange) {
        const timing = showTimerState.cueTimings.find(t => t.cueNumber === cue.cue_number);
        if (timing) {
            if (firstTimestamp === null) {
                firstTimestamp = timing.timestamp;
            }
            lastTimestamp = timing.timestamp;
        } else {
            missingCount++;
        }
    }
    
    // Calculate duration from first to last recorded timestamp
    if (firstTimestamp !== null && lastTimestamp !== null) {
        const duration = Math.abs(lastTimestamp - firstTimestamp);
        return { duration: formatDurationTime(duration), missingCount };
    }
    
    return { duration: 'No timing data in range', missingCount };
}

// Tag color modal
function showTagColorModal() {
    const modal = document.getElementById('tagColorModal');
    modal.style.display = 'flex';
    renderTagColorContent();
}

function closeTagColorModal() {
    document.getElementById('tagColorModal').style.display = 'none';
}

function renderTagColorContent() {
    const contentDiv = document.getElementById('tagColorContent');
    const allAvailableTags = [...new Set([...PREDEFINED_TAGS, ...allTags])];
    
    if (allAvailableTags.length === 0) {
        contentDiv.innerHTML = '<p style="color: #666;">No tags defined yet. Add tags to cues first.</p>';
        return;
    }
    
    let html = '';
    allAvailableTags.forEach(tag => {
        const currentColor = tagColorMappings[tag] || '#ffffff';
        html += `<div class="tag-color-row">
            <span class="tag-name">${escapeHtml(tag)}</span>
            <select class="input" style="width: 150px;" onchange="updateTagColor('${escapeHtml(tag)}', this.value)">
                ${PRESET_COLORS.map(c => 
                    `<option value="${c.value}" ${currentColor === c.value ? 'selected' : ''}>${c.name}</option>`
                ).join('')}
            </select>
            <div class="color-swatch" style="background: ${currentColor};" id="swatch_${escapeHtml(tag).replace(/\s/g, '_')}"></div>
        </div>`;
    });
    
    html += `<div style="margin-top: 20px; display: flex; gap: 10px;">
        <button class="button primary" onclick="applyTagColorsToAll()">Apply to All Cues</button>
        <button class="button" onclick="closeTagColorModal()">Close</button>
    </div>`;
    
    contentDiv.innerHTML = html;
}

async function updateTagColor(tag, color) {
    tagColorMappings[tag] = color;
    const swatchId = `swatch_${tag.replace(/\s/g, '_')}`;
    const swatch = document.getElementById(swatchId);
    if (swatch) swatch.style.background = color;
    
    try {
        await fetch('/api/tag-colors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tagColorMappings)
        });
    } catch (error) {
        console.error('Error saving tag color:', error.message || error);
    }
}

async function applyTagColorsToAll() {
    let appliedCount = 0;
    
    for (const cue of cueData) {
        if (cue.tags && cue.tags.length > 0) {
            const tagColor = getColorForTags(cue.tags);
            if (tagColor && tagColor !== cue.color) {
                try {
                    await fetch(`/api/cue/${cue.cue_number}/color`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ color: tagColor })
                    });
                    cue.color = tagColor;
                    appliedCount++;
                } catch (error) {
                    console.error('Error applying color:', error.message || error);
                }
            }
        }
    }
    
    displayCueList();
    closeTagColorModal();
    showToast(`Applied colors to ${appliedCount} cues`);
}

async function showDiagnostics() {
    try {
        const response = await fetch('/api/debug');
        const serverDebug = await response.json();
        
        const durationKeys = Object.keys(currentDurations);
        const cueNumbers = cueData.map(c => c.cue_number);
        const matchingKeys = cueNumbers.filter(n => currentDurations[String(n)] !== undefined);
        const mainListCues = cueData.filter(c => String(c.cue_list || '1') === mainPlaybackList);
        const mainListMatching = mainListCues.filter(c => currentDurations[String(c.cue_number)] !== undefined);
        
        const info = {
            frontend: {
                mainPlaybackList,
                totalCues: cueData.length,
                mainListCues: mainListCues.length,
                durationEntries: durationKeys.length,
                durationKeySamples: durationKeys.slice(0, 5),
                cueNumberSamples: cueNumbers.slice(0, 5),
                matchingDurations: matchingKeys.length,
                mainListMatchingDurations: mainListMatching.length,
                countdownRunning: countdownInterval !== null,
                connectedToEOS,
                showTimerCueTimings: showTimerState?.cueTimings?.length || 0,
                activeCues: cueData.filter(c => c.last_seen === 'active').map(c => ({n: c.cue_number, l: c.cue_list})),
                pendingCues: cueData.filter(c => c.last_seen === 'pending').map(c => ({n: c.cue_number, l: c.cue_list}))
            },
            server: serverDebug
        };
        
        console.log('=== QNOTE DIAGNOSTICS ===', JSON.stringify(info, null, 2));
        
        let html = '<div style="max-height:70vh;overflow:auto;font-family:monospace;font-size:12px;white-space:pre-wrap;">';
        html += '<h3 style="color:#4a90e2;">Frontend State</h3>';
        html += `Main Playback List: ${mainPlaybackList}\n`;
        html += `Total Cues: ${cueData.length} | Main List Cues: ${mainListCues.length}\n`;
        html += `Duration Entries: ${durationKeys.length}\n`;
        html += `Duration Key Samples: ${durationKeys.slice(0, 8).join(', ') || 'NONE'}\n`;
        html += `Cue Number Samples: ${cueNumbers.slice(0, 8).join(', ') || 'NONE'}\n`;
        html += `<span style="color:${matchingKeys.length > 0 ? '#4caf50' : '#ff6b6b'};">Matching: ${matchingKeys.length}/${cueNumbers.length}</span>\n`;
        html += `<span style="color:${mainListMatching.length > 0 ? '#4caf50' : '#ff6b6b'};">Main List Matching: ${mainListMatching.length}/${mainListCues.length}</span>\n`;
        html += `Countdown Interval: ${countdownInterval !== null ? 'RUNNING' : 'STOPPED'}\n`;
        html += `Connected: ${connectedToEOS}\n`;
        html += `ShowTimer Timings: ${showTimerState?.cueTimings?.length || 0}\n`;
        html += `Active Cues: ${JSON.stringify(info.frontend.activeCues)}\n`;
        html += `Pending Cues: ${JSON.stringify(info.frontend.pendingCues)}\n`;
        
        html += '<h3 style="color:#4a90e2;">Server State</h3>';
        html += `Main Playback List: ${serverDebug.mainPlaybackList}\n`;
        html += `Known Cue Lists: ${JSON.stringify(serverDebug.knownCueLists)}\n`;
        html += `Total Cues: ${serverDebug.totalCues}\n`;
        html += `Timings Count: ${serverDebug.timingsCount}\n`;
        html += `Recording: ${serverDebug.isRecording}\n`;
        html += `Connected: ${serverDebug.isConnected}\n`;
        html += `Show: ${serverDebug.currentShowName}\n`;
        html += `EOS Show: ${serverDebug.connectedEOSShowName}\n`;
        html += `Active: ${JSON.stringify(serverDebug.activeCues)}\n`;
        html += `Pending: ${JSON.stringify(serverDebug.pendingCues)}\n`;
        
        if (serverDebug.keyComparison) {
            html += '<h3 style="color:#ffa726;">Key Comparison</h3>';
            html += `Cue Data Keys: ${JSON.stringify(serverDebug.keyComparison.cueDataKeys)}\n`;
            html += `Timing Keys:   ${JSON.stringify(serverDebug.keyComparison.timingKeys)}\n`;
            html += `<span style="color:${serverDebug.keyComparison.matchCount > 0 ? '#4caf50' : '#ff6b6b'};">Match Count: ${serverDebug.keyComparison.matchCount}</span>\n`;
        }
        
        html += '</div>';
        
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;';
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        const content = document.createElement('div');
        content.style.cssText = 'background:#1e1e1e;border:1px solid #444;border-radius:8px;padding:20px;max-width:700px;width:90%;color:#ccc;';
        content.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><h2 style="margin:0;color:#fff;">Diagnostics</h2><button onclick="this.closest(\'div[style*=fixed]\').remove()" style="background:#444;border:none;color:#fff;padding:5px 10px;border-radius:4px;cursor:pointer;">Close</button></div>' + html;
        modal.appendChild(content);
        document.body.appendChild(modal);
        
    } catch (error) {
        console.error('Diagnostics error:', error);
        alert('Diagnostics error: ' + error.message);
    }
}
