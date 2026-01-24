const socket = io();
const remoteVideo = document.getElementById('remoteVideo');
const remoteVideo2 = document.getElementById('remoteVideo2');
const connectionStatus = document.getElementById('connectionStatus');
const muteViewerBtn = document.getElementById('muteViewerBtn');
const screenLabel = document.getElementById('screenLabel');
const videoWrapper2 = document.getElementById('videoWrapper2');

let peerConnection = null;
let isViewerMuted = false;
let receivedTracks = [];
let streamerHasScreenShare = false;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let reconnectTimeout = null;
let isPageVisible = true;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

muteViewerBtn.addEventListener('click', toggleViewerMute);

function toggleViewerMute() {
    isViewerMuted = !isViewerMuted;
    remoteVideo.muted = isViewerMuted;
    remoteVideo2.muted = isViewerMuted;
    
    if (isViewerMuted) {
        muteViewerBtn.textContent = '🔇 Unmute';
        muteViewerBtn.style.background = '#ef4444';
    } else {
        muteViewerBtn.textContent = '🔊 Mute';
        muteViewerBtn.style.background = '#667eea';
    }
}

// Handle page visibility changes (when user switches apps)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('Page hidden - viewer left app');
        isPageVisible = false;
    } else {
        console.log('Page visible - viewer returned to app');
        isPageVisible = true;
        
        // Check connection state when returning
        if (!socket.connected || 
            (peerConnection && peerConnection.connectionState !== 'connected')) {
            console.log('Connection lost while away - attempting to reconnect');
            attemptReconnect();
        }
    }
});

