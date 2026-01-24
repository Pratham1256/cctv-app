(function() {
    let connectionLostTimeout = null;
    let isConnected = true;
    
    if (typeof socket !== 'undefined') {
        socket.on('connect', () => {
            console.log('[Monitor] Connected');
            isConnected = true;
            clearTimeout(connectionLostTimeout);
            
            const existingBanner = document.getElementById('connection-banner');
            if (existingBanner) {
                existingBanner.remove();
            }
        });
        
        socket.on('disconnect', () => {
            console.log('[Monitor] Disconnected');
            isConnected = false;
            
            connectionLostTimeout = setTimeout(() => {
                if (!isConnected) {
                    showConnectionBanner('Connection lost. Attempting to reconnect...', 'warning');
                }
            }, 5000);
        });
        
        socket.on('connect_error', (error) => {
            console.error('[Monitor] Connection error:', error);
            showConnectionBanner('Connection error. Please check your internet.', 'error');
        });
        
        socket.on('reconnect', (attemptNumber) => {
            console.log('[Monitor] Reconnected after', attemptNumber, 'attempts');
            showConnectionBanner('Reconnected successfully!', 'success');
            setTimeout(() => {
                const banner = document.getElementById('connection-banner');
                if (banner) banner.remove();
            }, 3000);
        });
    }
    
    function showConnectionBanner(message, type) {
        const existingBanner = document.getElementById('connection-banner');
        if (existingBanner) {
            existingBanner.remove();
        }
        
        const banner = document.createElement('div');
        banner.id = 'connection-banner';
        banner.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            padding: 15px;
            text-align: center;
            z-index: 10000;
            font-weight: 600;
            color: white;
        `;
        
        if (type === 'warning') {
            banner.style.background = '#f59e0b';
        } else if (type === 'error') {
            banner.style.background = '#ef4444';
        } else if (type === 'success') {
            banner.style.background = '#10b981';
        }
        
        banner.textContent = message;
        document.body.insertBefore(banner, document.body.firstChild);
    }
})();