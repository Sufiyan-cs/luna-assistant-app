const rn_bridge = require('rn-bridge');
const path = require('path');
const fs = require('fs');

// Wrap everything in try-catch so the backend never silently dies
try {

let sock = null;
let openai = null;
let chatHistories = {};
let startTime = Math.floor(Date.now() / 1000);

// Default settings (can be updated from React Native)
let config = {
    systemPrompt: "You are Luna, the personal and highly capable WhatsApp assistant to Sufiyan.\nYour role is to manage his incoming messages, schedule, and communications like a real human assistant.\n\nPERSONALITY TRAITS:\n- Warm, polite, and deeply professional.\n- You speak conversationally, exactly like a human assistant texting on WhatsApp. No robotic formatting.\n- Keep your replies relatively short and natural, suitable for text messaging.\n- You are highly protective of Sufiyan's time.\n\nKEY RULES:\n1. Always introduce yourself gracefully if the person seems to not know they are speaking to an assistant.\n2. If it's a casual greeting, respond warmly and ask how you can help on Sufiyan's behalf.\n3. If someone asks for a meeting or favor, politely let them know you will pass the message to Sufiyan.\n4. Never make up facts about Sufiyan's schedule. Instead, say you need to check with him.\n5. Do not use robotic phrases like 'As an AI language model'. You are strictly Luna, the human assistant.",
    excludedNumbers: [],
    nvidiaApiKey: ""
};

// Helper to send logs to UI
function sendLog(msg) {
    try {
        rn_bridge.channel.send({ type: 'log', data: String(msg) });
    } catch (e) {
        // If the bridge is broken, we can't do much
        console.error('sendLog failed:', e);
    }
}

// Setup OpenAI client
function setupOpenAI() {
    try {
        if (config.nvidiaApiKey) {
            const { OpenAI } = require('openai');
            openai = new OpenAI({
                apiKey: config.nvidiaApiKey,
                baseURL: 'https://integrate.api.nvidia.com/v1',
            });
            sendLog("OpenAI (NVIDIA) client initialized.");
        } else {
            sendLog("Warning: NVIDIA API Key is missing. Luna will not be able to reply.");
        }
    } catch (e) {
        sendLog("Error initializing OpenAI: " + e.message);
    }
}

async function connectToWhatsApp() {
    try {
        sendLog("Initializing Baileys connection...");
        
        const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
        const pino = require('pino');
        
        // Store auth state in the app's writable directory
        const authFolder = path.join(rn_bridge.app.datadir(), 'baileys_auth_info');
        
        // Ensure auth folder exists
        if (!fs.existsSync(authFolder)) {
            fs.mkdirSync(authFolder, { recursive: true });
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['Luna Assistant', 'Chrome', '1.0.0'],
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            try {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) {
                    rn_bridge.channel.send({ type: 'qr', data: qr });
                    sendLog("QR code generated. Scan it with WhatsApp.");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    
                    sendLog(`Connection closed (code: ${statusCode || 'unknown'}): ${lastDisconnect?.error?.message || 'Unknown'}`);
                    rn_bridge.channel.send({ type: 'status', data: 'disconnected' });
                    
                    if (shouldReconnect) {
                        sendLog("Reconnecting in 3 seconds...");
                        setTimeout(() => connectToWhatsApp(), 3000);
                    } else {
                        sendLog("Logged out. Tap START BOT to reconnect.");
                        rn_bridge.channel.send({ type: 'status', data: 'logged_out' });
                        // Clean up auth so fresh QR is shown
                        try {
                            if (fs.existsSync(authFolder)) {
                                fs.rmSync(authFolder, { recursive: true, force: true });
                            }
                        } catch (cleanErr) {
                            sendLog("Warning: Could not clean auth folder: " + cleanErr.message);
                        }
                    }
                } else if (connection === 'open') {
                    sendLog("Luna is online and ready!");
                    rn_bridge.channel.send({ type: 'status', data: 'connected' });
                }
            } catch (connErr) {
                sendLog("Connection handler error: " + connErr.message);
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                
                // Safety checks
                if (!msg || !msg.message || !msg.key) return;
                if (msg.key.fromMe) return;
                if (msg.key.remoteJid === 'status@broadcast') return;
                if (msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us')) return;
                
                // Time filter
                if (msg.messageTimestamp && msg.messageTimestamp < startTime) return;

                const remoteJid = msg.key.remoteJid;
                if (!remoteJid) return;
                
                // Extract text
                const incomingText = msg.message.conversation 
                    || msg.message.extendedTextMessage?.text 
                    || "";
                if (!incomingText) return;

                const contactNumber = remoteJid.split('@')[0];

                // Check exclusions
                if (config.excludedNumbers.includes(contactNumber)) {
                    sendLog(`Ignored excluded: ${contactNumber}`);
                    return;
                }

                sendLog(`From ${contactNumber}: ${incomingText.substring(0, 50)}${incomingText.length > 50 ? '...' : ''}`);

                if (!openai) {
                    sendLog(`Cannot reply - No API key set.`);
                    return;
                }

                // Initialize or retrieve chat history
                if (!chatHistories[remoteJid]) {
                    chatHistories[remoteJid] = [
                        { role: "system", content: config.systemPrompt }
                    ];
                }

                chatHistories[remoteJid].push({ role: "user", content: incomingText });

                // Cap history to 15 messages
                if (chatHistories[remoteJid].length > 15) {
                    chatHistories[remoteJid] = [
                        chatHistories[remoteJid][0],
                        ...chatHistories[remoteJid].slice(-14)
                    ];
                }

                sendLog(`Generating response...`);
                
                // Show typing indicator
                try {
                    await sock.sendPresenceUpdate('composing', remoteJid);
                } catch (_) { /* typing indicator is non-critical */ }

                const completion = await openai.chat.completions.create({
                    model: "meta/llama-3.3-70b-instruct",
                    messages: chatHistories[remoteJid],
                    temperature: 0.7,
                    max_tokens: 150,
                });

                let replyText = completion.choices[0].message.content.trim();
                chatHistories[remoteJid].push({ role: "assistant", content: replyText });

                // Small delay for typing realism
                const typingDelay = Math.min(replyText.length * 15, 1500); 
                await new Promise(resolve => setTimeout(resolve, typingDelay));
                
                try {
                    await sock.sendPresenceUpdate('paused', remoteJid);
                } catch (_) { /* non-critical */ }
                
                await sock.sendMessage(remoteJid, { text: replyText });
                sendLog(`Replied to ${contactNumber}: ${replyText.substring(0, 60)}${replyText.length > 60 ? '...' : ''}`);

            } catch (error) {
                sendLog(`Response error: ${error.message}`);
            }
        });
        
        sendLog("Baileys event listeners registered.");
        
    } catch (error) {
        sendLog(`WhatsApp connection error: ${error.message}`);
        sendLog(`Stack: ${error.stack || 'N/A'}`);
    }
}

