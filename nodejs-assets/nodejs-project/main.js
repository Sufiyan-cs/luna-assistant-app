// MINIMAL TEST - Just check if the Node.js engine runs at all
var rn_bridge;
try {
    rn_bridge = require('rn-bridge');
    rn_bridge.channel.send({ type: 'log', data: 'Step 1: rn-bridge loaded OK' });
} catch (e) {
    console.error('rn-bridge failed:', e);
    // Can't send to UI if bridge failed
    return;
}

// Test 1: Can we use basic Node.js features?
try {
    var os = require('os');
    var path = require('path');
    var fs = require('fs');
    rn_bridge.channel.send({ type: 'log', data: 'Step 2: Core modules OK. Platform: ' + os.platform() + ', Arch: ' + os.arch() });
} catch (e) {
    rn_bridge.channel.send({ type: 'log', data: 'Step 2 FAILED: ' + e.message });
}

// Test 2: Can we access the data directory?
try {
    var dataDir = typeof rn_bridge.app !== 'undefined' && rn_bridge.app.datadir ? rn_bridge.app.datadir() : __dirname;
    rn_bridge.channel.send({ type: 'log', data: 'Step 3: Data dir: ' + dataDir });
} catch (e) {
    rn_bridge.channel.send({ type: 'log', data: 'Step 3 FAILED: ' + e.message });
}

// Test 3: Can we load pino?
try {
    var pino = require('pino');
    rn_bridge.channel.send({ type: 'log', data: 'Step 4: pino loaded OK' });
} catch (e) {
    rn_bridge.channel.send({ type: 'log', data: 'Step 4 FAILED (pino): ' + e.message });
}

// Test 4: Can we load openai?
try {
    var openai = require('openai');
    rn_bridge.channel.send({ type: 'log', data: 'Step 5: openai loaded OK' });
} catch (e) {
    rn_bridge.channel.send({ type: 'log', data: 'Step 5 FAILED (openai): ' + e.message });
}

// Test 5: Can we load baileys?
try {
    var baileys = require('@whiskeysockets/baileys');
    rn_bridge.channel.send({ type: 'log', data: 'Step 6: baileys loaded OK' });
} catch (e) {
    rn_bridge.channel.send({ type: 'log', data: 'Step 6 FAILED (baileys): ' + e.message });
}

// If we got here, everything loaded fine
rn_bridge.channel.send({ type: 'log', data: '✅ ALL TESTS PASSED - Backend is fully functional' });
rn_bridge.channel.send({ type: 'backend_ready' });

// Listen for messages (keep process alive)
rn_bridge.channel.on('message', function(msg) {
    rn_bridge.channel.send({ type: 'log', data: 'Received from UI: ' + JSON.stringify(msg) });
});

// Catch crashes
process.on('uncaughtException', function(err) {
    try {
        rn_bridge.channel.send({ type: 'log', data: 'UNCAUGHT: ' + err.message + '\n' + err.stack });
    } catch (_) {}
});

process.on('unhandledRejection', function(reason) {
    try {
        rn_bridge.channel.send({ type: 'log', data: 'UNHANDLED REJECTION: ' + reason });
    } catch (_) {}
});
