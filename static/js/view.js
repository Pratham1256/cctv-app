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
let hasReceivedSecondVideo = false;
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

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('Page hidden - viewer left app');
        isPageVisible = false;
    } else {
        console.log('Page visible - viewer returned to app');
        isPageVisible = true;
        
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
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    receivedTracks = [];
    hasReceivedSecondVideo = false;
    
    if (!socket.connected) {
        socket.connect();
    } else {
        socket.emit('join_camera', { camera_id: CAMERA_ID });
    }
    
    reconnectAttempts++;
    
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectTimeout = setTimeout(() => {
            if (!socket.connected || 
                (peerConnection && peerConnection.connectionState !== 'connected')) {
                console.log(`Reconnect attempt ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
                attemptReconnect();
            }
        }, 3000);
    } else {
        connectionStatus.textContent = 'Refreshing page to restore connection...';
        setTimeout(() => {
            window.location.reload();
        }, 2000);
    }
}

socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    connectionStatus.textContent = 'Connecting...';
    
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
    console.log('Streamer has screen share:', streamerHasScreenShare);
    
    try {
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        peerConnection.ontrack = (event) => {
            console.log('Received track:', event.track.kind, 'ID:', event.track.id);
            receivedTracks.push(event.track);
            
            if (event.track.kind === 'video') {
                const videoTrackCount = receivedTracks.filter(t => t.kind === 'video').length;
                console.log('Video track count:', videoTrackCount);
                
                if (videoTrackCount === 1) {
                    console.log('Setting first video (camera) to remoteVideo');
                    const stream = new MediaStream([event.track]);
                    const audioTrack = receivedTracks.find(t => t.kind === 'audio');
                    if (audioTrack) {
                        stream.addTrack(audioTrack);
                    }
                    remoteVideo.srcObject = stream;
                    remoteVideo.volume = 1.0;
                    
                    // Wait 2 seconds to see if second video arrives
                    // Only show placeholder if we're sure there's no second video
                    setTimeout(() => {
                        if (!hasReceivedSecondVideo && !streamerHasScreenShare) {
                            console.log('No second video after 2 seconds - showing placeholder');
                            showScreenPlaceholder();
                        }
                    }, 2000);
                } 
                else if (videoTrackCount === 2) {
                    console.log('Setting second video (screen) to remoteVideo2');
                    hasReceivedSecondVideo = true;
                    
                    // Remove placeholder if it exists
                    const placeholder = document.getElementById('screen-placeholder');
                    if (placeholder) {
                        placeholder.remove();
                    }
                    
                    const stream = new MediaStream([event.track]);
                    remoteVideo2.srcObject = stream;
                    remoteVideo2.style.display = 'block';
                    screenLabel.textContent = 'Screen Feed';
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
            reconnectAttempts = 0;
            
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
                    
                    if (isPageVisible) {
                        attemptReconnect();
                    }
                    break;
                case 'closed':
                    connectionStatus.textContent = 'Stream ended';
                    connectionStatus.style.display = 'block';
                    muteViewerBtn.style.display = 'none';
                    
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
    
    setTimeout(() => {
        window.location.href = '/';
    }, 3000);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    connectionStatus.textContent = 'Disconnected. Reconnecting...';
    connectionStatus.style.display = 'block';
    muteViewerBtn.style.display = 'none';
    
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

setInterval(() => {
    if (isPageVisible) {
        if (!socket.connected || 
            (peerConnection && 
             peerConnection.connectionState !== 'connected' && 
             peerConnection.connectionState !== 'connecting')) {
            console.log('Periodic check: connection issue detected');
            if (reconnectAttempts === 0) {
                attemptReconnect();
            }
        }
    }
}, 10000);