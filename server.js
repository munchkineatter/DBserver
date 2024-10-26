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
                    timerData: null,
                    sessionLog: []
                });
                ws.send(JSON.stringify({
                    type: 'session_created',
                    sessionId,
                    sessionLog: sessions.get(sessionId).sessionLog  // Send existing session log
                }));
                break;

            case 'join_session':
                sessionId = data.sessionId;
                deviceRole = 'viewer';
                const session = sessions.get(sessionId);
                
                if (session) {
                    session.viewers.add(ws);
                    // Send only unique sessions
                    const uniqueSessionLog = Array.from(new Map(
                        session.sessionLog.map(item => [item.id, item])
                    ).values());
                    
                    ws.send(JSON.stringify({
                        type: 'session_joined',
                        sessionId,
                        isActive: session.isActive,
                        timerData: session.timerData,
                        sessionLog: uniqueSessionLog  // Send deduplicated session log
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
                    // Broadcast to all viewers AND back to recorder
                    session.viewers.forEach(viewer => {
                        viewer.send(JSON.stringify({
                            type: 'decibel_update',
                            data: data.data
                        }));
                    });
                    // Send back to recorder for confirmation
                    ws.send(JSON.stringify({
                        type: 'decibel_update',
                        data: data.data
                    }));
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

            case 'session_recorded':
                if (sessionId && sessions.has(sessionId)) {
                    const session = sessions.get(sessionId);
                    // Store the session in the server's log
                    if (!session.sessionLog) {
                        session.sessionLog = [];
                    }
                    
                    // Check for duplicates using timestamp proximity
                    const isDuplicate = session.sessionLog.some(s => 
                        Math.abs(new Date(s.timestamp) - new Date(data.session.timestamp)) < 1000
                    );
                    
                    if (!isDuplicate) {
                        // Ensure correct session number
                        data.session.sessionNumber = session.sessionLog.length + 1;
                        session.sessionLog.push(data.session);
                        
                        // Prepare the message to send
                        const messageToSend = JSON.stringify({
                            type: 'session_recorded',
                            session: data.session
                        });
                        
                        // Broadcast to all viewers
                        session.viewers.forEach(viewer => {
                            viewer.send(messageToSend);
                        });
                        
                        // **Send to the recorder as well**
                        if (session.recorder && session.recorder.readyState === WebSocket.OPEN) {
                            session.recorder.send(messageToSend);
                        }
                    }
                }
                break;

            case 'session_reset':
                console.log(`[Server] Received session_reset from ${deviceRole}, sessionId: ${sessionId}`);
                if (sessionId && sessions.has(sessionId)) {
                    const session = sessions.get(sessionId);

                    // Clear the session data on the server
                    session.sessionLog = [];
                    session.readings = [];
                    session.timerData = null;

                    const resetMessage = JSON.stringify({
                        type: 'session_reset',
                        sessionId: sessionId,
                        clearLog: true
                    });

                    // Send reset message to all viewers
                    console.log(`[Server] Broadcasting reset to ${session.viewers.size} viewer(s)`);
                    session.viewers.forEach(viewer => {
                        if (viewer.readyState === WebSocket.OPEN) {
                            console.log('[Server] Sending session_reset to viewer');
                            viewer.send(resetMessage);
                        }
                    });

                    // Also send reset confirmation to recorder
                    if (session.recorder && session.recorder.readyState === WebSocket.OPEN) {
                        console.log('[Server] Sending reset confirmation to recorder');
                        session.recorder.send(resetMessage);
                    }
                }
                break;

            case 'reset_view_log':
                console.log(`[Server] Received reset_view_log from ${deviceRole}, sessionId: ${sessionId}`);
                if (sessionId && sessions.has(sessionId)) {
                    const session = sessions.get(sessionId);
                    
                    // Clear the session log on the server
                    session.sessionLog = [];
                    
                    const resetViewMessage = JSON.stringify({
                        type: 'reset_view_log',
                        clearAll: true
                    });

                    // Send reset message to all viewers
                    console.log(`[Server] Broadcasting reset_view_log to ${session.viewers.size} viewer(s)`);
                    session.viewers.forEach(viewer => {
                        if (viewer.readyState === WebSocket.OPEN) {
                            console.log('[Server] Sending reset_view_log to viewer');
                            viewer.send(resetViewMessage);
                        }
                    });

                    // Also send confirmation back to recorder
                    if (session.recorder && session.recorder.readyState === WebSocket.OPEN) {
                        console.log('[Server] Sending reset_view_log confirmation to recorder');
                        session.recorder.send(resetViewMessage);
                    }
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
