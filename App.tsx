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
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCode from 'react-native-qrcode-svg';

// ---- Error Boundary to catch crashes and display them on-screen ----
interface ErrorBoundaryState {
  hasError: boolean;
  error: string;
  errorInfo: string;
}

class ErrorBoundary extends Component<{children: ReactNode}, ErrorBoundaryState> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: '', errorInfo: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.toString() };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error: error.toString(),
      errorInfo: errorInfo.componentStack || '',
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#1a0000', padding: 20 }}>
          <Text style={{ color: '#ff4444', fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>
            ⚠ App Crashed - Error Details:
          </Text>
          <ScrollView>
            <Text selectable style={{ color: '#ff8888', fontSize: 14, fontFamily: 'monospace' }}>
              {this.state.error}
            </Text>
            <Text selectable style={{ color: '#ffaaaa', fontSize: 12, fontFamily: 'monospace', marginTop: 10 }}>
              {this.state.errorInfo}
            </Text>
          </ScrollView>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

const DEFAULT_PROMPT = "You are Luna, the personal and highly capable WhatsApp assistant to Sufiyan.\nYour role is to manage his incoming messages, schedule, and communications like a real human assistant.\n\nPERSONALITY TRAITS:\n- Warm, polite, and deeply professional.\n- You speak conversationally, exactly like a human assistant texting on WhatsApp. No robotic formatting.\n- Keep your replies relatively short and natural, suitable for text messaging.\n- You are highly protective of Sufiyan's time.\n\nKEY RULES:\n1. Always introduce yourself gracefully if the person seems to not know they are speaking to an assistant.\n2. If it's a casual greeting, respond warmly and ask how you can help on Sufiyan's behalf.\n3. If someone asks for a meeting or favor, politely let them know you will pass the message to Sufiyan.\n4. Never make up facts about Sufiyan's schedule. Instead, say you need to check with him.\n5. Do not use robotic phrases like 'As an AI language model'. You are strictly Luna, the human assistant.";

// Store nodejs reference globally so all functions can access it
let nodejsRef: any = null;

function LunaApp() {
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const [status, setStatus] = useState('Initializing...');
  const [qrCode, setQrCode] = useState('');
  const [logs, setLogs] = useState<string[]>(['[App] Starting up...']);
  const [nodeReady, setNodeReady] = useState(false);
  
  // Settings
  const [nvidiaApiKey, setNvidiaApiKey] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [excludedNumbers, setExcludedNumbers] = useState('');

  const scrollViewRef = useRef<ScrollView>(null);
  const logsRef = useRef<string[]>(['[App] Starting up...']);

  // Stable addLog that doesn't depend on state closure
  const addLog = (msg: string) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logsRef.current = [...logsRef.current.slice(-99), entry];
    setLogs([...logsRef.current]);
  };

  useEffect(() => {
    // Only load settings on startup - do NOT start Node.js yet
    const loadSavedSettings = async () => {
      try {
        const key = await AsyncStorage.getItem('nvidiaApiKey');
        const prompt = await AsyncStorage.getItem('systemPrompt');
        const excluded = await AsyncStorage.getItem('excludedNumbers');
        
        if (key) setNvidiaApiKey(key);
        if (prompt) setSystemPrompt(prompt);
        if (excluded) setExcludedNumbers(excluded);
        
        addLog('Settings loaded.');
        addLog('Tap START BOT when ready.');
        setStatus('Ready - Tap Start');
      } catch (e) {
        addLog('Could not load saved settings, using defaults.');
        setStatus('Ready - Tap Start');
      }
    };

    loadSavedSettings();
  }, []);

  const sendConfigToBackend = (key: string, prompt: string, excluded: string) => {
    if (!nodejsRef) return;
    try {
      const excludeArr = excluded.split(',').map(n => n.trim()).filter(n => n);
      nodejsRef.channel.send({
        type: 'config',
        data: {
          nvidiaApiKey: key,
          systemPrompt: prompt,
          excludedNumbers: excludeArr,
        },
      });
    } catch (e: any) {
      addLog(`Failed to send config: ${e.message}`);
    }
  };

  const saveSettings = async () => {
    try {
      await AsyncStorage.setItem('nvidiaApiKey', nvidiaApiKey);
      await AsyncStorage.setItem('systemPrompt', systemPrompt);
      await AsyncStorage.setItem('excludedNumbers', excludedNumbers);
      addLog('Settings saved.');
      sendConfigToBackend(nvidiaApiKey, systemPrompt, excludedNumbers);
    } catch (e: any) {
      addLog(`Failed to save settings: ${e.message}`);
    }
  };

  const initNodeEngine = () => {
    if (nodejsRef) return true; // Already initialized
    
    try {
      addLog('Loading nodejs-mobile module...');
      const nodejs = require('nodejs-mobile-react-native');
      
      if (!nodejs || !nodejs.start) {
        addLog(`ERROR: Module missing .start. Keys: ${Object.keys(nodejs || {}).join(', ')}`);
        return false;
      }
      
      // Set up message listener BEFORE starting the engine
      nodejs.channel.addListener('message', (msg: any) => {
        try {
          if (msg.type === 'backend_ready') {
            addLog('Node.js Backend is ready.');
            setNodeReady(true);
          } else if (msg.type === 'log') {
            addLog(msg.data);
          } else if (msg.type === 'qr') {
            setQrCode(msg.data);
            setStatus('Scan QR Code');
            addLog('QR code received. Open WhatsApp > Linked Devices > Scan.');
          } else if (msg.type === 'status') {
            if (msg.data === 'connected') {
              setStatus('Connected / Online ✅');
              setQrCode('');
              addLog('WhatsApp connected! Luna is now active.');
            } else if (msg.data === 'disconnected') {
              setStatus('Disconnected');
              addLog('WhatsApp disconnected.');
            } else if (msg.data === 'logged_out') {
              setStatus('Logged Out');
              setQrCode('');
              addLog('Logged out. Tap START BOT to reconnect.');
            }
          }
        } catch (err: any) {
          addLog(`Listener error: ${err.message}`);
        }
      });
      
      addLog('Starting Node.js engine...');
      nodejs.start('main.js');
      nodejsRef = nodejs;
      addLog('Node.js engine started.');
      return true;
    } catch (e: any) {
      addLog(`FATAL: ${e.message}`);
      addLog(`Stack: ${e.stack || 'N/A'}`);
      setStatus('Engine Error - See Logs');
      return false;
    }
  };

  const startBot = () => {
    if (!nvidiaApiKey) {
      addLog('Please set your NVIDIA API Key in Settings first.');
      setActiveTab('settings');
      return;
    }
    
    setStatus('Starting...');
    
    // Initialize Node.js engine if not already running
    if (!initNodeEngine()) {
      setStatus('Engine Error - See Logs');
      return;
    }
    
    try {
      // Send config then start command
      const excludeArr = excludedNumbers.split(',').map(n => n.trim()).filter(n => n);
      nodejsRef.channel.send({
        type: 'config',
        data: { nvidiaApiKey, systemPrompt, excludedNumbers: excludeArr },
      });
      nodejsRef.channel.send({ type: 'start' });
      addLog('Bot start command sent.');
    } catch (e: any) {
      addLog(`Failed to start bot: ${e.message}`);
    }
  };

  const stopBot = () => {
    if (!nodejsRef) return;
    try {
      nodejsRef.channel.send({ type: 'logout' });
      addLog('Logout command sent.');
    } catch (e: any) {
      addLog(`Failed to stop bot: ${e.message}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Luna Assistant</Text>
        <Text style={styles.statusText}>Status: {status}</Text>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, activeTab === 'dashboard' && styles.activeTab]} onPress={() => setActiveTab('dashboard')}>
          <Text style={[styles.tabText, activeTab === 'dashboard' && styles.activeTabText]}>Dashboard</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'settings' && styles.activeTab]} onPress={() => setActiveTab('settings')}>
          <Text style={[styles.tabText, activeTab === 'settings' && styles.activeTabText]}>Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'logs' && styles.activeTab]} onPress={() => setActiveTab('logs')}>
          <Text style={[styles.tabText, activeTab === 'logs' && styles.activeTabText]}>Logs</Text>
        </TouchableOpacity>
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
                <Text style={styles.infoText}>Your personal AI assistant running natively.</Text>
              </View>
            )}
            
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.primaryButton} onPress={startBot}>
                <Text style={styles.buttonText}>START BOT</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dangerButton} onPress={stopBot}>
                <Text style={styles.buttonText}>STOP & LOGOUT</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeTab === 'settings' && (
          <ScrollView style={styles.settings} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>NVIDIA API Key</Text>
            <TextInput
              style={styles.input}
              value={nvidiaApiKey}
              onChangeText={setNvidiaApiKey}
              placeholder="nvapi-..."
              placeholderTextColor="#999"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>Excluded Contacts (Comma separated phone numbers without +)</Text>
            <TextInput
              style={styles.input}
              value={excludedNumbers}
              onChangeText={setExcludedNumbers}
              placeholder="e.g. 919876543210, 12025550123"
              placeholderTextColor="#999"
              keyboardType="phone-pad"
            />

            <Text style={styles.label}>System Prompt (Luna's Instructions)</Text>
            <TextInput
              style={styles.textArea}
              value={systemPrompt}
              onChangeText={setSystemPrompt}
              multiline
              textAlignVertical="top"
              placeholderTextColor="#999"
            />

            <TouchableOpacity style={[styles.primaryButton, { marginBottom: 40 }]} onPress={saveSettings}>
              <Text style={styles.buttonText}>SAVE SETTINGS</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {activeTab === 'logs' && (
          <ScrollView 
            style={styles.logsContainer}
            ref={scrollViewRef}
            onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
          >
            {logs.map((log, index) => (
              <Text key={index} selectable style={styles.logText}>{log}</Text>
            ))}
            {logs.length === 0 && (
              <Text style={styles.logText}>No logs yet.</Text>
            )}
          </ScrollView>
        )}

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 20,
    backgroundColor: '#075E54',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  statusText: {
    color: '#dcf8c6',
    marginTop: 5,
    fontSize: 13,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: 'white',
    elevation: 2,
  },
  tab: {
    flex: 1,
    padding: 15,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#075E54',
  },
  tabText: {
    fontWeight: 'bold',
    color: '#999',
  },
  activeTabText: {
    color: '#075E54',
  },
  content: {
    flex: 1,
  },
  dashboard: {
    flex: 1,
    padding: 20,
    justifyContent: 'space-between',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    marginVertical: 20,
  },
  welcomeText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  infoText: {
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  primaryButton: {
    backgroundColor: '#128C7E',
    padding: 15,
    borderRadius: 8,
    flex: 1,
    marginRight: 10,
    alignItems: 'center',
  },
  dangerButton: {
    backgroundColor: '#d9534f',
    padding: 15,
    borderRadius: 8,
    flex: 1,
    marginLeft: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  settings: {
    padding: 20,
  },
  label: {
    fontWeight: 'bold',
    marginTop: 15,
    marginBottom: 5,
    color: '#333',
  },
  input: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    color: '#333',
  },
  textArea: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    height: 150,
    marginBottom: 20,
    color: '#333',
  },
  logsContainer: {
    flex: 1,
    backgroundColor: '#1e1e1e',
    padding: 10,
  },
  logText: {
    color: '#00ff00',
    fontFamily: 'monospace',
    fontSize: 12,
    marginBottom: 4,
  },
});

export default function App() {
  return (
    <ErrorBoundary>
      <LunaApp />
    </ErrorBoundary>
  );
}
