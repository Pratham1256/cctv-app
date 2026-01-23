const socket = io();
const localVideo = document.getElementById('localVideo');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const streamInfo = document.getElementById('streamInfo');
const shareLink = document.getElementById('shareLink');
const shareLinkInput = document.getElementById('shareLinkInput');
const copyBtn = document.getElementById('copyBtn');
const cameraNameEl = document.getElementById('cameraName');
const viewerCountEl = document.getElementById('viewerCount');

let localStream = null;
let cameraId = null;
let peerConnections = {}; // Store connections to multiple viewers
let viewerCount = 0;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

startBtn.addEventListener('click', startStreaming);
stopBtn.addEventListener('click', stopStreaming);
copyBtn.addEventListener('click', copyShareLink);

async function startStreaming() {
    try {
        // Get user media
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: true
        });
        
        localVideo.srcObject = localStream;
        
        // Request to start stream on server
        socket.emit('start_stream');
        
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Could not access camera/microphone. Please grant permissions and ensure you are using HTTPS.');
    }
}

function stopStreaming() {
    // Stop all tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
    }
    
    // Close all peer connections
    Object.values(peerConnections).forEach(pc => {
        pc.close();
    });
    peerConnections = {};
    
    // Disconnect will be handled by beforeunload
    window.location.href = '/';
}

// Socket events
socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
});

socket.on('stream_started', (data) => {
    cameraId = data.camera_id;
    cameraNameEl.textContent = data.camera_name;
    streamInfo.style.display = 'block';
    
    const shareUrl = `${window.location.origin}/camera/${cameraId}`;
    shareLinkInput.value = shareUrl;
    shareLink.style.display = 'block';
    
    console.log('Stream started:', data);
});

socket.on('new_viewer', async (data) => {
    const viewerId = data.viewer_id;
    console.log('New viewer joined:', viewerId);
    
    // Update viewer count
    viewerCount++;
    viewerCountEl.textContent = viewerCount;
    
    // Create new peer connection for this viewer
    const peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnections[viewerId] = peerConnection;
    
    // Add local stream tracks to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                target: viewerId,
                candidate: event.candidate
            });
        }
    };
    
    // Handle connection state
    peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state with ${viewerId}:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' || 
            peerConnection.connectionState === 'failed' ||
            peerConnection.connectionState === 'closed') {
            // Clean up this peer connection
            if (peerConnections[viewerId]) {
                delete peerConnections[viewerId];
                viewerCount = Math.max(0, viewerCount - 1);
                viewerCountEl.textContent = viewerCount;
            }
        }
    };
    
    try {
        // Create and send offer
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
});

function copyShareLink() {
    shareLinkInput.select();
    shareLinkInput.setSelectionRange(0, 99999); // For mobile devices
    
    // Modern clipboard API
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(shareLinkInput.value).then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✓ Copied!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 2000);
        });
    } else {
        // Fallback for older browsers
        document.execCommand('copy');
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => {
            copyBtn.textContent = originalText;
        }, 2000);
    }
}

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    Object.values(peerConnections).forEach(pc => pc.close());
});