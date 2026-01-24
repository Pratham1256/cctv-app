const socket = io();
const localVideo = document.getElementById('localVideo');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const muteBtn = document.getElementById('muteBtn');
const streamInfo = document.getElementById('streamInfo');
const shareLink = document.getElementById('shareLink');
const shareLinkInput = document.getElementById('shareLinkInput');
const copyBtn = document.getElementById('copyBtn');
const cameraNameEl = document.getElementById('cameraName');
const viewerCountEl = document.getElementById('viewerCount');
const audioStatusEl = document.getElementById('audioStatus');

let cameraStream = null;
let screenStream = null;
let cameraId = null;
let peerConnections = {};
let viewerCount = 0;
let isAudioMuted = false;
let heartbeatInterval = null;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

startBtn.addEventListener('click', startStreaming);
stopBtn.addEventListener('click', stopStreaming);
muteBtn.addEventListener('click', toggleMute);
copyBtn.addEventListener('click', copyShareLink);

async function startStreaming() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        });
        
        localVideo.srcObject = cameraStream;
        
        screenStream.getVideoTracks()[0].onended = () => {
            alert('Screen sharing stopped. Stream will end.');
            stopStreaming();
        };
        
        socket.emit('start_stream');
        
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        muteBtn.style.display = 'block';
        
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Could not access camera/microphone/screen. Please grant permissions and ensure you are using HTTPS.');
    }
}

function stopStreaming() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    localVideo.srcObject = null;
    
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    window.location.href = '/';
}

function toggleMute() {
    if (!cameraStream) return;
    
    const audioTrack = cameraStream.getAudioTracks()[0];
    if (audioTrack) {
        isAudioMuted = !isAudioMuted;
        audioTrack.enabled = !isAudioMuted;
        
        if (isAudioMuted) {
            muteBtn.textContent = '🔇 Unmute Audio';
            muteBtn.style.background = '#ef4444';
            audioStatusEl.textContent = 'MUTED';
            audioStatusEl.style.color = '#ef4444';
        } else {
            muteBtn.textContent = '🎤 Mute Audio';
            muteBtn.style.background = '#667eea';
            audioStatusEl.textContent = 'ON';
            audioStatusEl.style.color = '#4ade80';
        }
    }
}

socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    
    if (cameraId && cameraStream) {
        console.log('Reconnected - re-registering stream');
        socket.emit('start_stream');
    }
});

socket.on('stream_started', (data) => {
    cameraId = data.camera_id;
    cameraNameEl.textContent = data.camera_name;
    streamInfo.style.display = 'block';
    
    const shareUrl = `${window.location.origin}/camera/${cameraId}`;
    shareLinkInput.value = shareUrl;
    shareLink.style.display = 'block';
    
    heartbeatInterval = setInterval(() => {
        if (cameraId) {
            socket.emit('heartbeat', { camera_id: cameraId });
            console.log('Heartbeat sent');
        }
    }, 30000);
    
    console.log('Stream started:', data);
});

socket.on('new_viewer', async (data) => {
    const viewerId = data.viewer_id;
    console.log('New viewer joined:', viewerId);
    
    viewerCount++;
    viewerCountEl.textContent = viewerCount;
    
    const peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnections[viewerId] = peerConnection;
    
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, cameraStream);
        });
    }
    
    if (screenStream) {
        screenStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, screenStream);
        });
    }
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                target: viewerId,
                candidate: event.candidate
            });
        }
    };
    
    peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state with ${viewerId}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' || 
            peerConnection.connectionState === 'failed' ||
            peerConnection.connectionState === 'closed') {
            if (peerConnections[viewerId]) {
                delete peerConnections[viewerId];
                viewerCount = Math.max(0, viewerCount - 1);
                viewerCountEl.textContent = viewerCount;
            }
        }
    };
    
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('offer', {
            target: viewerId,
            offer: offer
        });
    } catch (error) {
        console.error('Error creating offer:', error);
    }
});

socket.on('answer', async (data) => {
    const viewerId = data.from;
    const peerConnection = peerConnections[viewerId];
    
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log('Answer set for viewer:', viewerId);
        } catch (error) {
            console.error('Error setting remote description:', error);
        }
    }
});

socket.on('ice_candidate', async (data) => {
    const viewerId = data.from;
    const peerConnection = peerConnections[viewerId];
    
    if (peerConnection && data.candidate) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    
    console.log('Attempting to reconnect...');
});

socket.on('heartbeat_ack', (data) => {
    console.log('Heartbeat acknowledged:', data.status);
});

function copyShareLink() {
    shareLinkInput.select();
    shareLinkInput.setSelectionRange(0, 99999);
    
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(shareLinkInput.value).then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✓ Copied!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 2000);
        });
    } else {
        document.execCommand('copy');
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => {
            copyBtn.textContent = originalText;
        }, 2000);
    }
}

window.addEventListener('beforeunload', () => {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
    }
    
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    Object.values(peerConnections).forEach(pc => pc.close());
});