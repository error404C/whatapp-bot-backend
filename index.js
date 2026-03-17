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
    console.log('Client connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

function generateSessionId() {
    return uuidv4().substring(0, 8);
}

// This is the important part - WhatsApp Web automation
async function startWhatsAppWeb(sessionId, phoneNumber, socket) {
    console.log(`Starting WhatsApp Web for ${phoneNumber}`);
    
    try {
        // Launch browser
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch({
            headless: false, // Change to true for production
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Store browser in session
        const session = activeSessions.get(sessionId);
        if (session) {
            session.browser = browser;
            session.page = page;
            session.status = 'browser_ready';
        }
        
        // Go to WhatsApp Web
        await page.goto('https://web.whatsapp.com');
        console.log('WhatsApp Web loaded');
        
        // Wait for page to load
        await page.waitForTimeout(5000);
        
        // Look for phone number input
        await page.waitForSelector('input[type="tel"]', { timeout: 30000 });
        
        // Type phone number
        const phoneInput = await page.$('input[type="tel"]');
        await phoneInput.type(phoneNumber);
        await page.waitForTimeout(2000);
        
        // Click next button
        const nextButton = await page.$('button[type="button"]');
        if (nextButton) {
            await nextButton.click();
        }
        
        console.log('Waiting for code...');
        
        // Wait for code to appear
        let code = null;
        let attempts = 0;
        
        while (!code && attempts < 30) {
            // Look for code pattern (like 123-456)
            const pageContent = await page.content();
            const codeMatch = pageContent.match(/(\d{3,4}-\d{3,4})/);
            if (codeMatch) {
                code = codeMatch[1];
                break;
            }
            await page.waitForTimeout(1000);
            attempts++;
        }
        
        if (code) {
            console.log(`Code found: ${code}`);
            
            if (session) {
                session.code = code;
                session.status = 'code_ready';
            }
            
            // Send code to website
            if (socket) {
                socket.emit('code_ready', { 
                    code: code,
                    message: 'Enter this code in WhatsApp'
                });
            }
            
            // Wait for connection (user enters code on phone)
            await page.waitForSelector('div[data-testid="chat-list"]', { timeout: 120000 })
                .catch(() => console.log('Waiting for connection...'));
            
            // Check if connected
            const connected = await page.$('div[data-testid="chat-list"]') !== null;
            
            if (connected) {
                console.log('Connected successfully!');
                
                if (session) {
                    session.status = 'connected';
                }
                
                if (socket) {
                    socket.emit('connected', {
                        sessionId: sessionId,
                        message: 'WhatsApp connected!'
                    });
                }
            }
        } else {
            console.log('No code found');
            if (socket) {
                socket.emit('error', { message: 'Could not get code' });
            }
        }
        
    } catch (error) {
        console.error('Error:', error);
        if (socket) {
            socket.emit('error', { message: error.message });
        }
    }
}

// API endpoint
app.post('/api/start-whatsapp', (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number required' });
        }

        const cleanNumber = phoneNumber.replace(/\D/g, '');
        const sessionId = generateSessionId();
        
        activeSessions.set(sessionId, {
            phoneNumber: cleanNumber,
            status: 'starting',
            createdAt: new Date()
        });

        const { socketId } = req.body;
        const socket = socketId ? io.sockets.sockets.get(socketId) : null;

        // Start WhatsApp Web
        startWhatsAppWeb(sessionId, cleanNumber, socket);

        res.json({ 
            success: true, 
            sessionId,
            message: 'Starting WhatsApp Web'
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'alive' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
