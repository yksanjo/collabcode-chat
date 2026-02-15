// CollabCode Chat - Pair Programming with Video

(function() {
    'use strict';

    const CURSOR_COLORS = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#dda0dd'];
    
    const DEFAULT_CODE = `// Welcome to CollabCode Chat!
// Pair program together in real-time.

// Write your code here
function pairProgram() {
    console.log("Happy coding!");
}

pairProgram();
`;

    const state = {
        userId: null,
        username: 'Anonymous',
        colorIndex: 0,
        roomId: null,
        partner: null,
        editor: null,
        localStream: null
    };

    const elements = {};

    function generateId(length = 6) {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    function showToast(message, type = 'info') {
        const container = elements.toastContainer;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle';
        toast.innerHTML = `<i class="fas fa-${icon}"></i> ${message}`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // BroadcastChannel
    let broadcastChannel = null;

    function initBroadcastChannel() {
        if (!state.roomId) return;
        try {
            broadcastChannel = new BroadcastChannel(`collabcode-chat-${state.roomId}`);
            broadcastChannel.onmessage = handleBroadcastMessage;
        } catch (e) {
            console.warn('BroadcastChannel not supported');
        }
    }

    function handleBroadcastMessage(event) {
        const msg = event.data;
        switch (msg.type) {
            case 'user-join':
                handleUserJoin(msg.userId, msg.username, msg.colorIndex);
                break;
            case 'code-change':
                handleCodeChange(msg.userId, msg.content);
                break;
            case 'cursor-move':
                handleCursorMove(msg.userId, msg.position, msg.username, msg.colorIndex);
                break;
            case 'chat-message':
                handleChatMessage(msg.username, msg.text, msg.isOwn);
                break;
            case 'video-start':
                handlePartnerVideoStart(msg.userId);
                break;
        }
    }

    function broadcast(type, data) {
        if (broadcastChannel) {
            broadcastChannel.postMessage({ type, ...data });
        }
    }

    // Monaco Editor
    function initMonacoEditor() {
        return new Promise((resolve) => {
            require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
            require(['vs/editor/editor.main'], function() {
                monaco.editor.defineTheme('chat-dark', {
                    base: 'vs-dark',
                    inherit: true,
                    rules: [],
                    colors: {
                        'editor.background': '#1e1e1e',
                        'editor.foreground': '#d4d4d4'
                    }
                });

                state.editor = monaco.editor.create(document.getElementById('monacoEditor'), {
                    value: DEFAULT_CODE,
                    language: 'javascript',
                    theme: 'chat-dark',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 14,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    wordWrap: 'on',
                    padding: { top: 10 }
                });

                state.editor.onDidChangeCursorPosition((e) => {
                    updateCursorPosition(e.position);
                    broadcastCursorPosition(e.position);
                });

                let debounceTimer = null;
                state.editor.onDidChangeModelContent(() => {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        broadcastCodeChange(state.editor.getValue());
                    }, 150);
                });

                resolve();
            });
        });
    }

    function updateCursorPosition(position) {
        elements.cursorPosition.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
    }

    function broadcastCursorPosition(position) {
        broadcast('cursor-move', {
            userId: state.userId,
            username: state.username,
            position: position,
            colorIndex: state.colorIndex
        });
    }

    function broadcastCodeChange(content) {
        broadcast('code-change', { userId: state.userId, content: content });
    }

    function handleCodeChange(userId, content) {
        if (userId === state.userId || !state.editor) return;
        const position = state.editor.getPosition();
        state.editor.setValue(content);
        if (position) state.editor.setPosition(position);
    }

    // Remote Cursors
    const remoteCursors = new Map();

    function handleCursorMove(userId, position, username, colorIndex) {
        if (userId === state.userId) return;
        
        let cursor = remoteCursors.get(userId);
        if (!cursor) {
            cursor = createRemoteCursor(userId, username, colorIndex);
            remoteCursors.set(userId, cursor);
        }
        updateRemoteCursorPosition(cursor, position);
    }

    function createRemoteCursor(userId, username, colorIndex) {
        const color = CURSOR_COLORS[colorIndex % CURSOR_COLORS.length];
        const cursor = document.createElement('div');
        cursor.className = 'remote-cursor';
        cursor.innerHTML = `
            <div class="remote-cursor-caret" style="background: ${color}"></div>
            <div class="remote-cursor-label" style="background: ${color}">${username}</div>
        `;
        document.getElementById('monacoEditor').appendChild(cursor);
        return { element: cursor, username, colorIndex };
    }

    function updateRemoteCursorPosition(cursor, position) {
        if (!state.editor) return;
        try {
            const coords = state.editor.getScrolledVisiblePosition({
                lineNumber: position.lineNumber,
                column: position.column
            });
            if (coords) {
                const editorRect = document.getElementById('monacoEditor').getBoundingClientRect();
                cursor.element.style.left = `${editorRect.left + coords.left}px`;
                cursor.element.style.top = `${editorRect.top + coords.top}px`;
            }
        } catch (e) {}
    }

    // Video
    async function initLocalVideo() {
        try {
            state.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = state.localStream;
            
            document.getElementById('startVideo').style.display = 'none';
            
            showToast('Camera and mic ready', 'success');
            
            // Notify partner
            broadcast('video-start', { userId: state.userId });
            
        } catch (error) {
            console.error('Error accessing media devices:', error);
            showToast('Could not access camera/mic', 'error');
        }
    }

    function handlePartnerVideoStart(userId) {
        const placeholder = document.getElementById('remoteVideoPlaceholder');
        placeholder.style.display = 'flex';
        showToast('Partner started video', 'info');
    }

    function toggleMic() {
        if (state.localStream) {
            const audioTrack = state.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                const btn = document.getElementById('toggleMic');
                btn.classList.toggle('muted', !audioTrack.enabled);
                btn.querySelector('i').className = audioTrack.enabled ? 'fa-microphone' : 'fa-microphone-slash';
            }
        }
    }

    function toggleCamera() {
        if (state.localStream) {
            const videoTrack = state.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                const btn = document.getElementById('toggleCamera');
                btn.classList.toggle('off', !videoTrack.enabled);
                btn.querySelector('i').className = videoTrack.enabled ? 'fa-video' : 'fa-video-slash';
            }
        }
    }

    // Chat
    function sendChatMessage() {
        const input = elements.chatInput;
        const text = input.value.trim();
        
        if (!text) return;
        
        handleChatMessage(state.username, text, true);
        broadcast('chat-message', { username: state.username, text, isOwn: false });
        
        input.value = '';
    }

    function handleChatMessage(username, text, isOwn) {
        const messages = elements.chatMessages;
        const message = document.createElement('div');
        message.className = `chat-message ${isOwn ? 'own' : ''}`;
        message.innerHTML = `
            <div class="chat-message-sender">${username}</div>
            <div class="chat-message-text">${escapeHtml(text)}</div>
        `;
        messages.appendChild(message);
        messages.scrollTop = messages.scrollHeight;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Partner
    function handleUserJoin(userId, username, colorIndex) {
        if (userId === state.userId) return;
        
        state.partner = { userId, username, colorIndex };
        
        // Add avatar
        const avatar = document.createElement('div');
        avatar.className = 'participant-avatar';
        avatar.style.backgroundColor = CURSOR_COLORS[colorIndex % CURSOR_COLORS.length];
        avatar.textContent = username.charAt(0).toUpperCase();
        avatar.title = username;
        elements.participants.appendChild(avatar);
        
        // Update status
        elements.partnerStatus.innerHTML = `<i class="fas fa-user-friends"></i> ${username}`;
        
        showToast(`${username} joined the session`, 'success');
    }

    function updateConnectionStatus(connected) {
        const dot = document.querySelector('.connection-status .status-dot');
        const text = document.querySelector('.connection-status .status-text');
        dot.className = `status-dot ${connected ? 'connected' : ''}`;
        text.textContent = connected ? 'Connected' : 'Offline';
    }

    // Room Management
    function createRoom() {
        state.roomId = generateId(8);
        state.userId = generateId();
        state.colorIndex = 0;
        
        const url = new URL(window.location);
        url.searchParams.set('room', state.roomId);
        window.history.pushState({}, '', url);
        
        initBroadcastChannel();
        
        const avatar = document.createElement('div');
        avatar.className = 'participant-avatar';
        avatar.style.backgroundColor = CURSOR_COLORS[0];
        avatar.textContent = state.username.charAt(0).toUpperCase();
        avatar.title = state.username;
        elements.participants.appendChild(avatar);
        
        elements.roomId.textContent = state.roomId;
        updateConnectionStatus(true);
        
        broadcast('user-join', { userId: state.userId, username: state.username, colorIndex: state.colorIndex });
        
        elements.welcomeModal.classList.add('hidden');
        showToast('Session created! Share the link.', 'success');
    }

    function joinRoom(roomCode) {
        if (!roomCode || roomCode.length < 4) {
            showToast('Invalid session code', 'error');
            return;
        }
        
        state.roomId = roomCode.trim().toLowerCase();
        state.userId = generateId();
        state.colorIndex = Math.floor(Math.random() * CURSOR_COLORS.length);
        
        const url = new URL(window.location);
        url.searchParams.set('room', state.roomId);
        window.history.pushState({}, '', url);
        
        initBroadcastChannel();
        
        const avatar = document.createElement('div');
        avatar.className = 'participant-avatar';
        avatar.style.backgroundColor = CURSOR_COLORS[state.colorIndex];
        avatar.textContent = state.username.charAt(0).toUpperCase();
        avatar.title = state.username;
        elements.participants.appendChild(avatar);
        
        elements.roomId.textContent = state.roomId;
        broadcast('user-join', { userId: state.userId, username: state.username, colorIndex: state.colorIndex });
        
        updateConnectionStatus(true);
        elements.welcomeModal.classList.add('hidden');
        showToast(`Joined session ${state.roomId}`, 'success');
    }

    function checkUrlForRoom() {
        const url = new URL(window.location);
        const roomCode = url.searchParams.get('room');
        if (roomCode) {
            elements.roomCodeInput.value = roomCode;
            return true;
        }
        return false;
    }

    // Event Listeners
    function initEventListeners() {
        document.getElementById('createRoom').addEventListener('click', () => {
            state.username = document.getElementById('usernameInput').value || 'Anonymous';
            createRoom();
        });

        document.getElementById('joinRoom').addEventListener('click', () => {
            state.username = document.getElementById('usernameInput').value || 'Anonymous';
            joinRoom(document.getElementById('roomCodeInput').value);
        });

        document.getElementById('copyRoomLink').addEventListener('click', () => {
            navigator.clipboard.writeText(window.location.href).then(() => {
                showToast('Link copied!', 'success');
            }).catch(() => showToast('Failed to copy', 'error'));
        });

        // Video
        document.getElementById('startVideo').addEventListener('click', initLocalVideo);
        document.getElementById('toggleMic').addEventListener('click', toggleMic);
        document.getElementById('toggleCamera').addEventListener('click', toggleCamera);

        // Chat
        document.getElementById('sendMessage').addEventListener('click', sendChatMessage);
        elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                showToast('Saved', 'success');
            }
        });
    }

    // Init
    async function init() {
        elements.welcomeModal = document.getElementById('welcomeModal');
        elements.roomId = document.getElementById('roomId');
        elements.participants = document.getElementById('participants');
        elements.cursorPosition = document.getElementById('cursorPosition');
        elements.languageMode = document.getElementById('languageMode');
        elements.partnerStatus = document.getElementById('partnerStatus');
        elements.chatMessages = document.getElementById('chatMessages');
        elements.chatInput = document.getElementById('chatInput');
        elements.toastContainer = document.getElementById('toastContainer');

        await initMonacoEditor();
        initEventListeners();
        
        if (checkUrlForRoom()) {
            elements.welcomeModal.classList.remove('hidden');
        }

        console.log('CollabCode Chat initialized');
    }

    document.addEventListener('DOMContentLoaded', init);
})();
