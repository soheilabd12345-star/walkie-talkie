/**
 * Walkie-Talkie PWA - P2P Communication
 * Uses WebRTC Data Channel + Audio Streaming
 */

class WalkieTalkieP2P {
    constructor() {
        // State
        this.username = '';
        this.roomCode = '';
        this.isHost = false;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordingSeconds = 0;
        this.recordingTimer = null;
        this.audioContext = null;
        
        // P2P
        this.peers = new Map(); // peerId -> { connection, dataChannel, username }
        this.peerId = this.generateId();
        
        // TryBug (free P2P signaling)
        this.useTryBug = true;
        this.tryBugRoom = null;
        
        // Init
        this.init();
    }
    
    init() {
        this.cacheDOM();
        this.bindEvents();
        this.hideSplash();
        this.checkInstallPrompt();
        this.registerSW();
    }
    
    cacheDOM() {
        this.screens = {
            splash: document.getElementById('splash-screen'),
            login: document.getElementById('login-screen'),
            walkie: document.getElementById('walkie-screen'),
        };
        
        this.el = {
            username: document.getElementById('username'),
            createRoomBtn: document.getElementById('create-room-btn'),
            inviteCode: document.getElementById('invite-code'),
            joinRoomBtn: document.getElementById('join-room-btn'),
            pasteBtn: document.getElementById('paste-btn'),
            roomCodeDisplay: document.getElementById('room-code-display'),
            shareBtn: document.getElementById('share-btn'),
            leaveBtn: document.getElementById('leave-btn'),
            connDot: document.getElementById('conn-dot'),
            connText: document.getElementById('conn-text'),
            peerCount: document.getElementById('peer-count'),
            messagesArea: document.getElementById('messages-area'),
            peersList: document.getElementById('peers-list'),
            pttBtn: document.getElementById('ptt-btn'),
            pttHint: document.getElementById('ptt-hint'),
            recTimer: document.getElementById('rec-timer'),
            toast: document.getElementById('toast'),
            installPrompt: document.getElementById('install-prompt'),
            installBtn: document.getElementById('install-btn'),
            dismissInstall: document.getElementById('dismiss-install'),
        };
    }
    
