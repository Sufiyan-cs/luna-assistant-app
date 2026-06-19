import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCode from 'react-native-qrcode-svg';
import { io, Socket } from 'socket.io-client';

// ---- Error Boundary ----
interface ErrorBoundaryState { hasError: boolean; error: string; errorInfo: string; }

class ErrorBoundary extends Component<{children: ReactNode}, ErrorBoundaryState> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: '', errorInfo: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.toString() };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error: error.toString(), errorInfo: errorInfo.componentStack || '' });
  }
  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#1a0000', padding: 20 }}>
          <Text style={{ color: '#ff4444', fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>⚠ App Crashed</Text>
          <ScrollView>
            <Text selectable style={{ color: '#ff8888', fontSize: 14, fontFamily: 'monospace' }}>{this.state.error}</Text>
            <Text selectable style={{ color: '#ffaaaa', fontSize: 12, fontFamily: 'monospace', marginTop: 10 }}>{this.state.errorInfo}</Text>
          </ScrollView>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

const DEFAULT_PROMPT = "You are Luna, the personal and highly capable WhatsApp assistant to Sufiyan.\nYour role is to manage his incoming messages, schedule, and communications like a real human assistant.\n\nPERSONALITY TRAITS:\n- Warm, polite, and deeply professional.\n- You speak conversationally, exactly like a human assistant texting on WhatsApp. No robotic formatting.\n- Keep your replies relatively short and natural, suitable for text messaging.\n- You are highly protective of Sufiyan's time.\n\nKEY RULES:\n1. Always introduce yourself gracefully if the person seems to not know they are speaking to an assistant.\n2. If it's a casual greeting, respond warmly and ask how you can help on Sufiyan's behalf.\n3. If someone asks for a meeting or favor, politely let them know you will pass the message to Sufiyan.\n4. Never make up facts about Sufiyan's schedule. Instead, say you need to check with him.\n5. Do not use robotic phrases like 'As an AI language model'. You are strictly Luna, the human assistant.";

let socketRef: Socket | null = null;

function LunaApp() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [status, setStatus] = useState('Disconnected');
  const [logs, setLogs] = useState<string[]>([]);
  const [qrCode, setQrCode] = useState('');
  
  // Settings
  const [backendUrl, setBackendUrl] = useState('');
  const [nvidiaApiKey, setNvidiaApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [excludedNumbers, setExcludedNumbers] = useState('');
  
  const scrollViewRef = useRef<ScrollView>(null);
  const logsRef = useRef<string[]>([]);

  const addLog = (msg: string) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logsRef.current = [...logsRef.current.slice(-99), entry];
    setLogs([...logsRef.current]);
  };

  useEffect(() => {
    addLog('Luna Client App started.');
    
    // Load settings
    const loadSettings = async () => {
      try {
        const url = await AsyncStorage.getItem('backendUrl');
        const key = await AsyncStorage.getItem('nvidiaApiKey');
        const prompt = await AsyncStorage.getItem('systemPrompt');
        const excluded = await AsyncStorage.getItem('excludedNumbers');
        
        if (url) {
          setBackendUrl(url);
          connectToServer(url); // Auto-connect if URL is present
        } else {
          addLog('Please enter your Backend URL in Settings.');
          setStatus('Requires Setup');
        }
        
        if (key) setNvidiaApiKey(key);
        if (prompt) setSystemPrompt(prompt);
        if (excluded) setExcludedNumbers(excluded);
      } catch(e) {
        addLog('Could not load settings.');
      }
    };
    
    loadSettings();

    return () => {
      if (socketRef) {
        socketRef.disconnect();
      }
    };
  }, []);

  const connectToServer = (url: string) => {
    if (socketRef) {
      socketRef.disconnect();
    }
    
    if (!url) return;

    addLog(`Connecting to backend at ${url}...`);
    setStatus('Connecting to server...');
    
    const socket = io(url, {
      transports: ['websocket'], // Force WebSocket for React Native
    });
    
    socketRef = socket;

    socket.on('connect', () => {
      addLog('Connected to backend server!');
      setStatus('Connected to Server ✅');
    });

    socket.on('disconnect', () => {
      addLog('Disconnected from server.');
      setStatus('Disconnected from Server');
    });

    socket.on('connect_error', (err) => {
      addLog(`Connection error: ${err.message}`);
      setStatus('Connection Error');
    });

    socket.on('backend_ready', () => {
      addLog('Backend is ready.');
      // Send config right away
      sendConfig(socket, nvidiaApiKey, systemPrompt, excludedNumbers);
    });

    socket.on('log', (msg) => {
      addLog(msg);
    });

    socket.on('qr', (data) => {
      setQrCode(data);
      setStatus('Scan QR Code');
    });

    socket.on('status', (botStatus) => {
      if (botStatus === 'connected') {
        setStatus('Bot Online ✅');
        setQrCode('');
      } else if (botStatus === 'disconnected') {
        setStatus('Bot Disconnected');
      } else if (botStatus === 'logged_out') {
        setStatus('Bot Logged Out');
        setQrCode('');
      }
    });
  };

  const sendConfig = (socket: Socket | null, key: string, prompt: string, excluded: string) => {
    if (!socket || !socket.connected) return;
    const excludeArr = excluded.split(',').map(n => n.trim()).filter(n => n);
    socket.emit('config', {
      nvidiaApiKey: key,
      systemPrompt: prompt,
      excludedNumbers: excludeArr,
    });
  };

  const saveSettings = async () => {
    try {
      await AsyncStorage.setItem('backendUrl', backendUrl);
      await AsyncStorage.setItem('nvidiaApiKey', nvidiaApiKey);
      await AsyncStorage.setItem('systemPrompt', systemPrompt);
      await AsyncStorage.setItem('excludedNumbers', excludedNumbers);
      addLog('Settings saved.');
      
      // Reconnect if URL changed
      connectToServer(backendUrl);
      sendConfig(socketRef, nvidiaApiKey, systemPrompt, excludedNumbers);
    } catch (e: any) {
      addLog('Save failed: ' + e.message);
    }
  };

  const startBot = () => {
    if (!socketRef || !socketRef.connected) {
      addLog('Cannot start: Not connected to backend server.');
      return;
    }
    sendConfig(socketRef, nvidiaApiKey, systemPrompt, excludedNumbers);
    addLog('Requesting bot start...');
    socketRef.emit('start');
  };

  const stopBot = () => {
    if (!socketRef || !socketRef.connected) return;
    addLog('Requesting bot logout...');
    socketRef.emit('logout');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Luna Assistant</Text>
        <Text style={styles.statusText}>Status: {status}</Text>
      </View>

      <View style={styles.tabs}>
        {['dashboard', 'settings', 'logs'].map(tab => (
          <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.activeTab]} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && { color: '#075E54' }]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {activeTab === 'dashboard' && (
          <View style={styles.dashboard}>
            {qrCode ? (
              <View style={styles.qrContainer}>
                <Text style={styles.infoText}>Scan this QR code with WhatsApp</Text>
                <QRCode value={qrCode} size={250} />
              </View>
            ) : (
              <View style={styles.centerContainer}>
                <Text style={styles.welcomeText}>Welcome to Luna</Text>
                <Text style={styles.infoText}>Controlling Remote Backend</Text>
              </View>
            )}
            
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.primaryButton} onPress={startBot}>
                <Text style={styles.buttonText}>START BOT</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dangerButton} onPress={stopBot}>
                <Text style={styles.buttonText}>LOGOUT BOT</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeTab === 'settings' && (
          <ScrollView style={styles.settings} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Backend Server URL</Text>
            <TextInput style={styles.input} value={backendUrl} onChangeText={setBackendUrl} placeholder="e.g. https://luna-bot.onrender.com" placeholderTextColor="#999" autoCapitalize="none" autoCorrect={false} />
            
            <Text style={styles.label}>NVIDIA API Key</Text>
            <TextInput style={styles.input} value={nvidiaApiKey} onChangeText={setNvidiaApiKey} placeholder="nvapi-..." placeholderTextColor="#999" secureTextEntry autoCapitalize="none" />
            
            <Text style={styles.label}>Excluded Contacts</Text>
            <TextInput style={styles.input} value={excludedNumbers} onChangeText={setExcludedNumbers} placeholder="e.g. 919876543210" placeholderTextColor="#999" keyboardType="phone-pad" />
            
            <Text style={styles.label}>System Prompt</Text>
            <TextInput style={styles.textArea} value={systemPrompt} onChangeText={setSystemPrompt} multiline textAlignVertical="top" placeholderTextColor="#999" />
            
            <TouchableOpacity style={[styles.primaryButton, { marginBottom: 40 }]} onPress={saveSettings}>
              <Text style={styles.buttonText}>SAVE SETTINGS</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {activeTab === 'logs' && (
          <ScrollView style={styles.logsContainer} ref={scrollViewRef} onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}>
            {logs.map((log, i) => (
              <Text key={i} selectable style={styles.logText}>{log}</Text>
            ))}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { padding: 20, backgroundColor: '#075E54', alignItems: 'center' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  statusText: { color: '#dcf8c6', marginTop: 5, fontSize: 13 },
  tabs: { flexDirection: 'row', backgroundColor: 'white', elevation: 2 },
  tab: { flex: 1, padding: 15, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#075E54' },
  tabText: { fontWeight: 'bold', color: '#999' },
  content: { flex: 1 },
  dashboard: { flex: 1, padding: 20, justifyContent: 'space-between' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  qrContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'white', borderRadius: 10, padding: 20, marginVertical: 20 },
  welcomeText: { fontSize: 22, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  infoText: { color: '#666', textAlign: 'center', marginBottom: 10 },
  buttonRow: { flexDirection: 'row', justifyContent: 'center' },
  primaryButton: { backgroundColor: '#128C7E', padding: 15, borderRadius: 8, flex: 1, alignItems: 'center', marginRight: 5 },
  dangerButton: { backgroundColor: '#d9534f', padding: 15, borderRadius: 8, flex: 1, alignItems: 'center', marginLeft: 5 },
  buttonText: { color: 'white', fontWeight: 'bold' },
  settings: { padding: 20 },
  label: { fontWeight: 'bold', marginTop: 15, marginBottom: 5, color: '#333' },
  input: { backgroundColor: 'white', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 16, color: '#333' },
  textArea: { backgroundColor: 'white', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 14, height: 150, marginBottom: 20, color: '#333' },
  logsContainer: { flex: 1, backgroundColor: '#1e1e1e', padding: 10 },
  logText: { color: '#00ff00', fontFamily: 'monospace', fontSize: 12, marginBottom: 4 },
});

export default function App() {
  return <ErrorBoundary><LunaApp /></ErrorBoundary>;
}
