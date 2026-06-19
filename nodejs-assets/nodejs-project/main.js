// Ultra-minimal backend - just test if Node.js engine works
var rn_bridge = require('rn-bridge');

rn_bridge.channel.send({ type: 'log', data: 'Backend alive! Node.js engine works.' });
rn_bridge.channel.send({ type: 'backend_ready' });

// Keep process alive and listen for commands
rn_bridge.channel.on('message', function(msg) {
    try {
        rn_bridge.channel.send({ type: 'log', data: 'Got command: ' + JSON.stringify(msg) });
        
        if (msg.type === 'start') {
            rn_bridge.channel.send({ type: 'log', data: 'Loading dependencies...' });
            
            // Lazy-load everything only when START is pressed
            var path = require('path');
            var fs = require('fs');
            rn_bridge.channel.send({ type: 'log', data: 'Core modules OK' });
            
            var pino = require('pino');
            rn_bridge.channel.send({ type: 'log', data: 'pino OK' });
            
            var OpenAI = require('openai').OpenAI;
            rn_bridge.channel.send({ type: 'log', data: 'openai OK' });
            
            var baileys = require('@whiskeysockets/baileys');
            rn_bridge.channel.send({ type: 'log', data: 'baileys OK - All deps loaded!' });
            
            // Now actually connect
            startWhatsApp(msg, baileys, pino, OpenAI, path, fs);
        }
    } catch (e) {
        rn_bridge.channel.send({ type: 'log', data: 'ERROR: ' + e.message + '\n' + (e.stack || '') });
    }
});

// Global config
var config = {
    systemPrompt: '',
    excludedNumbers: [],
    nvidiaApiKey: ''
};
var sock = null;
var openai = null;
var chatHistories = {};
var startTime = 0;

function log(msg) {
    try { rn_bridge.channel.send({ type: 'log', data: String(msg) }); } catch(_) {}
}

async function startWhatsApp(initMsg, baileys, pino, OpenAI, path, fs) {
    try {
        // Apply config if sent
        if (initMsg && initMsg.data) {
            // Config might have been sent as a separate message before start
        }
        
        // Setup OpenAI
        if (config.nvidiaApiKey) {
            openai = new OpenAI({
                apiKey: config.nvidiaApiKey,
                baseURL: 'https://integrate.api.nvidia.com/v1',
            });
            log('NVIDIA AI client ready.');
        } else {
            log('Warning: No API key - Luna cannot reply.');
        }
        
        startTime = Math.floor(Date.now() / 1000);
        log('Connecting to WhatsApp...');
        
        // Use app data dir for auth (writable)
        var authFolder;
        try {
            authFolder = path.join(rn_bridge.app.datadir(), 'baileys_auth');
        } catch (_) {
            authFolder = path.join(__dirname, 'baileys_auth');
        }
        
        if (!fs.existsSync(authFolder)) {
            fs.mkdirSync(authFolder, { recursive: true });
        }
        
        var authState = await baileys.useMultiFileAuthState(authFolder);
        
        sock = baileys.default({
            auth: authState.state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['Luna Assistant', 'Chrome', '1.0.0'],
        });
        
        sock.ev.on('creds.update', authState.saveCreds);
        
        sock.ev.on('connection.update', function(update) {
            try {
                if (update.qr) {
                    rn_bridge.channel.send({ type: 'qr', data: update.qr });
                    log('QR code ready - scan with WhatsApp.');
                }
                if (update.connection === 'close') {
                    var code = update.lastDisconnect?.error?.output?.statusCode;
                    log('Disconnected (code: ' + (code || '?') + ')');
                    rn_bridge.channel.send({ type: 'status', data: 'disconnected' });
                    
                    if (code !== baileys.DisconnectReason.loggedOut) {
                        log('Reconnecting in 3s...');
                        setTimeout(function() { startWhatsApp(null, baileys, pino, OpenAI, path, fs); }, 3000);
                    } else {
                        rn_bridge.channel.send({ type: 'status', data: 'logged_out' });
                        try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch(_) {}
                    }
                } else if (update.connection === 'open') {
                    log('Luna is ONLINE! ✅');
                    rn_bridge.channel.send({ type: 'status', data: 'connected' });
                }
            } catch (e) {
                log('Connection error: ' + e.message);
            }
        });
        
        sock.ev.on('messages.upsert', async function(m) {
            try {
                var msg = m.messages[0];
                if (!msg || !msg.message || !msg.key) return;
                if (msg.key.fromMe) return;
                if (msg.key.remoteJid === 'status@broadcast') return;
                if (msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us')) return;
                if (msg.messageTimestamp && msg.messageTimestamp < startTime) return;
                
                var jid = msg.key.remoteJid;
                if (!jid) return;
                
                var text = msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || '';
                if (!text) return;
                
                var num = jid.split('@')[0];
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
                
                var completion = await openai.chat.completions.create({
                    model: 'meta/llama-3.3-70b-instruct',
                    messages: chatHistories[jid],
                    temperature: 0.7,
                    max_tokens: 150,
                });
                
                var reply = completion.choices[0].message.content.trim();
                chatHistories[jid].push({ role: 'assistant', content: reply });
                
                var delay = Math.min(reply.length * 15, 1500);
                await new Promise(function(r) { setTimeout(r, delay); });
                
                try { await sock.sendPresenceUpdate('paused', jid); } catch(_) {}
                await sock.sendMessage(jid, { text: reply });
                log('Replied to ' + num + ': ' + reply.substring(0, 60));
                
            } catch (e) {
                log('Message error: ' + e.message);
            }
        });
        
    } catch (e) {
        log('WhatsApp error: ' + e.message);
        log('Stack: ' + (e.stack || 'N/A'));
    }
}

// Handle config updates
rn_bridge.channel.on('message', function(msg) {
    if (msg && msg.type === 'config' && msg.data) {
        config = {
            systemPrompt: msg.data.systemPrompt || config.systemPrompt,
            excludedNumbers: msg.data.excludedNumbers || config.excludedNumbers,
            nvidiaApiKey: msg.data.nvidiaApiKey || config.nvidiaApiKey,
        };
        
        if (config.nvidiaApiKey) {
            try {
                var OpenAI = require('openai').OpenAI;
                openai = new OpenAI({
                    apiKey: config.nvidiaApiKey,
                    baseURL: 'https://integrate.api.nvidia.com/v1',
                });
            } catch(_) {}
        }
        log('Config updated.');
    }
});

process.on('uncaughtException', function(err) {
    try { log('UNCAUGHT: ' + err.message); } catch(_) {}
});
process.on('unhandledRejection', function(reason) {
    try { log('REJECTION: ' + reason); } catch(_) {}
});
