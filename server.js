const WebSocket = require('ws');
const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

const wss = new WebSocket.Server({ server });

// Store active sessions
const sessions = new Map();

wss.on('connection', (ws) => {
    let sessionId = null;
    let deviceRole = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch(data.type) {
            case 'create_session':
                sessionId = Date.now().toString();
                deviceRole = 'recorder';
                sessions.set(sessionId, {
                    recorder: ws,
                    viewers: new Set(),
                });
                ws.send(JSON.stringify({
                    type: 'session_created',
                    sessionId
                }));
                break;

            case 'join_session':
                sessionId = data.sessionId;
                deviceRole = 'viewer';
                const session = sessions.get(sessionId);
                if (session) {
                    session.viewers.add(ws);
                    ws.send(JSON.stringify({
                        type: 'session_joined',
                        sessionId
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Session not found'
                    }));
                }
                break;

            case 'decibel_data':
                if (sessionId && sessions.has(sessionId)) {
                    const session = sessions.get(sessionId);
                    // Broadcast to all viewers
                    session.viewers.forEach(viewer => {
                        viewer.send(JSON.stringify({
                            type: 'decibel_update',
                            data: data.data
                        }));
                    });
                }
                break;
        }
    });

    ws.on('close', () => {
        if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId);
            if (deviceRole === 'recorder') {
                // Notify all viewers that session has ended
                session.viewers.forEach(viewer => {
                    viewer.send(JSON.stringify({
                        type: 'session_ended'
                    }));
                });
                sessions.delete(sessionId);
            } else if (deviceRole === 'viewer') {
                session.viewers.delete(ws);
            }
        }
    });
});
