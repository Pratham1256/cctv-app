const socket = io();
const localVideo = document.getElementById('localVideo');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const muteBtn = document.getElementById('muteBtn');
const toggleCameraBtn = document.getElementById('toggleCameraBtn');
const streamInfo = document.getElementById('streamInfo');
const shareLink = document.getElementById('shareLink');
const shareLinkInput = document.getElementById('shareLinkInput');
const copyBtn = document.getElementById('copyBtn');
const cameraNameEl = document.getElementById('cameraName');
const viewerCountEl = document.getElementById('viewerCount');
const audioStatusEl = document.getElementById('audioStatus');
const streamingInfoEl = document.getElementById('streamingInfo');
const cameraStatusEl = document.getElementById('cameraStatus');

let cameraStream = null;
let screenStream = null;
let cameraId = null;
let peerConnections = {};
let viewerCount = 0;
let isAudioMuted = false;
let isCameraOff = false;
let heartbeatInterval = null;
let hasScreenShare = false;

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
toggleCameraBtn.addEventListener('click', toggleCamera);
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
        
        localVideo.srcObject = cameraStream;
        
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            });
            
            hasScreenShare = true;
            console.log('Screen sharing enabled');
            
            screenStream.getVideoTracks()[0].onended = () => {
                alert('Screen sharing stopped. Stream will end.');
                stopStreaming();
            };
            
        } catch (screenError) {
            console.warn('Screen sharing not available or denied:', screenError);
            hasScreenShare = false;
            alert('Screen sharing is not available on this device. Streaming camera only.');
        }
        
        socket.emit('start_stream');
        
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        muteBtn.style.display = 'block';
        toggleCameraBtn.style.display = 'block';
        
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Could not access camera/microphone. Please grant permissions and ensure you are using HTTPS.');
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

async function toggleCamera() {
    if (isCameraOff) {
        // Turn camera ON
        try {
            const newCameraStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });
            
            const newVideoTrack = newCameraStream.getVideoTracks()[0];
            const audioTrack = cameraStream.getAudioTracks()[0];
            
            // Stop old video track if exists
            const oldVideoTrack = cameraStream.getVideoTracks()[0];
            if (oldVideoTrack) {
                oldVideoTrack.stop();
                cameraStream.removeTrack(oldVideoTrack);
            }
            
            // Add new video track to camera stream
            cameraStream.addTrack(newVideoTrack);
            
            // Update local video
            localVideo.srcObject = cameraStream;
            
            // Replace track for ALL peer connections
            const replacePromises = [];
            for (const [viewerId, pc] of Object.entries(peerConnections)) {
                const senders = pc.getSenders();
                const videoSender = senders.find(s => 
                    s.track?.kind === 'video' || (s.track === null && s.transceiver?.currentDirection?.includes('send'))
                );
                
                if (videoSender) {
                    replacePromises.push(
                        videoSender.replaceTrack(newVideoTrack).then(() => {
                            console.log(`[${viewerId}] Camera track replaced`);
                        }).catch(err => {
                            console.error(`[${viewerId}] Failed to replace track:`, err);
                        })
                    );
                } else {
                    // Add track if no sender found
                    try {
                        pc.addTrack(newVideoTrack, cameraStream);
                        console.log(`[${viewerId}] Camera track added`);
                    } catch (err) {
                        console.error(`[${viewerId}] Failed to add track:`, err);
                    }
                }
            }
            
            await Promise.all(replacePromises);
            
            isCameraOff = false;
            toggleCameraBtn.textContent = '📹 Turn Camera Off';
            toggleCameraBtn.style.background = '#667eea';
            cameraStatusEl.textContent = 'ON';
            cameraStatusEl.style.color = '#4ade80';
            localVideo.style.opacity = '1';
            
            console.log('✓ Camera turned ON for all viewers');
            
        } catch (error) {
            console.error('Error restarting camera:', error);
            alert('Could not restart camera. Please check permissions.');
        }
        
    } else {
        // Turn camera OFF
        const videoTrack = cameraStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.stop();
            cameraStream.removeTrack(videoTrack);
            
            // Replace with null for all peer connections
            const replacePromises = [];
            for (const [viewerId, pc] of Object.entries(peerConnections)) {
                const senders = pc.getSenders();
                const videoSender = senders.find(s => 
                    s.track?.kind === 'video' && s.track.id === videoTrack.id
                );
                
                if (videoSender) {
                    replacePromises.push(
                        videoSender.replaceTrack(null).then(() => {
                            console.log(`[${viewerId}] Camera track removed`);
                        })
                    );
                }
            }
            
            await Promise.all(replacePromises);
            
            isCameraOff = true;
            toggleCameraBtn.textContent = '📹 Turn Camera On';
            toggleCameraBtn.style.background = '#ef4444';
            cameraStatusEl.textContent = 'OFF';
            cameraStatusEl.style.color = '#ef4444';
            localVideo.style.opacity = '0.3';
            
            console.log('✓ Camera turned OFF for all viewers');
        }
    }
}

socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    
    if (cameraId && (cameraStream || screenStream)) {
        console.log('Reconnected - re-registering stream');
        socket.emit('start_stream');
    }
});

socket.on('stream_started', (data) => {
    cameraId = data.camera_id;
    cameraNameEl.textContent = data.camera_name;
    streamInfo.style.display = 'block';
    
    if (hasScreenShare) {
        streamingInfoEl.textContent = '📹 Streaming: Camera + Screen';
    } else {
        streamingInfoEl.textContent = '📹 Streaming: Camera Only';
        streamingInfoEl.style.color = '#f59e0b';
    }
    
    const shareUrl = `${window.location.origin}/camera/${cameraId}`;
    shareLinkInput.value = shareUrl;
    shareLink.style.display = 'block';
    
    heartbeatInterval = setInterval(() => {
        if (cameraId) {
            socket.emit('heartbeat', { camera_id: cameraId });
        }
    }, 30000);
    
    console.log('Stream started:', data);
});

socket.on('new_viewer', async (data) => {
    const viewerId = data.viewer_id;
    console.log(`[${viewerId}] New viewer joining - Camera: ${isCameraOff ? 'OFF' : 'ON'}, Screen: ${hasScreenShare ? 'YES' : 'NO'}`);
    
    viewerCount++;
    viewerCountEl.textContent = viewerCount;
    
    const peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnections[viewerId] = peerConnection;
    
    // Add all current tracks to the new peer connection
    const tracksAdded = [];
    
    // Camera tracks
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => {
            // Only add video track if camera is ON
            if (track.kind === 'video' && isCameraOff) {
                console.log(`[${viewerId}] Skipping camera video (OFF)`);
                return;
            }
            
            if (track.readyState === 'live') {
                peerConnection.addTrack(track, cameraStream);
                tracksAdded.push(`${track.kind} (camera)`);
            }
        });
    }
    
    // Screen tracks
    if (screenStream && hasScreenShare) {
        screenStream.getTracks().forEach(track => {
            if (track.readyState === 'live') {
                peerConnection.addTrack(track, screenStream);
                tracksAdded.push(`${track.kind} (screen)`);
            }
        });
    }
    
    console.log(`[${viewerId}] Added tracks:`, tracksAdded.join(', '));
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                target: viewerId,
                candidate: event.candidate
            });
        }
    };
    
    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        console.log(`[${viewerId}] Connection state: ${state}`);
        
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
            if (peerConnections[viewerId]) {
                delete peerConnections[viewerId];
                viewerCount = Math.max(0, viewerCount - 1);
                viewerCountEl.textContent = viewerCount;
                console.log(`[${viewerId}] Removed from viewers`);
            }
        }
    };
    
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('offer', {
            target: viewerId,
            offer: offer,
            hasScreenShare: hasScreenShare
        });
        
        console.log(`[${viewerId}] Offer sent`);
    } catch (error) {
        console.error(`[${viewerId}] Error creating offer:`, error);
    }
});

socket.on('answer', async (data) => {
    const viewerId = data.from;
    const peerConnection = peerConnections[viewerId];
    
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log(`[${viewerId}] Answer received and set`);
        } catch (error) {
            console.error(`[${viewerId}] Error setting remote description:`, error);
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
            console.error(`[${viewerId}] Error adding ICE candidate:`, error);
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

socket.on('heartbeat_ack', () => {
    // Heartbeat acknowledged silently
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