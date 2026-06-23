import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import Tts from 'react-native-tts';
import { request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import RNFS from 'react-native-fs';
import { Socket } from 'socket.io-client';

interface CallScreenProps {
  socket: Socket | null;
  onEndCall: () => void;
  callerName?: string;
  reason?: string;
}

export default function CallScreen({ socket, onEndCall, callerName = "Sufiyan", reason }: CallScreenProps) {
  const [status, setStatus] = useState<string>('Connecting...');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolume] = useState(-50);
  
  const recorder = useRef(new AudioRecorderPlayer()).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const silenceTimer = useRef<NodeJS.Timeout | null>(null);
  const isRecording = useRef(false);
  const currentFilePath = useRef('');

  useEffect(() => {
    // Setup TTS
    Tts.setDefaultRate(0.5); // Normal speed
    Tts.setDefaultPitch(1.1); // Slightly higher for female voice

    // Find a good female voice if available
    Tts.voices().then(voices => {
      const femaleVoice = voices.find(v => v.name.includes('Female') || v.name.includes('Siri') || v.name.includes('Zira') || v.name.toLowerCase().includes('f'));
      if (femaleVoice) {
        Tts.setDefaultVoice(femaleVoice.id);
      }
    });

    Tts.addEventListener('tts-start', () => setIsSpeaking(true));
    Tts.addEventListener('tts-finish', () => {
      setIsSpeaking(false);
      // Automatically resume recording after she finishes speaking!
      startRecording();
    });
    Tts.addEventListener('tts-cancel', () => setIsSpeaking(false));

    if (socket) {
      socket.on('voice_reply', (data) => {
        setStatus('Luna is speaking...');
        Tts.speak(data.text);
      });
    }

    // Start pulsing animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
      ])
    ).start();

    // Init mic
    requestMicPermission().then((granted) => {
      if (granted) {
        setStatus('Listening...');
        startRecording();
      } else {
        setStatus('Microphone permission denied.');
      }
    });

    return () => {
      stopRecording();
      Tts.stop();
      if (socket) socket.off('voice_reply');
    };
  }, []);

  const requestMicPermission = async () => {
    const res = await request(PERMISSIONS.ANDROID.RECORD_AUDIO);
    return res === RESULTS.GRANTED;
  };

  const startRecording = async () => {
    if (isRecording.current) return;
    try {
      setStatus('Listening...');
      const path = `${RNFS.CachesDirectoryPath}/voice_chunk.webm`;
      const uri = await recorder.startRecorder(path);
      currentFilePath.current = uri;
      isRecording.current = true;

      recorder.addRecordBackListener((e) => {
        setVolume(e.currentMetering || -50);
        
        // Voice Activity Detection (VAD) Logic
        const db = e.currentMetering || -50;
        
        if (db > -25) { // User is actively speaking
          if (silenceTimer.current) {
            clearTimeout(silenceTimer.current);
            silenceTimer.current = null;
          }
        } else { // Silence
          if (!silenceTimer.current) {
            // If silent for 1.5 seconds, consider speech finished and send to backend
            silenceTimer.current = setTimeout(() => {
              stopRecordingAndSend();
            }, 1500);
          }
        }
      });
    } catch (err) {
      console.error(err);
    }
  };

  const stopRecordingAndSend = async () => {
    if (!isRecording.current) return;
    try {
      const uri = await recorder.stopRecorder();
      recorder.removeRecordBackListener();
      isRecording.current = false;
      setStatus('Thinking...');

      if (silenceTimer.current) {
        clearTimeout(silenceTimer.current);
        silenceTimer.current = null;
      }

      // Read file and send over socket
      const base64Audio = await RNFS.readFile(uri, 'base64');
      if (socket) {
        socket.emit('voice_audio', { audioBase64: base64Audio });
      }

    } catch (err) {
      console.error(err);
    }
  };

  const stopRecording = async () => {
    if (!isRecording.current) return;
    try {
      await recorder.stopRecorder();
      recorder.removeRecordBackListener();
      isRecording.current = false;
    } catch (err) {}
  };

  const handleEndCall = () => {
    stopRecording();
    Tts.stop();
    onEndCall();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.callerName}>{callerName}</Text>
      {reason ? <Text style={styles.reasonText}>{reason}</Text> : null}
      <Text style={styles.statusText}>{status}</Text>

      <View style={styles.avatarContainer}>
        <Animated.View style={[styles.avatarPulse, { transform: [{ scale: isSpeaking ? pulseAnim : 1 }] }]} />
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>L</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.endCallButton} onPress={handleEndCall}>
        <Text style={styles.endCallText}>End Call</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a', // dark blue/gray
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  callerName: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 10,
  },
  reasonText: {
    fontSize: 16,
    color: '#94a3b8',
    marginBottom: 40,
    textAlign: 'center',
  },
  statusText: {
    fontSize: 20,
    color: '#38bdf8', // Light blue
    marginBottom: 60,
  },
  avatarContainer: {
    width: 150,
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 100,
  },
  avatarPulse: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
  },
  avatar: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#38bdf8',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 10,
  },
  avatarText: {
    fontSize: 60,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  endCallButton: {
    backgroundColor: '#ef4444', // Red
    paddingVertical: 15,
    paddingHorizontal: 50,
    borderRadius: 30,
    position: 'absolute',
    bottom: 50,
  },
  endCallText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
