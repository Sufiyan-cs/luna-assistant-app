const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

// Basic health check for Render
app.get('/', (req, res) => {
    res.send('Luna Assistant Backend is running.');
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' } // Allow React Native app to connect
});

// Global state
let sock = null;
let openai = null;
let chatHistories = {};
let startTime = 0;

let config = {
    systemPrompt: '',
    excludedNumbers: [],
    nvidiaApiKey: ''
};

const PORT = process.env.PORT || 3000;

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    
    // Helper to send logs to the connected React Native client
    function log(msg) {
        console.log(`[LOG] ${msg}`);
        socket.emit('log', String(msg));
    }

    // Send ready status to client
    socket.emit('backend_ready');

    socket.on('config', (data) => {
        if (data) {
            config = {
                systemPrompt: data.systemPrompt || config.systemPrompt,
                excludedNumbers: data.excludedNumbers || config.excludedNumbers,
                nvidiaApiKey: data.nvidiaApiKey || config.nvidiaApiKey,
            };
            
            if (config.nvidiaApiKey) {
                try {
                    const { OpenAI } = require('openai');
                    openai = new OpenAI({
                        apiKey: config.nvidiaApiKey,
                        baseURL: 'https://integrate.api.nvidia.com/v1',
                    });
                    log('NVIDIA AI client ready.');
                } catch(e) {
                    log('Error setting up OpenAI: ' + e.message);
                }
            }
            log('Config updated from app.');
        }
    });

    socket.on('start', async () => {
        log('Starting WhatsApp connection process...');
        startTime = Math.floor(Date.now() / 1000);
        chatHistories = {}; // Reset histories

        try {
            const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
            const pino = require('pino');

            const authFolder = path.join(__dirname, 'baileys_auth');
            if (!fs.existsSync(authFolder)) {
                fs.mkdirSync(authFolder, { recursive: true });
            }
            
            async function connectToWhatsApp() {
                const authState = await useMultiFileAuthState(authFolder);
                
                sock = makeWASocket({
                    auth: authState.state,
                    printQRInTerminal: false,
                    logger: pino({ level: 'silent' }),
                    browser: ['Luna Assistant', 'Chrome', '1.0.0'],
                });
                
                sock.ev.on('creds.update', authState.saveCreds);
                
                sock.ev.on('connection.update', function(update) {
                    try {
                        if (update.qr) {
                            socket.emit('qr', update.qr);
                            log('QR code ready - scan with WhatsApp.');
                        }
                        if (update.connection === 'close') {
                            const code = update.lastDisconnect?.error?.output?.statusCode;
                            log('Disconnected (code: ' + (code || '?') + ')');
                            socket.emit('status', 'disconnected');
                            
                            if (code !== DisconnectReason.loggedOut) {
                                log('Reconnecting in 3s...');
                                setTimeout(() => {
                                    socket.emit('log', 'Attempting reconnect...');
                                    connectToWhatsApp();
                                }, 3000);
                            } else {
                                socket.emit('status', 'logged_out');
                                try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch(_) {}
                            }
                        } else if (update.connection === 'open') {
                            log('Luna is ONLINE! ✅');
                            socket.emit('status', 'connected');
                        }
                    } catch (e) {
                        log('Connection error: ' + e.message);
                    }
                });
                
                sock.ev.on('messages.upsert', async function(m) {
                    try {
                        const msg = m.messages[0];
                        if (!msg || !msg.message || !msg.key) return;
                        if (msg.key.fromMe) return;
                        if (msg.key.remoteJid === 'status@broadcast') return;
                        if (msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us')) return;
                        if (msg.messageTimestamp && msg.messageTimestamp < startTime) return;
                        
                        const jid = msg.key.remoteJid;
                        if (!jid) return;
                        
                        const text = msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || '';
                        if (!text) return;
                        
                        const num = jid.split('@')[0];
                        if (config.excludedNumbers.indexOf(num) !== -1) {
                            log('Skipped excluded: ' + num);
                            return;
                        }
                        
                        log('From ' + num + ': ' + text.substring(0, 50));
                        
                        if (!openai) {
                            log('No API key - cannot reply.');
                            return;
                        }
                        
                        if (!chatHistories[jid]) {
                            chatHistories[jid] = [{ role: 'system', content: config.systemPrompt }];
                        }
                        chatHistories[jid].push({ role: 'user', content: text });
                        
                        if (chatHistories[jid].length > 15) {
                            chatHistories[jid] = [chatHistories[jid][0]].concat(chatHistories[jid].slice(-14));
                        }
                        
                        try { await sock.sendPresenceUpdate('composing', jid); } catch(_) {}
                        
                        const completion = await openai.chat.completions.create({
                            model: 'meta/llama-3.3-70b-instruct',
                            messages: chatHistories[jid],
                            temperature: 0.7,
                            max_tokens: 150,
                        });
                        
                        const reply = completion.choices[0].message.content.trim();
                        chatHistories[jid].push({ role: 'assistant', content: reply });
                        
                        const delay = Math.min(reply.length * 15, 1500);
                        await new Promise(r => setTimeout(r, delay));
                        
                        try { await sock.sendPresenceUpdate('paused', jid); } catch(_) {}
                        await sock.sendMessage(jid, { text: reply });
                        log('Replied to ' + num + ': ' + reply.substring(0, 60));
                        
                    } catch (e) {
                        log('Message error: ' + e.message);
                    }
                });
            }
            
            // Start the initial connection
            connectToWhatsApp();
            
        } catch (e) {
            log('WhatsApp error: ' + e.message);
            log('Stack: ' + (e.stack || 'N/A'));
        }
    });

    socket.on('logout', () => {
        log('Logout requested by app.');
        if (sock) {
            try {
                sock.logout();
                sock = null;
            } catch(e) {
                log('Logout error: ' + e.message);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        // We don't stop the bot when the client disconnects! That's the whole point of a server backend.
        // It keeps running in the background.
    });
});

server.listen(PORT, () => {
    console.log(`Luna Backend Server running on port ${PORT}`);
});
