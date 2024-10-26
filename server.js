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

// Store active sessions with their data
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
                    isActive: true,
                    readings: [],
                    timerData: null  // Add timer data storage
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
                        sessionId,
                        isActive: session.isActive,
                        timerData: session.timerData  // Send current timer data
                    }));

                    // Send existing readings history to new viewer
                    if (session.readings.length > 0) {
                        session.readings.forEach(reading => {
                            ws.send(JSON.stringify({
                                type: 'decibel_update',
                                data: reading
                            }));
                        });
                    }

                    // If session is not active, send session_ended
                    if (!session.isActive) {
                        ws.send(JSON.stringify({
                            type: 'session_ended'
                        }));
                    }
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
                    // Store reading in session history
                    session.readings.push(data.data);
                    // Broadcast to all viewers
                    session.viewers.forEach(viewer => {
                        viewer.send(JSON.stringify({
                            type: 'decibel_update',
                            data: data.data
                        }));
                    });
                }
                break;

            case 'stop_session':
                if (sessionId && sessions.has(sessionId)) {
                    const session = sessions.get(sessionId);
                    session.isActive = false;
                    // Notify all viewers that session has ended
                    session.viewers.forEach(viewer => {
                        viewer.send(JSON.stringify({
                            type: 'session_ended'
                        }));
                    });
                }
                break;

            case 'timer_update':
                if (sessionId && sessions.has(sessionId)) {
                    const session = sessions.get(sessionId);
                    session.timerData = data.timerData;
                    // Broadcast timer update to all viewers
                    session.viewers.forEach(viewer => {
                        viewer.send(JSON.stringify({
                            type: 'timer_update',
                            timerData: data.timerData
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
                session.isActive = false;
                // Notify all viewers that session has ended
                session.viewers.forEach(viewer => {
                    viewer.send(JSON.stringify({
                        type: 'session_ended'
                    }));
                });
                // Keep session data for a while before deleting
                setTimeout(() => {
                    sessions.delete(sessionId);
                }, 3600000); // Keep session for 1 hour
            } else if (deviceRole === 'viewer') {
                session.viewers.delete(ws);
            }
        }
    });
});
