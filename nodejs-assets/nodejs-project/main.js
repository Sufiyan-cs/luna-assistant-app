const rn_bridge = require('rn-bridge');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const { OpenAI } = require('openai');
const path = require('path');
const fs = require('fs');

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
    rn_bridge.channel.send({ type: 'log', data: msg });
}

// Setup OpenAI
function setupOpenAI() {
    if (config.nvidiaApiKey) {
        openai = new OpenAI({
            apiKey: config.nvidiaApiKey,
            baseURL: 'https://integrate.api.nvidia.com/v1',
        });
        sendLog("OpenAI (NVIDIA) client initialized.");
    } else {
        sendLog("Warning: NVIDIA API Key is missing. Luna will not be able to reply.");
    }
}

async function connectToWhatsApp() {
    sendLog("Initializing Baileys connection...");
    
    // Store auth state in the app's internal storage
    const authFolder = path.join(__dirname, 'baileys_auth_info');
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), // Silence internal logs to keep UI clean
        browser: ['Luna Assistant', 'Chrome', '1.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            // Send raw QR text to React Native to render
            rn_bridge.channel.send({ type: 'qr', data: qr });
            sendLog("QR code received. Scan it in the app.");
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            sendLog(`Connection closed due to: ${lastDisconnect?.error?.message || 'Unknown error'}`);
            rn_bridge.channel.send({ type: 'status', data: 'disconnected' });
            
            if (shouldReconnect) {
                sendLog("Reconnecting...");
                connectToWhatsApp();
            } else {
                sendLog("Logged out. Please delete auth info and scan again.");
                rn_bridge.channel.send({ type: 'status', data: 'logged_out' });
            }
        } else if (connection === 'open') {
            sendLog("Luna is online and ready!");
            rn_bridge.channel.send({ type: 'status', data: 'connected' });
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        // Ignore messages sent by ourselves, status updates, or missing text
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.remoteJid.endsWith('@g.us')) return; // Ignore groups
        
        // Time filter (Baileys timestamp is in seconds)
        if (msg.messageTimestamp < startTime) return;

        const remoteJid = msg.key.remoteJid;
        
        // Extract text depending on message type
        const incomingText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!incomingText) return;

        const contactNumber = remoteJid.split('@')[0];

        // Check exclusions
        if (config.excludedNumbers.includes(contactNumber)) {
            sendLog(`Ignored excluded contact: ${contactNumber}`);
            return;
        }

        sendLog(`Received from ${contactNumber}: ${incomingText}`);

        if (!openai) {
            sendLog(`Cannot reply to ${contactNumber} - No NVIDIA API Key set.`);
            return;
        }

        // Initialize history
        if (!chatHistories[remoteJid]) {
            chatHistories[remoteJid] = [
                { role: "system", content: config.systemPrompt }
            ];
        }

        chatHistories[remoteJid].push({ role: "user", content: incomingText });

        // Cap history to 15 messages (1 system + 14 chat)
        if (chatHistories[remoteJid].length > 15) {
            chatHistories[remoteJid] = [
                chatHistories[remoteJid][0],
                ...chatHistories[remoteJid].slice(-14)
            ];
        }

        try {
            sendLog(`Luna is processing response...`);
            
            // Show typing indicator
            await sock.sendPresenceUpdate('composing', remoteJid);

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
            
            await sock.sendPresenceUpdate('paused', remoteJid);
            await sock.sendMessage(remoteJid, { text: replyText });
            
            sendLog(`Luna sent: ${replyText}`);

        } catch (error) {
            sendLog(`Error generating response: ${error.message}`);
        }
    });
}

// Listen for messages from React Native
rn_bridge.channel.on('message', (msg) => {
    try {
        if (msg.type === 'start') {
            startTime = Math.floor(Date.now() / 1000);
            connectToWhatsApp();
        } else if (msg.type === 'config') {
            config = { ...config, ...msg.data };
            setupOpenAI();
            sendLog("Configuration updated from UI.");
        } else if (msg.type === 'logout') {
             if (sock) {
                 sock.logout();
                 sendLog("Logged out manually.");
             }
        }
    } catch (e) {
        sendLog(`Bridge error: ${e.message}`);
    }
});

// Tell React Native we are ready
rn_bridge.channel.send({ type: 'backend_ready' });