// Listen for messages from React Native
rn_bridge.channel.on('message', (msg) => {
    try {
        if (!msg || !msg.type) return;
        
        if (msg.type === 'start') {
            startTime = Math.floor(Date.now() / 1000);
            chatHistories = {}; // Reset histories on fresh start
            connectToWhatsApp();
        } else if (msg.type === 'config') {
            if (msg.data) {
                config = { ...config, ...msg.data };
                setupOpenAI();
                sendLog("Configuration updated.");
            }
        } else if (msg.type === 'logout') {
            if (sock) {
                try {
                    sock.logout();
                    sendLog("Logged out manually.");
                } catch (logoutErr) {
                    sendLog("Logout error: " + logoutErr.message);
                }
                sock = null;
            }
        }
    } catch (e) {
        sendLog(`Bridge error: ${e.message}`);
    }
});

// Tell React Native we are ready
sendLog("Node.js backend loaded successfully.");
rn_bridge.channel.send({ type: 'backend_ready' });

// Catch unhandled errors so the backend doesn't silently die
process.on('uncaughtException', (err) => {
    sendLog(`Uncaught Exception: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
    sendLog(`Unhandled Rejection: ${reason}`);
});

} catch (fatalErr) {
    // If even the bootstrap fails, try to tell the UI
    try {
        rn_bridge.channel.send({ type: 'log', data: 'FATAL BACKEND ERROR: ' + fatalErr.message });
    } catch (_) {
        console.error('Complete backend failure:', fatalErr);
    }
}
