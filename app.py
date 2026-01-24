from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
import string
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here-change-in-production'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent', ping_timeout=60, ping_interval=25)

# In-memory storage for active cameras
active_cameras = {}
# Track which viewer is in which camera room
viewer_rooms = {}

def generate_camera_name():
    """Generate a unique random camera name"""
    adjectives = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Cyan', 
                  'Silver', 'Golden', 'Swift', 'Bright', 'Dark', 'Light', 'Quick']
    nouns = ['Eagle', 'Tiger', 'Dragon', 'Falcon', 'Phoenix', 'Wolf', 'Bear', 'Hawk',
             'Lion', 'Panther', 'Viper', 'Raven', 'Storm', 'Thunder', 'Blaze']
    
    while True:
        name = f"{random.choice(adjectives)}_{random.choice(nouns)}_{random.randint(100, 999)}"
        if name not in active_cameras:
            return name

@app.route('/')
def home():
    """Home page showing all active cameras"""
    return render_template('home.html')

@app.route('/stream')
def stream():
    """Page for users to start streaming"""
    return render_template('stream.html')

@app.route('/camera/<camera_id>')
def view_camera(camera_id):
    """View a specific camera stream"""
    if camera_id not in active_cameras:
        return "Camera not found or offline", 404
    return render_template('view.html', camera_id=camera_id, camera_name=active_cameras[camera_id]['name'])

@app.route('/api/cameras')
def get_cameras():
    """API endpoint to get list of active cameras"""
    cameras_list = [
        {
            'id': cam_id,
            'name': cam_data['name'],
            'viewers': cam_data['viewers'],
            'started_at': cam_data['started_at']
        }
        for cam_id, cam_data in active_cameras.items()
    ]
    return jsonify(cameras_list)

# Socket.IO Events for WebRTC Signaling

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnect - remove camera if it was streaming"""
    print(f'Client disconnected: {request.sid}')
    
    # Check if this was a viewer and decrement count
    if request.sid in viewer_rooms:
        camera_id = viewer_rooms[request.sid]
        if camera_id in active_cameras:
            active_cameras[camera_id]['viewers'] = max(0, active_cameras[camera_id]['viewers'] - 1)
            print(f'Viewer left camera {camera_id}, viewers now: {active_cameras[camera_id]["viewers"]}')
        del viewer_rooms[request.sid]
    
    # Find and remove camera associated with this socket (if streamer)
    camera_to_remove = None
    for cam_id, cam_data in active_cameras.items():
        if cam_data['socket_id'] == request.sid:
            camera_to_remove = cam_id
            break
    
    if camera_to_remove:
        del active_cameras[camera_to_remove]
        # Notify all clients that camera list has updated
        emit('camera_list_updated', list(active_cameras.keys()), broadcast=True)
        print(f'Camera {camera_to_remove} removed')

@socketio.on('start_stream')
def handle_start_stream():
    """Handle new stream initialization"""
    camera_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=12))
    camera_name = generate_camera_name()
    
    active_cameras[camera_id] = {
        'name': camera_name,
        'socket_id': request.sid,
        'viewers': 0,
        'started_at': datetime.now().isoformat()
    }
    
    # Join room for this camera
    join_room(camera_id)
    
    # Send camera ID and name back to streamer
    emit('stream_started', {'camera_id': camera_id, 'camera_name': camera_name})
    
    # Notify all clients about new camera
    emit('camera_list_updated', list(active_cameras.keys()), broadcast=True)
    print(f'New stream started: {camera_name} ({camera_id})')

@socketio.on('join_camera')
def handle_join_camera(data):
    """Handle viewer joining a camera stream"""
    camera_id = data.get('camera_id')
    
    if camera_id not in active_cameras:
        emit('error', {'message': 'Camera not found'})
        return
    
    join_room(camera_id)
    active_cameras[camera_id]['viewers'] += 1
    viewer_rooms[request.sid] = camera_id
    
    # Notify the streamer that a new viewer joined (send to streamer's socket)
    streamer_sid = active_cameras[camera_id]['socket_id']
    emit('new_viewer', {'viewer_id': request.sid}, room=streamer_sid)
    print(f'Viewer {request.sid} joined camera {camera_id}, viewers: {active_cameras[camera_id]["viewers"]}')

@socketio.on('leave_camera')
def handle_leave_camera(data):
    """Handle viewer leaving a camera stream"""
    camera_id = data.get('camera_id')
    
    if camera_id in active_cameras:
        leave_room(camera_id)
        active_cameras[camera_id]['viewers'] = max(0, active_cameras[camera_id]['viewers'] - 1)
        if request.sid in viewer_rooms:
            del viewer_rooms[request.sid]
        print(f'Viewer left camera {camera_id}')

# WebRTC Signaling Events

@socketio.on('offer')
def handle_offer(data):
    """Forward WebRTC offer from streamer to viewer"""
    target = data.get('target')
    if target:
        emit('offer', {
            'offer': data.get('offer'),
            'from': request.sid
        }, room=target)

@socketio.on('answer')
def handle_answer(data):
    """Forward WebRTC answer from viewer to streamer"""
    target = data.get('target')
    if target:
        emit('answer', {
            'answer': data.get('answer'),
            'from': request.sid
        }, room=target)

@socketio.on('ice_candidate')
def handle_ice_candidate(data):
    """Forward ICE candidates between peers"""
    target = data.get('target')
    if target:
        emit('ice_candidate', {
            'candidate': data.get('candidate'),
            'from': request.sid
        }, room=target)

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)