    bindEvents() {
        // Login
        this.el.username.addEventListener('input', () => this.validateLogin());
        this.el.inviteCode.addEventListener('input', () => this.validateLogin());
        this.el.createRoomBtn.addEventListener('click', () => this.createRoom());
        this.el.joinRoomBtn.addEventListener('click', () => this.joinRoom());
        this.el.pasteBtn.addEventListener('click', () => this.pasteFromClipboard());
        
        // Walkie
        this.el.shareBtn.addEventListener('click', () => this.shareRoom());
        this.el.leaveBtn.addEventListener('click', () => this.leaveRoom());
        
        // PTT
        this.el.pttBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.startRecording(); });
        this.el.pttBtn.addEventListener('pointerup', () => this.stopRecording());
        this.el.pttBtn.addEventListener('pointerleave', () => { if (this.isRecording) this.stopRecording(); });
        
        // Keyboard (for desktop)
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !e.target.matches('input')) {
                e.preventDefault();
                this.startRecording();
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.stopRecording();
            }
        });
        
        // Install
        this.el.installBtn.addEventListener('click', () => this.installPWA());
        this.el.dismissInstall.addEventListener('click', () => this.el.installPrompt.classList.remove('show'));
    }
    
    hideSplash() {
        setTimeout(() => {
            this.screens.splash.classList.remove('active');
            this.screens.login.classList.add('active');
        }, 1500);
    }
    
    validateLogin() {
        const hasName = this.el.username.value.trim().length >= 2;
        this.el.createRoomBtn.disabled = !hasName;
        
        const hasCode = this.el.inviteCode.value.trim().length === 6;
        this.el.joinRoomBtn.disabled = !hasName || !hasCode;
    }
    
    /* ===== Room Management ===== */
    createRoom() {
        this.username = this.el.username.value.trim();
        if (!this.username) return;
        
        this.isHost = true;
        this.roomCode = this.generateRoomCode();
        this.enterRoom();
    }
    
    joinRoom() {
        this.username = this.el.username.value.trim();
        const code = this.el.inviteCode.value.trim().toUpperCase();
        if (!this.username || code.length !== 6) return;
        
        this.isHost = false;
        this.roomCode = code;
        this.enterRoom();
    }
    
    enterRoom() {
        this.screens.login.classList.remove('active');
        this.screens.walkie.classList.add('active');
        
        this.el.roomCodeDisplay.textContent = this.roomCode;
        this.updateConnection('connecting', 'در حال اتصال به شبکه P2P...');
        
        // Initialize P2P using TryBug (free signaling)
        this.initP2P();
    }
    
    leaveRoom() {
        // Stop recording
        if (this.isRecording) this.stopRecording();
        
        // Close all peer connections
        this.peers.forEach((peer) => {
            if (peer.dataChannel) peer.dataChannel.close();
            if (peer.connection) peer.connection.close();
        });
        this.peers.clear();
        
        // Leave TryBug room
        if (this.tryBugRoom) {
            this.tryBugRoom.leave();
        }
        
        // Reset UI
        this.el.messagesArea.innerHTML = `
            <div class="empty-chat">
                <div class="empty-icon">🎙️</div>
                <h3>آماده مکالمه</h3>
                <p>دکمه را نگه دارید و صحبت کنید</p>
            </div>
        `;
        this.el.peersList.innerHTML = '';
        this.el.peerCount.textContent = '0 همتا';
        
        this.screens.walkie.classList.remove('active');
        this.screens.login.classList.add('active');
        this.updateConnection('disconnected', 'قطع ارتباط');
    }
    
    /* ===== P2P with TryBug (Free Signaling) ===== */
    async initP2P() {
        try {
            // Load TryBug SDK dynamically
            if (typeof TryBug === 'undefined') {
                await this.loadScript('https://cdn.jsdelivr.net/npm/trybug@latest/dist/trybug.min.js');
            }
            
            // Connect to TryBug room
            this.tryBugRoom = new TryBug(this.roomCode, {
                peerId: this.peerId,
                username: this.username,
            });
            
            this.tryBugRoom.on('peer-joined', (peer) => {
                this.connectToPeer(peer);
            });
            
            this.tryBugRoom.on('peer-left', (peerId) => {
                this.removePeer(peerId);
            });
            
            this.tryBugRoom.on('signal', (data) => {
                this.handleSignal(data);
            });
            
            this.tryBugRoom.on('connected', () => {
                this.updateConnection('connected', 'متصل به شبکه P2P');
                this.showToast('✅ به شبکه متصل شدید');
            });
            
            this.tryBugRoom.on('disconnected', () => {
                this.updateConnection('disconnected', 'قطع ارتباط');
            });
            
            this.tryBugRoom.join();
            
        } catch (error) {
            console.error('P2P initialization error:', error);
            // Fallback: use local signaling for same-network
            this.initLocalP2P();
        }
    }
    
    connectToPeer(peer) {
        if (this.peers.has(peer.id)) return;
        
        // Create WebRTC peer connection
        const pc = new SimplePeer({
            initiator: this.isHost || peer.id > this.peerId,
            trickle: true,
        });
        
        // Create data channel
        let dataChannel;
        if (pc.initiator) {
            dataChannel = pc.createDataChannel('audio', {
                ordered: false,
                maxRetransmits: 0,
            });
            this.setupDataChannel(dataChannel, peer);
        }
        
        pc.on('signal', (signal) => {
            this.tryBugRoom.sendSignal(peer.id, signal);
        });
        
        pc.on('connect', () => {
            console.log('Connected to peer:', peer.username);
        });
        
        pc.on('data', (data) => {
            this.handleIncomingData(data, peer);
        });
        
        pc.on('close', () => {
            this.removePeer(peer.id);
        });
        
        pc.on('error', (err) => {
            console.error('Peer error:', err);
            this.removePeer(peer.id);
        });
        
        // Store peer
        this.peers.set(peer.id, {
            connection: pc,
            dataChannel: dataChannel || null,
            username: peer.username,
        });
        
        this.addPeerUI(peer);
    }
    
    setupDataChannel(channel, peer) {
        channel.onopen = () => {
            console.log('Data channel open with:', peer.username);
        };
        
        channel.onclose = () => {
            console.log('Data channel closed with:', peer.username);
        };
    }
    
    handleSignal(data) {
        const peer = this.peers.get(data.from);
        if (peer && peer.connection) {
            peer.connection.signal(data.signal);
        }
    }
    
    handleIncomingData(data, peer) {
        try {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'audio') {
                this.playNotification();
                setTimeout(() => {
                    this.playAudio(message.audio);
                }, 400);
                
                this.displayMessage(message, peer);
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    }
    
    /* ===== Recording & Sending ===== */
    async startRecording() {
        if (this.isRecording || this.peers.size === 0) return;
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                    channelCount: 1,
                } 
            });
            
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
                ? 'audio/webm;codecs=opus' 
                : 'audio/webm';
            
            this.mediaRecorder = new MediaRecorder(stream, { 
                mimeType,
                audioBitsPerSecond: 32000,
            });
            
            this.audioChunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = async () => {
                if (this.audioChunks.length === 0) return;
                
                const audioBlob = new Blob(this.audioChunks, { type: mimeType });
                const base64Audio = await this.blobToBase64(audioBlob);
                
                const message = {
                    type: 'audio',
                    username: this.username,
                    audio: base64Audio,
                    timestamp: Date.now(),
                };
                
                // Send to all peers
                this.peers.forEach((peer) => {
                    if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
                        peer.dataChannel.send(JSON.stringify(message));
                    }
                });
                
                // Display locally
                this.displayMessage(message, { username: this.username });
                
                stream.getTracks().forEach(track => track.stop());
            };
            
            this.mediaRecorder.start(100);
            this.isRecording = true;
            this.startRecordingTimer();
            this.updateRecordingUI();
            
        } catch (error) {
            console.error('Mic error:', error);
            this.showToast('⛔ دسترسی به میکروفون ممکن نیست');
        }
    }
    
    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.stopRecordingTimer();
            this.updateRecordingUI();
        }
    }
    
    /* ===== Audio Playback ===== */
    playNotification() {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            const ctx = this.audioContext;
            const now = ctx.currentTime;
            
            // Simple beep-beep
            [0, 0.12].forEach((delay, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.frequency.value = i === 0 ? 800 : 1100;
                gain.gain.setValueAtTime(0, now + delay);
                gain.gain.linearRampToValueAtTime(0.2, now + delay + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.1);
                osc.connect(gain).connect(ctx.destination);
                osc.start(now + delay);
                osc.stop(now + delay + 0.1);
            });
        } catch (e) {}
    }
    
    playAudio(base64Audio) {
        return new Promise((resolve) => {
            const audio = new Audio(base64Audio);
            audio.onended = resolve;
            audio.onerror = resolve;
            audio.play().catch(resolve);
        });
    }
    
    /* ===== UI ===== */
    displayMessage(message, peer) {
        const emptyChat = this.el.messagesArea.querySelector('.empty-chat');
        if (emptyChat) emptyChat.remove();
        
        const isOutgoing = message.username === this.username;
        const time = new Date(message.timestamp).toLocaleTimeString('fa-IR', {
            hour: '2-digit', minute: '2-digit'
        });
        
        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${isOutgoing ? 'outgoing' : 'incoming'}`;
        bubble.innerHTML = `
            <div class="message-user">${this.escapeHtml(message.username)}</div>
            <div class="play-row">
                <button class="play-btn">▶</button>
                <span style="font-size:12px;">پیام صوتی · ${time}</span>
            </div>
        `;
        
        this.el.messagesArea.appendChild(bubble);
        this.el.messagesArea.scrollTop = this.el.messagesArea.scrollHeight;
        
        // Play button
        const playBtn = bubble.querySelector('.play-btn');
        playBtn.addEventListener('click', () => {
            playBtn.classList.add('playing');
            playBtn.textContent = '⏸';
            this.playAudio(message.audio).then(() => {
                playBtn.classList.remove('playing');
                playBtn.textContent = '▶';
            });
        });
    }
    
    addPeerUI(peer) {
        const chip = document.createElement('div');
        chip.className = 'peer-chip';
        chip.dataset.peerId = peer.id;
        chip.innerHTML = `
            <span class="peer-dot"></span>
            <span>${this.escapeHtml(peer.username)}</span>
        `;
        this.el.peersList.appendChild(chip);
        this.updatePeerCount();
    }
    
    removePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            if (peer.connection) peer.connection.destroy();
            this.peers.delete(peerId);
        }
        
        const chip = this.el.peersList.querySelector(`[data-peer-id="${peerId}"]`);
        if (chip) chip.remove();
        
        this.updatePeerCount();
    }
    
    updatePeerCount() {
        const count = this.peers.size;
        this.el.peerCount.textContent = `${count} همتا`;
    }
    
    updateConnection(status, text) {
        this.el.connDot.className = `conn-dot ${status}`;
        this.el.connText.textContent = text;
    }
    
    updateRecordingUI() {
        if (this.isRecording) {
            this.el.pttBtn.classList.add('recording');
            this.el.pttHint.textContent = 'رها کنید';
        } else {
            this.el.pttBtn.classList.remove('recording');
            this.el.pttHint.textContent = 'نگه دارید و صحبت کنید';
        }
    }
    
    startRecordingTimer() {
        this.recordingSeconds = 0;
        this.el.recTimer.textContent = '00:00';
        this.el.recTimer.style.display = 'block';
        
        this.recordingTimer = setInterval(() => {
            this.recordingSeconds++;
            const m = Math.floor(this.recordingSeconds / 60);
            const s = this.recordingSeconds % 60;
            this.el.recTimer.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }, 1000);
    }
    
    stopRecordingTimer() {
        clearInterval(this.recordingTimer);
        this.el.recTimer.style.display = 'none';
    }
    
    /* ===== Sharing ===== */
    async shareRoom() {
        const shareData = {
            title: 'بیسیم P2P',
            text: `به بیسیم من بپیوند! 🎤\nکد اتاق: ${this.roomCode}\nباید برنامه بیسیم P2P رو باز کنی`,
        };
        
        if (navigator.share) {
            try {
                await navigator.share(shareData);
            } catch (e) {}
        } else {
            await this.copyToClipboard(this.roomCode);
            this.showToast('📋 کد اتاق کپی شد!');
        }
    }
    
    async pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text && text.length === 6) {
                this.el.inviteCode.value = text.toUpperCase();
                this.validateLogin();
            }
        } catch (e) {
            this.showToast('📋 دسترسی به کلیپ‌بورد ممکن نیست');
        }
    }
    
    /* ===== PWA ===== */
    async registerSW() {
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('./sw.js');
                console.log('Service Worker registered');
            } catch (e) {
                console.log('SW registration failed:', e);
            }
        }
    }
    
    checkInstallPrompt() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            
            // Show install prompt after 5 seconds
            setTimeout(() => {
                if (!window.matchMedia('(display-mode: standalone)').matches) {
                    this.el.installPrompt.classList.add('show');
                }
            }, 5000);
        });
        
        // Hide prompt if already installed
        if (window.matchMedia('(display-mode: standalone)').matches) {
            this.el.installPrompt.style.display = 'none';
        }
    }
    
    async installPWA() {
        if (this.deferredPrompt) {
            await this.deferredPrompt.prompt();
            const result = await this.deferredPrompt.userChoice;
            console.log('Install result:', result.outcome);
            this.deferredPrompt = null;
            this.el.installPrompt.classList.remove('show');
        }
    }
    
    /* ===== Utilities ===== */
    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }
    
    generateId() {
        return Math.random().toString(36).substring(2, 15);
    }
    
    blobToBase64(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showToast(message) {
        const toast = this.el.toast;
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toast.timeout);
        toast.timeout = setTimeout(() => toast.classList.remove('show'), 2500);
    }
    
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (e) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
    }
    
    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    /* Fallback: Local P2P for same network */
    initLocalP2P() {
        this.updateConnection('connected', 'حالت لوکال (شبکه محلی)');
        this.showToast('🔗 حالت شبکه محلی فعال شد');
        
        // Use BroadcastChannel for same-origin
        try {
            const bc = new BroadcastChannel('wwt-local');
            bc.onmessage = (e) => {
                if (e.data.type === 'audio' && e.data.username !== this.username) {
                    this.playNotification();
                    setTimeout(() => {
                        this.playAudio(e.data.audio);
                        this.displayMessage(e.data, { username: e.data.username });
                    }, 400);
                }
            };
            
            // Override send
            const originalSend = this.sendToPeers;
            this.sendToPeers = (message) => {
                bc.postMessage(message);
            };
            
        } catch (e) {
            this.showToast('⚠️ امکان اتصال P2P وجود ندارد');
        }
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.app = new WalkieTalkieP2P();
});