const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

// Use the Groq API key provided by the user
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.use(express.static('public'));
app.use(express.json());

app.post('/api/voice', upload.single('audio'), async (req, res) => {
    try {
        console.log("Received audio chunk:", req.file);
        
        // 1. Send Audio to GROQ Whisper (STT)
        console.log("Sending to Groq Whisper...");
        const formData = new FormData();
        formData.append('file', fs.createReadStream(req.file.path), { filename: 'audio.webm' });
        formData.append('model', 'whisper-large-v3');
        formData.append('response_format', 'json');

        const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                ...formData.getHeaders()
            },
            body: formData
        });

        if (!whisperRes.ok) {
            const err = await whisperRes.text();
            throw new Error(`Whisper Error: ${err}`);
        }

        const whisperData = await whisperRes.json();
        const userText = whisperData.text || "Could not transcribe";
        console.log("Transcribed Text:", userText);

        // 2. Generate Reply using Groq LLaMA 3.3 (Fastest)
        console.log("Generating reply via Groq Llama...");
        console.time("Llama Time");
        const llamaRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: 'You are Luna. Keep your reply extremely short, conversational, and natural. 1 or 2 sentences max.' },
                    { role: 'user', content: userText }
                ]
            })
        });

        if (!llamaRes.ok) {
            const err = await llamaRes.text();
            throw new Error(`Groq Llama Error: ${err}`);
        }

        const llamaData = await llamaRes.json();
        const replyText = llamaData.choices[0].message.content;
        console.timeEnd("Llama Time");
        console.log("AI Reply:", replyText);

        // Return the TEXT to the frontend (Frontend will use native Web Speech API for TTS)
        res.json({ text: replyText });

    } catch (err) {
        console.error("Test Server Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🎙️ Voice Test Server running on http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser to test.`);
});
