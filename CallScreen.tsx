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
  const [callState, setCallState] = useState<'incoming' | 'active'>('incoming');
  const [status, setStatus] = useState('Incoming Call...');
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
    if (callState === 'active') {
      loop.start();
    } else {
      // Fast pulse for ringing
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.1, duration: 400, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 400, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ])
      ).start();
    }
    return () => loop.stop();
  }, [pulseAnim, callState]);

  // ── Call Active Setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (callState !== 'active') return;

    // TTS Setup
    Tts.setDefaultRate(0.48);
    Tts.setDefaultPitch(1.0);

    Tts.voices().then(voices => {
      // Prefer an English female voice if available, otherwise just english
      const pick = voices.find(v =>
        v.language?.startsWith('en') && v.name?.toLowerCase().includes('female'),
      ) || voices.find(v => v.language?.startsWith('en'));
      if (pick) Tts.setDefaultVoice(pick.id);
    });

    const onStart = () => setIsSpeaking(true);
    const onFinish = () => {
      setIsSpeaking(false);
      if (!isProcessing.current) startListening();
    };
    const onError = () => setIsSpeaking(false);

    Tts.addEventListener('tts-start', onStart);
    Tts.addEventListener('tts-finish', onFinish);
    Tts.addEventListener('tts-error', onError);

    // Voice setup
    Voice.onSpeechStart   = () => { setIsListening(true);  setStatus('Listening...'); };
    Voice.onSpeechEnd     = () => { setIsListening(false); setStatus('Processing...'); };
    Voice.onSpeechResults = onSpeechResult;
    Voice.onSpeechError   = () => {
      setIsListening(false);
      setStatus('Tap to speak');
    };

    // Socket
    const handleVoiceReply = (data: { text: string }) => {
      isProcessing.current = false;
      setStatus('Luna speaking...');
      Tts.speak(data.text);
    };
    socket?.on('voice_reply', handleVoiceReply);

    // Start
    requestMicPermission().then(granted => {
      if (granted) {
        setStatus('Tap to speak');
        const greet = reason
          ? `Hi Sufiyan, I am calling about ${reason}. How can I help?`
          : `Hi Sufiyan, I am Luna. How can I help you?`;
        Tts.speak(greet);
      } else {
        setStatus('Microphone permission denied');
      }
    });

    return () => {
      Tts.removeAllListeners('tts-start');
      Tts.removeAllListeners('tts-finish');
      Tts.removeAllListeners('tts-error');
      try { Voice.destroy().then(Voice.removeAllListeners); } catch (e) {}
      Tts.stop();
      socket?.off('voice_reply', handleVoiceReply);
    };
  }, [callState, socket]);

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
    try {
      if (callState === 'active') {
        try { await Voice.stop(); } catch (e) {}
        try { await Voice.destroy(); } catch (e) {}
        Tts.stop();
      }
    } catch (e) {
      console.log('Error ending call', e);
    } finally {
      onEndCall();
    }
  };

  const handleAcceptCall = () => {
    setCallState('active');
    setStatus('Connecting...');
  };

  // ── UI ────────────────────────────────────────────────────────────────────────
  const ringColor = callState === 'incoming' ? '#7C4DFF' : isListening ? '#4CAF50' : isSpeaking ? '#FF9800' : '#7C4DFF';

  return (
    <View style={s.container}>
      {/* Avatar */}
      <Animated.View style={[s.avatarRing, { borderColor: ringColor, transform: [{ scale: pulseAnim }] }]}>
        <View style={s.avatar}><Text style={s.avatarText}>🤖</Text></View>
      </Animated.View>

      <Text style={s.name}>Luna AI</Text>
      <Text style={s.callerLabel}>{callState === 'incoming' ? `Incoming call...` : `Call with ${callerName}`}</Text>
      <Text style={s.statusText}>{status}</Text>

      {callState === 'incoming' ? (
        <View style={s.actionRow}>
          <TouchableOpacity style={[s.callBtn, s.declineBtn]} onPress={handleEndCall}>
            <Text style={s.callBtnIcon}>📵</Text>
            <Text style={s.callBtnText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.callBtn, s.acceptBtn]} onPress={handleAcceptCall}>
            <Text style={s.callBtnIcon}>📞</Text>
            <Text style={s.callBtnText}>Accept</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.activeCallActions}>
          <TouchableOpacity
            style={[s.speakBtn, isListening && s.speakBtnActive]}
            onPressIn={startListening}
            onPressOut={stopListening}
            activeOpacity={0.8}
          >
            <Text style={s.speakBtnText}>{isListening ? '🎙️ Listening…' : '🎤 Hold to Speak'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.endBtn} onPress={handleEndCall}>
            <Text style={s.endBtnText}>📵 End Call</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0D0D1A', alignItems: 'center', justifyContent: 'center', padding: 30 },
  avatarRing:     { width: 160, height: 160, borderRadius: 80, borderWidth: 4, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  avatar:         { width: 140, height: 140, borderRadius: 70, backgroundColor: '#1A1A2E', alignItems: 'center', justifyContent: 'center' },
  avatarText:     { fontSize: 64 },
  name:           { color: '#FFFFFF', fontSize: 28, fontWeight: '700', marginBottom: 4 },
  callerLabel:    { color: '#9E9EC7', fontSize: 16, marginBottom: 16 },
  statusText:     { color: '#BB86FC', fontSize: 15, textAlign: 'center', marginBottom: 40, paddingHorizontal: 20 },
  
  // Incoming Call Actions
  actionRow:      { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 20 },
  callBtn:        { alignItems: 'center', justifyContent: 'center', paddingVertical: 16, paddingHorizontal: 30, borderRadius: 50, width: '45%' },
  acceptBtn:      { backgroundColor: '#4CAF50' },
  declineBtn:     { backgroundColor: '#B00020' },
  callBtnIcon:    { fontSize: 24, marginBottom: 4 },
  callBtnText:    { color: '#FFF', fontSize: 16, fontWeight: 'bold' },

  // Active Call Actions
  activeCallActions: { alignItems: 'center', width: '100%' },
  speakBtn:       { backgroundColor: '#7C4DFF', paddingHorizontal: 36, paddingVertical: 16, borderRadius: 50, marginBottom: 20, width: '80%', alignItems: 'center' },
  speakBtnActive: { backgroundColor: '#4CAF50' },
  speakBtnText:   { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  endBtn:         { backgroundColor: '#B00020', paddingHorizontal: 36, paddingVertical: 14, borderRadius: 50, width: '80%', alignItems: 'center' },
  endBtnText:     { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
