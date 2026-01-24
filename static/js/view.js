const socket = io();
const remoteVideo = document.getElementById('remoteVideo');
const remoteVideo2 = document.getElementById('remoteVideo2');
const connectionStatus = document.getElementById('connectionStatus');
const muteViewerBtn = document.getElementById('muteViewerBtn');
const screenLabel = document.getElementById('screenLabel');

let peerConnection = null;
let isViewerMuted = false;
let receivedTracks = [];

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// Mute/Unmute button for viewer
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

// Initialize viewing
socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    connectionStatus.textContent = 'Connecting...';
    
    // Join the camera room
    socket.emit('join_camera', { camera_id: CAMERA_ID });
});

// Receive offer from streamer
socket.on('offer', async (data) => {
    console.log('Received offer from streamer');
    connectionStatus.textContent = 'Establishing connection...';
    
    try {
        // Create peer connection
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        // Handle incoming tracks
        peerConnection.ontrack = (event) => {
            console.log('Received track:', event.track.kind, 'ID:', event.track.id);
            receivedTracks.push(event.track);
            
            if (event.track.kind === 'video') {
                // First video track = camera
                if (receivedTracks.filter(t => t.kind === 'video').length === 1) {
                    console.log('Setting first video (camera) to remoteVideo');
                    const stream = new MediaStream([event.track]);
                    // Also add audio if available
                    const audioTrack = receivedTracks.find(t => t.kind === 'audio');
                    if (audioTrack) {
                        stream.addTrack(audioTrack);
                    }
                    remoteVideo.srcObject = stream;
                    remoteVideo.volume = 1.0;
                }
                // Second video track = screen
                else if (receivedTracks.filter(t => t.kind === 'video').length === 2) {
                    console.log('Setting second video (screen) to remoteVideo2');
                    const stream = new MediaStream([event.track]);
                    remoteVideo2.srcObject = stream;
                    remoteVideo2.style.display = 'block';
                    screenLabel.style.display = 'block';
                }
            } 
            else if (event.track.kind === 'audio') {
                // Add audio to first video if it exists
                if (remoteVideo.srcObject) {
                    remoteVideo.srcObject.addTrack(event.track);
                }
            }
            
            // Show mute button once we have streams
            muteViewerBtn.style.display = 'inline-block';
            
            connectionStatus.textContent = 'Connected';
            setTimeout(() => {
                connectionStatus.style.display = 'none';
            }, 2000);
        };
        
        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice_candidate', {
                    target: data.from,
                    candidate: event.candidate
                });
            }
        };
        
        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', peerConnection.connectionState);
            
            switch(peerConnection.connectionState) {
                case 'connected':
                    connectionStatus.textContent = 'Connected';
                    setTimeout(() => {
                        connectionStatus.style.display = 'none';
                    }, 2000);
                    break;
                case 'connecting':
                    connectionStatus.textContent = 'Connecting...';
                    connectionStatus.style.display = 'block';
                    break;
                case 'disconnected':
                    connectionStatus.textContent = 'Stream disconnected. Reconnecting...';
                    connectionStatus.style.display = 'block';
                    muteViewerBtn.style.display = 'none';
                    break;
                case 'failed':
                    connectionStatus.textContent = 'Connection failed. Please refresh the page.';
                    connectionStatus.style.display = 'block';
                    muteViewerBtn.style.display = 'none';
                    break;
                case 'closed':
                    connectionStatus.textContent = 'Stream ended';
                    connectionStatus.style.display = 'block';
                    muteViewerBtn.style.display = 'none';
                    break;
            }
        };
        
        // Set remote description and create answer
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        // Send answer back to streamer
        socket.emit('answer', {
            target: data.from,
            answer: answer
        });
        
        console.log('Answer sent to streamer');
        
    } catch (error) {
        console.error('Error handling offer:', error);
        connectionStatus.textContent = 'Error establishing connection';
        connectionStatus.style.display = 'block';
    }
});

// Receive ICE candidates
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
    
    // Redirect to home after 3 seconds
    setTimeout(() => {
        window.location.href = '/';
    }, 3000);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    connectionStatus.textContent = 'Disconnected from server';
    connectionStatus.style.display = 'block';
    muteViewerBtn.style.display = 'none';
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (peerConnection) {
        peerConnection.close();
    }
    socket.emit('leave_camera', { camera_id: CAMERA_ID });
});