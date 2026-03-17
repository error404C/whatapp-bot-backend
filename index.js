const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Store sessions
const activeSessions = new Map();

io.on('connection', (socket) => {
    console.log('✅ Client connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('❌ Client disconnected:', socket.id);
    });
});

// Generate session ID
function generateSessionId() {
    return uuidv4().substring(0, 8);
}

// API endpoint to start WhatsApp Web
app.post('/api/start-whatsapp', (req, res) => {
    try {
        const { phoneNumber, socketId } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number required' });
        }

        console.log('📱 Phone number received:', phoneNumber);
        
        const sessionId = generateSessionId();
        
        // Store session
        activeSessions.set(sessionId, {
            phoneNumber: phoneNumber,
            status: 'starting',
            createdAt: new Date()
        });

        // Get socket
        const socket = socketId ? io.sockets.sockets.get(socketId) : null;

        if (socket) {
            console.log('📤 Sending test code to client');
            
            // Send a test code after 3 seconds
            setTimeout(() => {
                const testCode = "2222-6666";
                socket.emit('code_ready', { 
                    code: testCode,
                    message: 'Enter this code in WhatsApp'
                });
                console.log('✅ Test code sent:', testCode);
            }, 3000);
        }

        res.json({ 
            success: true, 
            sessionId,
            message: 'WhatsApp Web started'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'alive', 
        time: new Date().toISOString(),
        sessions: activeSessions.size 
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
