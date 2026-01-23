const socket = io();
const cameraGrid = document.getElementById('camera-grid');

// Load cameras on page load
loadCameras();

// Listen for camera list updates
socket.on('camera_list_updated', () => {
    loadCameras();
});

async function loadCameras() {
    try {
        const response = await fetch('/api/cameras');
        const cameras = await response.json();
        
        if (cameras.length === 0) {
            cameraGrid.innerHTML = '<p class="no-cameras">No active cameras. Be the first to stream!</p>';
            return;
        }
        
        cameraGrid.innerHTML = cameras.map(camera => `
            <div class="camera-card" onclick="viewCamera('${camera.id}')">
                <div class="camera-thumbnail">
                    📹
                    <div class="live-badge">
                        <div class="live-dot"></div>
                        LIVE
                    </div>
                </div>
                <div class="camera-info">
                    <div class="camera-name">${camera.name}</div>
                    <div class="camera-viewers">👁️ ${camera.viewers} viewer${camera.viewers !== 1 ? 's' : ''}</div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading cameras:', error);
    }
}

function viewCamera(cameraId) {
    window.location.href = `/camera/${cameraId}`;
}

socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});