function attemptReconnect() {
    connectionStatus.textContent = 'Reconnecting...';
    connectionStatus.style.display = 'block';
    
    // Close existing peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Reset received tracks
    receivedTracks = [];
    
    // Force socket reconnection if disconnected
    if (!socket.connected) {
        socket.connect();
    } else {
        // If socket is connected but peer connection failed, rejoin camera
        socket.emit('join_camera', { camera_id: CAMERA_ID });
    }
    
    reconnectAttempts++;
    
    // Set timeout for next reconnect attempt if this fails
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectTimeout = setTimeout(() => {
            if (!socket.connected || 
                (peerConnection && peerConnection.connectionState !== 'connected')) {
                console.log(`Reconnect attempt ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
                attemptReconnect();
            }
        }, 3000); // Try again after 3 seconds
    } else {
        // Max attempts reached - auto refresh page
        connectionStatus.textContent = 'Refreshing page to restore connection...';
        setTimeout(() => {
            window.location.reload();
        }, 2000);
    }
}

socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    connectionStatus.textContent = 'Connecting...';
    
    // Reset reconnect attempts on successful connection
    reconnectAttempts = 0;
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    socket.emit('join_camera', { camera_id: CAMERA_ID });
});

socket.on('offer', async (data) => {
    console.log('Received offer from streamer');
    connectionStatus.textContent = 'Establishing connection...';
    
    streamerHasScreenShare = data.hasScreenShare || false;
    
    try {
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        peerConnection.ontrack = (event) => {
            console.log('Received track:', event.track.kind, 'ID:', event.track.id);
            receivedTracks.push(event.track);
            
            if (event.track.kind === 'video') {
                const videoTrackCount = receivedTracks.filter(t => t.kind === 'video').length;
                
                if (videoTrackCount === 1) {
                    console.log('Setting first video (camera) to remoteVideo');
                    const stream = new MediaStream([event.track]);
                    const audioTrack = receivedTracks.find(t => t.kind === 'audio');
                    if (audioTrack) {
                        stream.addTrack(audioTrack);
                    }
                    remoteVideo.srcObject = stream;
                    remoteVideo.volume = 1.0;
                    
                    if (!streamerHasScreenShare) {
                        showScreenPlaceholder();
                    }
                } 
                else if (videoTrackCount === 2) {
                    console.log('Setting second video (screen) to remoteVideo2');
                    const stream = new MediaStream([event.track]);
                    remoteVideo2.srcObject = stream;
                    remoteVideo2.style.display = 'block';
                    screenLabel.style.display = 'block';
                    videoWrapper2.style.display = 'block';
                }
            } 
            else if (event.track.kind === 'audio') {
                if (remoteVideo.srcObject) {
                    remoteVideo.srcObject.addTrack(event.track);
                }
            }
            
            muteViewerBtn.style.display = 'inline-block';
            
            connectionStatus.textContent = 'Connected';
            reconnectAttempts = 0; // Reset on successful connection
            
            setTimeout(() => {
                connectionStatus.style.display = 'none';
            }, 2000);
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice_candidate', {
                    target: data.from,
                    candidate: event.candidate
                });
            }
        };
        
        peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', peerConnection.connectionState);
            
            switch(peerConnection.connectionState) {
                case 'connected':
                    connectionStatus.textContent = 'Connected';
                    reconnectAttempts = 0;
                    setTimeout(() => {
                        connectionStatus.style.display = 'none';
                    }, 2000);
                    break;
                case 'connecting':
                    connectionStatus.textContent = 'Connecting...';
                    connectionStatus.style.display = 'block';
                    break;
                case 'disconnected':
                    connectionStatus.textContent = 'Reconnecting...';
                    connectionStatus.style.display = 'block';
                    muteViewerBtn.style.display = 'none';
                    
                    // Auto-reconnect after 2 seconds
                    setTimeout(() => {
                        if (isPageVisible) {
                            attemptReconnect();
                        }
                    }, 2000);
                    break;
                case 'failed':
                    connectionStatus.textContent = 'Connection failed. Reconnecting...';
                    connectionStatus.style.display = 'block';
                    muteViewerBtn.style.display = 'none';
                    
                    // Auto-reconnect immediately
                    if (isPageVisible) {
                        attemptReconnect();
                    }
                    break;
                case 'closed':
                    connectionStatus.textContent = 'Stream ended';
                    connectionStatus.style.display = 'block';
                    muteViewerBtn.style.display = 'none';
                    
                    // Try to reconnect in case stream is still active
                    setTimeout(() => {
                        if (isPageVisible) {
                            attemptReconnect();
                        }
                    }, 3000);
                    break;
            }
        };
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket.emit('answer', {
            target: data.from,
            answer: answer
        });
        
        console.log('Answer sent to streamer');
        
    } catch (error) {
        console.error('Error handling offer:', error);
        connectionStatus.textContent = 'Error establishing connection. Retrying...';
        connectionStatus.style.display = 'block';
        
        // Retry on error
        setTimeout(() => {
            if (isPageVisible) {
                attemptReconnect();
            }
        }, 2000);
    }
});

function showScreenPlaceholder() {
    videoWrapper2.style.display = 'block';
    remoteVideo2.style.display = 'none';
    
    const placeholder = document.createElement('div');
    placeholder.id = 'screen-placeholder';
    placeholder.style.cssText = `
        width: 100%;
        height: 100%;
        min-height: 400px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 18px;
        border-radius: 12px;
    `;
    placeholder.innerHTML = `
        <div style="font-size: 64px; margin-bottom: 20px;">📱</div>
        <div style="font-weight: 600;">Screen sharing not available</div>
        <div style="font-size: 14px; opacity: 0.8; margin-top: 10px;">Streamer is using a mobile device</div>
    `;
    
    const wrapper = document.getElementById('videoWrapper2');
    wrapper.innerHTML = '';
    wrapper.appendChild(placeholder);
    
    screenLabel.textContent = 'Screen Not Available';
    screenLabel.style.display = 'block';
}

socket.on('ice_candidate', async (data) => {
    if (peerConnection && data.candidate) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log('ICE candidate added');
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }
});

socket.on('error', (data) => {
    console.error('Socket error:', data);
    connectionStatus.textContent = data.message || 'Camera not found or offline';
    connectionStatus.style.display = 'block';
    
    // Camera not found - redirect after delay
    setTimeout(() => {
        window.location.href = '/';
    }, 3000);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    connectionStatus.textContent = 'Disconnected. Reconnecting...';
    connectionStatus.style.display = 'block';
    muteViewerBtn.style.display = 'none';
    
    // Socket.io will auto-reconnect, but we can help it along
    if (isPageVisible) {
        setTimeout(() => {
            if (!socket.connected) {
                console.log('Forcing reconnection');
                socket.connect();
            }
        }, 1000);
    }
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
    connectionStatus.textContent = 'Reconnected! Restoring stream...';
    reconnectAttempts = 0;
});

window.addEventListener('beforeunload', () => {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    if (peerConnection) {
        peerConnection.close();
    }
    socket.emit('leave_camera', { camera_id: CAMERA_ID });
});

// Monitor connection health periodically
setInterval(() => {
    if (isPageVisible) {
        // Check if we should be connected but aren't
        if (!socket.connected || 
            (peerConnection && 
             peerConnection.connectionState !== 'connected' && 
             peerConnection.connectionState !== 'connecting')) {
            console.log('Periodic check: connection issue detected');
            if (reconnectAttempts === 0) { // Avoid multiple simultaneous reconnects
                attemptReconnect();
            }
        }
    }
}, 10000); // Check every 10 seconds