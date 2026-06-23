import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, PermissionsAndroid, Platform,
} from 'react-native';
import Voice from '@react-native-voice/voice';
import Tts from 'react-native-tts';
import { Socket } from 'socket.io-client';

interface CallScreenProps {
  socket: Socket | null;
  onEndCall: () => void;
  callerName?: string;
  reason?: string;
}

export default function CallScreen({ socket, onEndCall, callerName = 'Sufiyan', reason }: CallScreenProps) {
  const [status, setStatus] = useState('Connecting...');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const isProcessing = useRef(false);

  // ── Pulse animation ──────────────────────────────────────────────────────────
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.25, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  // ── TTS setup ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    Tts.setDefaultRate(0.48);
    Tts.setDefaultPitch(1.0);

    Tts.voices().then(voices => {
      // Prefer an English male voice — clear and natural
      const pick = voices.find(v =>
        v.language?.startsWith('en') && !v.name?.toLowerCase().includes('female'),
      ) || voices.find(v => v.language?.startsWith('en'));
      if (pick) Tts.setDefaultVoice(pick.id);
    });

    Tts.addEventListener('tts-start',  () => setIsSpeaking(true));
    Tts.addEventListener('tts-finish', () => {
      setIsSpeaking(false);
      if (!isProcessing.current) startListening();
    });
    Tts.addEventListener('tts-error',  () => setIsSpeaking(false));

    return () => {
      Tts.removeAllListeners('tts-start');
      Tts.removeAllListeners('tts-finish');
      Tts.removeAllListeners('tts-error');
    };
  }, []);

  // ── Voice recognition setup ───────────────────────────────────────────────────
  useEffect(() => {
    Voice.onSpeechStart   = () => { setIsListening(true);  setStatus('Listening...'); };
    Voice.onSpeechEnd     = () => { setIsListening(false); setStatus('Processing...'); };
    Voice.onSpeechResults = onSpeechResult;
    Voice.onSpeechError   = () => {
      setIsListening(false);
      setStatus('Tap to speak');
    };

    // Socket: receive Luna's reply as text → speak it
    socket?.on('voice_reply', (data: { text: string }) => {
      isProcessing.current = false;
      setStatus('Luna speaking...');
      Tts.speak(data.text);
    });

    requestMicPermission().then(granted => {
      if (granted) {
        setStatus('Tap to speak');
        // Kick off with a greeting
        const greet = reason
          ? `Hi Sufiyan, there is something important about ${reason}. How can I help you?`
          : `Hi Sufiyan, I am Luna. How can I help you?`;
        Tts.speak(greet);
      } else {
        setStatus('Microphone permission denied');
      }
    });

    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
      Tts.stop();
      socket?.off('voice_reply');
    };
  }, [socket]);

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const requestMicPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      { title: 'Microphone', message: 'Luna needs mic access for voice calls.', buttonPositive: 'OK' },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const startListening = async () => {
    if (isSpeaking || isProcessing.current || isListening) return;
    try {
      await Voice.start('en-US');
    } catch (e) {
      setStatus('Tap to speak');
    }
  };

  const stopListening = async () => {
    try { await Voice.stop(); } catch (_) {}
  };

  const onSpeechResult = (event: any) => {
    const transcript: string = event?.value?.[0] || '';
    if (!transcript.trim()) { startListening(); return; }
    isProcessing.current = true;
    setStatus(`You: "${transcript}"`);
    socket?.emit('voice_text', { text: transcript });
  };

  const handleEndCall = async () => {
    await Voice.destroy();
    Tts.stop();
    onEndCall();
  };

  // ── UI ────────────────────────────────────────────────────────────────────────
  const ringColor = isListening ? '#4CAF50' : isSpeaking ? '#FF9800' : '#7C4DFF';

  return (
    <View style={s.container}>
      {/* Avatar */}
      <Animated.View style={[s.avatarRing, { borderColor: ringColor, transform: [{ scale: pulseAnim }] }]}>
        <View style={s.avatar}><Text style={s.avatarText}>🤖</Text></View>
      </Animated.View>

      <Text style={s.name}>Luna AI</Text>
      <Text style={s.callerLabel}>Call with {callerName}</Text>
      <Text style={s.statusText}>{status}</Text>

      {/* Speak / Stop button */}
      <TouchableOpacity
        style={[s.speakBtn, isListening && s.speakBtnActive]}
        onPressIn={startListening}
        onPressOut={stopListening}
        activeOpacity={0.8}
      >
        <Text style={s.speakBtnText}>{isListening ? '🎙️ Listening…' : '🎤 Hold to Speak'}</Text>
      </TouchableOpacity>

      {/* End Call */}
      <TouchableOpacity style={s.endBtn} onPress={handleEndCall}>
        <Text style={s.endBtnText}>📵 End Call</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0D0D1A', alignItems: 'center', justifyContent: 'center', padding: 30 },
  avatarRing:     { width: 160, height: 160, borderRadius: 80, borderWidth: 4, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  avatar:         { width: 140, height: 140, borderRadius: 70, backgroundColor: '#1A1A2E', alignItems: 'center', justifyContent: 'center' },
  avatarText:     { fontSize: 64 },
  name:           { color: '#FFFFFF', fontSize: 28, fontWeight: '700', marginBottom: 4 },
  callerLabel:    { color: '#9E9EC7', fontSize: 14, marginBottom: 16 },
  statusText:     { color: '#BB86FC', fontSize: 15, textAlign: 'center', marginBottom: 40, paddingHorizontal: 20 },
  speakBtn:       { backgroundColor: '#7C4DFF', paddingHorizontal: 36, paddingVertical: 16, borderRadius: 50, marginBottom: 20 },
  speakBtnActive: { backgroundColor: '#4CAF50' },
  speakBtnText:   { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  endBtn:         { backgroundColor: '#B00020', paddingHorizontal: 36, paddingVertical: 14, borderRadius: 50 },
  endBtnText:     { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
