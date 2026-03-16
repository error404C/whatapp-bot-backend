const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

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

// Store active sessions
const activeSessions = new Map();

// Create sessions directory
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir);
}

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Generate session ID
function generateSessionId() {
    return uuidv4().substring(0, 8);
}

// Create WhatsApp client
function createWhatsAppClient(sessionId, phoneNumber, socket) {
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: sessionId,
            dataPath: sessionsDir
        }),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    // This is the key part - handle the authentication code
    client.on('authenticated', () => {
        console.log(`Client ${sessionId} authenticated`);
        const session = activeSessions.get(sessionId);
        if (session) {
            session.status = 'authenticated';
        }
    });

    client.on('ready', async () => {
        console.log(`Client ${sessionId} is ready!`);
        
        const session = activeSessions.get(sessionId);
        if (session) {
            session.status = 'connected';
            
            // Send session ID to user
            try {
                const chatId = `${session.phoneNumber}@c.us`;
                await client.sendMessage(chatId, 
                    '✅ *WhatsApp Bot Connected!*\n\n' +
                    'Your Session ID: `' + sessionId + '`\n\n' +
                    'Copy this ID and paste it in the website to link your bot.\n\n' +
                    'Commands:\n' +
                    '*.menu* - Show all commands\n' +
                    '*.ping* - Test bot'
                );
            } catch (error) {
                console.error('Error sending message:', error);
            }
        }
        
        if (socket) {
            socket.emit('ready', { sessionId, phoneNumber: session?.phoneNumber });
        }
    });

    client.on('auth_failure', (msg) => {
        console.error(`Auth failure for session ${sessionId}:`, msg);
        const session = activeSessions.get(sessionId);
        if (session) {
            session.status = 'auth_failed';
            session.error = msg;
        }
        if (socket) {
            socket.emit('auth_failure', { sessionId, error: msg });
        }
    });

    client.on('disconnected', (reason) => {
        console.log(`Client ${sessionId} disconnected:`, reason);
        const session = activeSessions.get(sessionId);
        if (session) {
            session.status = 'disconnected';
        }
    });

    client.on('message', async (message) => {
        const session = activeSessions.get(sessionId);
        if (!session) return;
        
        const ownerId = `${session.phoneNumber}@c.us`;
        
        if (message.from === ownerId && !message.fromMe) {
            const cmd = message.body.toLowerCase();
            
            if (cmd === '.menu') {
                await message.reply(
                    '📱 *BOT MENU* 📱\n\n' +
                    '*.menu* - Show this menu\n' +
                    '*.ping* - Check bot response\n' +
                    '*.time* - Current time\n' +
                    '*.info* - Bot information\n' +
                    '*.session* - Show session ID'
                );
            }
            else if (cmd === '.ping') {
                await message.reply('Pong! 🏓');
            }
            else if (cmd === '.time') {
                await message.reply(`Time: ${new Date().toLocaleString()}`);
            }
            else if (cmd === '.info') {
                await message.reply(`Bot Info\nSession: ${sessionId}\nStatus: Active`);
            }
            else if (cmd === '.session') {
                await message.reply(`Your Session ID: \`${sessionId}\``);
            }
        }
    });

    return client;
}

// API Routes
app.post('/api/init-session', (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number required' });
        }

        const cleanNumber = phoneNumber.replace(/\D/g, '');
        const sessionId = generateSessionId();
        
        // Store session
        activeSessions.set(sessionId, {
            phoneNumber: cleanNumber,
            status: 'initializing',
            createdAt: new Date()
        });

        // Get socket ID from request
        const { socketId } = req.body;
        const socket = socketId ? io.sockets.sockets.get(socketId) : null;

        // Create and initialize client
        const client = createWhatsAppClient(sessionId, cleanNumber, socket);
        activeSessions.get(sessionId).client = client;
        
        // Initialize client
        client.initialize();

        res.json({ 
            success: true, 
            sessionId,
            message: 'Session initializing. Check your WhatsApp for the code.'
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/link-bot', async (req, res) => {
    try {
        const { sessionId, phoneNumber } = req.body;
        
        const session = activeSessions.get(sessionId);
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (session.status !== 'connected') {
            return res.status(400).json({ error: 'Session not connected' });
        }

        // Send confirmation
        const client = session.client;
        const chatId = `${session.phoneNumber}@c.us`;
        
        await client.sendMessage(chatId,
            '🔗 *Bot Linked Successfully!*\n\n' +
            'Your bot is now active. Try sending *.menu*'
        );

        res.json({ success: true, message: 'Bot linked' });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to link bot' });
    }
});

app.get('/api/session-status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json({
        sessionId,
        status: session.status,
        phoneNumber: session.phoneNumber
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'alive', sessions: activeSessions.size });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
